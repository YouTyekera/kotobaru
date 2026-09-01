import {
  DiscordSDK,
  Events,
} from "@discord/embedded-app-sdk";

/* =========================================================
 * 型
 * ======================================================= */

export type DiscordUser = {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
};

export type DiscordParticipant = DiscordUser & {
  bot?: boolean;
};

export type DiscordConnection = {
  user: DiscordUser | null;
  guildId: string | null;
  channelId: string | null;
  accessToken: string | null;
  sessionToken: string | null;
  error: string | null;
};

export type KotobaruPresence = {
  puzzleNumber: number;
  participantCount: number;
  finished: boolean;
  won: boolean;
  attempts: number;
};

type PersistedTokenCache = {
  accessToken: string;
  expiresAt: number;
};

type PersistedKotobaruSession = {
  sessionToken: string;
  expiresAt: number;
  guildId: string;
  user: DiscordUser;
};

/* =========================================================
 * Discord Application ID
 * ======================================================= */

const clientId =
  import.meta.env.VITE_DISCORD_CLIENT_ID;

/*
 * sessionStorageだけだとActivityを閉じるたびに消え、
 * 毎回 /oauth2/token を叩くことになります。
 * DiscordのAccess Tokenは通常 expires_in を伴って返るため、
 * 有効期限の範囲内だけlocalStorageへ保持して再利用します。
 */
const TOKEN_CACHE_KEY =
  `kotobaru-discord-access-token-v2:${clientId || "unknown"}`;

const OAUTH_COOLDOWN_KEY =
  `kotobaru-discord-oauth-cooldown:${clientId || "unknown"}`;

const DATA_SESSION_CACHE_PREFIX =
  `kotobaru-data-session-v1:${clientId || "unknown"}:`;

let discordSdk:
  | DiscordSDK
  | null = null;

let activeAccessToken:
  | string
  | null = null;

/* =========================================================
 * Discord Activity内か確認
 * ======================================================= */

export function isDiscordActivityEnvironment(): boolean {
  if (
    typeof window === "undefined"
  ) {
    return false;
  }

  const params =
    new URLSearchParams(
      window.location.search,
    );

  return params.has(
    "frame_id",
  );
}

/* =========================================================
 * エラーを表示用文字列にする
 * ======================================================= */

function errorToText(
  error: unknown,
): string {
  if (
    error instanceof Error
  ) {
    return `${error.name}: ${error.message}`;
  }

  if (
    typeof error === "string"
  ) {
    return error;
  }

  try {
    return JSON.stringify(
      error,
      null,
      2,
    );
  } catch {
    return String(error);
  }
}

/* =========================================================
 * OAuthキャッシュ
 * ======================================================= */

function readTokenCache():
  PersistedTokenCache | null {
  try {
    const raw =
      localStorage.getItem(
        TOKEN_CACHE_KEY,
      );

    if (!raw) {
      return null;
    }

    const parsed =
      JSON.parse(raw) as
        Partial<PersistedTokenCache>;

    if (
      typeof parsed.accessToken !==
        "string" ||
      !parsed.accessToken ||
      typeof parsed.expiresAt !==
        "number"
    ) {
      localStorage.removeItem(
        TOKEN_CACHE_KEY,
      );

      return null;
    }

    /*
     * 有効期限まで5分未満なら再利用しません。
     */
    if (
      parsed.expiresAt -
        Date.now() <
      5 * 60 * 1000
    ) {
      localStorage.removeItem(
        TOKEN_CACHE_KEY,
      );

      return null;
    }

    return {
      accessToken:
        parsed.accessToken,
      expiresAt:
        parsed.expiresAt,
    };
  } catch {
    localStorage.removeItem(
      TOKEN_CACHE_KEY,
    );

    return null;
  }
}

function writeTokenCache(
  accessToken: string,
  expiresInSeconds: number,
) {
  const safeExpiresIn =
    Number.isFinite(
      expiresInSeconds,
    ) &&
    expiresInSeconds > 0
      ? expiresInSeconds
      : 60 * 60;

  const cache:
    PersistedTokenCache = {
    accessToken,
    expiresAt:
      Date.now() +
      safeExpiresIn * 1000,
  };

  localStorage.setItem(
    TOKEN_CACHE_KEY,
    JSON.stringify(cache),
  );
}

function clearTokenCache() {
  localStorage.removeItem(
    TOKEN_CACHE_KEY,
  );

  activeAccessToken =
    null;
}

function oauthCooldownUntil() {
  const raw =
    localStorage.getItem(
      OAUTH_COOLDOWN_KEY,
    );

  const value =
    raw
      ? Number(raw)
      : 0;

  return Number.isFinite(
    value,
  )
    ? value
    : 0;
}

function setOAuthCooldown(
  milliseconds:
    number,
) {
  localStorage.setItem(
    OAUTH_COOLDOWN_KEY,
    String(
      Date.now() +
        milliseconds,
    ),
  );
}

function clearOAuthCooldown() {
  localStorage.removeItem(
    OAUTH_COOLDOWN_KEY,
  );
}

/* =========================================================
 * ことばル独自セッション
 *
 * Discord OAuthが一時的に429でも、過去に認証済みなら
 * D1の盤面保存・復元を継続できるようにします。
 * ======================================================= */

function dataSessionCacheKey(
  guildId: string,
) {
  return `${DATA_SESSION_CACHE_PREFIX}${guildId}`;
}

function readKotobaruSession(
  guildId: string | null,
): PersistedKotobaruSession | null {
  if (!guildId) {
    return null;
  }

  try {
    const raw =
      localStorage.getItem(
        dataSessionCacheKey(guildId),
      );

    if (!raw) {
      return null;
    }

    const parsed =
      JSON.parse(raw) as
        Partial<PersistedKotobaruSession>;

    if (
      typeof parsed.sessionToken !== "string" ||
      !parsed.sessionToken ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt - Date.now() < 5 * 60 * 1000 ||
      parsed.guildId !== guildId ||
      !parsed.user?.id
    ) {
      localStorage.removeItem(
        dataSessionCacheKey(guildId),
      );
      return null;
    }

    return parsed as PersistedKotobaruSession;
  } catch {
    localStorage.removeItem(
      dataSessionCacheKey(guildId),
    );
    return null;
  }
}

function writeKotobaruSession(
  guildId: string,
  sessionToken: string,
  expiresIn: number,
  user: DiscordUser,
) {
  const safeExpiresIn =
    Number.isFinite(expiresIn) &&
    expiresIn > 0
      ? expiresIn
      : 7 * 24 * 60 * 60;

  const value: PersistedKotobaruSession = {
    guildId,
    sessionToken,
    expiresAt:
      Date.now() +
      safeExpiresIn * 1000,
    user,
  };

  localStorage.setItem(
    dataSessionCacheKey(guildId),
    JSON.stringify(value),
  );
}

async function ensureKotobaruSession(
  guildId: string | null,
  accessToken: string | null,
  fallbackUser: DiscordUser | null,
): Promise<PersistedKotobaruSession | null> {
  const cached =
    readKotobaruSession(guildId);

  if (cached) {
    return cached;
  }

  if (
    !guildId ||
    !accessToken
  ) {
    return null;
  }

  try {
    const response =
      await fetch(
        "/data/session",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            Authorization:
              `Bearer ${accessToken}`,
          },
          body:
            JSON.stringify({
              guildId,
            }),
        },
      );

    if (!response.ok) {
      console.warn(
        "ことばルD1セッション発行失敗:",
        response.status,
      );
      return null;
    }

    const data =
      await response.json() as {
        sessionToken?: string;
        expiresIn?: number;
        user?: {
          userId?: string;
          username?: string;
          globalName?: string | null;
          avatar?: string | null;
        };
      };

    if (!data.sessionToken) {
      return null;
    }

    const user: DiscordUser = {
      id:
        data.user?.userId ||
        fallbackUser?.id ||
        "",
      username:
        data.user?.username ||
        fallbackUser?.username ||
        "Discordユーザー",
      global_name:
        data.user?.globalName ??
        fallbackUser?.global_name ??
        null,
      avatar:
        data.user?.avatar ??
        fallbackUser?.avatar ??
        null,
    };

    if (!user.id) {
      return null;
    }

    writeKotobaruSession(
      guildId,
      data.sessionToken,
      Number(data.expiresIn) ||
        7 * 24 * 60 * 60,
      user,
    );

    return readKotobaruSession(
      guildId,
    );
  } catch (error) {
    console.warn(
      "ことばルD1セッション発行通信失敗:",
      errorToText(error),
    );
    return null;
  }
}

/* =========================================================
 * Render起床 + 日次集計確認
 *
 * 重要：OAuthより先に呼びます。
 * OAuthが429でも、昨日の結果公開や起動カード整理を止めません。
 * ======================================================= */

async function notifyBackendAwake(
  guildId:
    string | null,
  channelId:
    string | null,
): Promise<void> {
  if (!guildId) {
    return;
  }

  try {
    const response =
      await fetch(
        "/api/kotobaru/awake",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body:
            JSON.stringify({
              guildId,
              channelId,
            }),
        },
      );

    console.log(
      "ことばル起動確認:",
      response.status,
    );
  } catch (error) {
    console.warn(
      "起動確認通信失敗:",
      errorToText(error),
    );
  }
}

/* =========================================================
 * キャッシュ済みAccess Tokenで認証
 * ======================================================= */

async function authenticateWithCachedToken() {
  if (!discordSdk) {
    return null;
  }

  const cached =
    readTokenCache();

  if (!cached) {
    return null;
  }

  try {
    const auth =
      await discordSdk.commands.authenticate({
        access_token:
          cached.accessToken,
      });

    if (auth?.user) {
      activeAccessToken =
        cached.accessToken;

      clearOAuthCooldown();

      console.log(
        "Discord認証情報を再利用しました。",
      );

      return auth;
    }
  } catch (error) {
    console.warn(
      "保存済みDiscord認証情報を再利用できませんでした。",
      errorToText(error),
    );
  }

  clearTokenCache();

  return null;
}

/* =========================================================
 * Discord接続
 * ======================================================= */

export async function connectDiscord(): Promise<DiscordConnection> {
  if (
    !isDiscordActivityEnvironment()
  ) {
    return {
      user: null,
      guildId: null,
      channelId: null,
      accessToken: null,
      sessionToken: null,
      error: null,
    };
  }

  if (!clientId) {
    const message =
      "VITE_DISCORD_CLIENT_ID が設定されていません。";

    return {
      user: null,
      guildId: null,
      channelId: null,
      accessToken: null,
      sessionToken: null,
      error: message,
    };
  }

  let contextGuildId:
    string | null = null;

  let contextChannelId:
    string | null = null;

  try {
    discordSdk =
      new DiscordSDK(
        clientId,
      );

    await discordSdk.ready();

    contextGuildId =
      discordSdk.guildId ??
      null;

    contextChannelId =
      discordSdk.channelId ??
      null;

    /*
     * OAuthより先にRenderを起こします。
     * これにより429でも日次集計は実行できます。
     */
    void notifyBackendAwake(
      contextGuildId,
      contextChannelId,
    );

    let auth =
      await authenticateWithCachedToken();

    if (!auth) {
      const cooldown =
        oauthCooldownUntil();

      if (
        cooldown >
        Date.now()
      ) {
        const minutes =
          Math.max(
            1,
            Math.ceil(
              (cooldown -
                Date.now()) /
                60000,
            ),
          );

        throw new Error(
          `Discord認証APIが一時制限中です。再試行を抑えるため約${minutes}分は新しいToken交換を行いません。ゲーム画面と昨日の結果公開はこの制限と分離して動作します。`,
        );
      }

      const authorizeResult =
        await discordSdk.commands.authorize({
          client_id:
            clientId,
          response_type:
            "code",
          state:
            "",
          prompt:
            "none",
          scope: [
            "identify",
            "guilds",
            "applications.commands",
            "rpc.activities.write",
          ],
        });

      if (
        !authorizeResult.code
      ) {
        throw new Error(
          "Discord認証コードが返されませんでした。",
        );
      }

      const tokenResponse =
        await fetch(
          "/data/oauth/token",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                code:
                  authorizeResult.code,
              }),
          },
        );

      const tokenText =
        await tokenResponse.text();

      if (
        tokenResponse.status ===
        429
      ) {
        /*
         * 今回のCloudflare/IP一時制限は短時間の再試行で悪化します。
         * 1時間は新規交換を止めます。
         */
        setOAuthCooldown(
          60 * 60 * 1000,
        );

        throw new Error(
          `DiscordのToken交換が一時制限されています（HTTP 429）。再試行を1時間抑制しました。昨日の結果公開はOAuthとは別経路で実行されます。応答: ${tokenText.slice(0, 220)}`,
        );
      }

      if (
        !tokenResponse.ok
      ) {
        throw new Error(
          `Token交換失敗 HTTP ${tokenResponse.status}: ${tokenText}`,
        );
      }

      let tokenData:
        {
          access_token?: string;
          expires_in?: number;
        };

      try {
        tokenData =
          JSON.parse(
            tokenText,
          );
      } catch {
        throw new Error(
          `Token APIからJSON以外が返りました: ${tokenText.slice(0, 300)}`,
        );
      }

      if (
        !tokenData.access_token
      ) {
        throw new Error(
          "Token APIからaccess_tokenが返されませんでした。",
        );
      }

      activeAccessToken =
        tokenData.access_token;

      writeTokenCache(
        tokenData.access_token,
        Number(
          tokenData.expires_in,
        ) ||
          60 * 60,
      );

      clearOAuthCooldown();

      auth =
        await discordSdk.commands.authenticate({
          access_token:
            tokenData.access_token,
        });
    }

    if (!auth?.user) {
      throw new Error(
        "Discordユーザー情報を取得できませんでした。",
      );
    }

    const user =
      auth.user as DiscordUser;

    const dataSession =
      await ensureKotobaruSession(
        contextGuildId,
        activeAccessToken,
        user,
      );

    return {
      user:
        dataSession?.user ||
        user,
      guildId:
        contextGuildId,
      channelId:
        contextChannelId,
      accessToken:
        activeAccessToken,
      sessionToken:
        dataSession?.sessionToken ||
        null,
      error:
        dataSession
          ? null
          : "D1保存用セッションを取得できませんでした。ゲームは端末保存で継続します。",
    };
  } catch (error) {
    const message =
      errorToText(error);

    console.error(
      "Discord接続エラー:",
      message,
    );

    const cachedSession =
      readKotobaruSession(
        contextGuildId,
      );

    if (cachedSession) {
      console.warn(
        "Discord OAuthに失敗しましたが、既存のことばルセッションでゲームを継続します。",
      );

      return {
        user:
          cachedSession.user,
        guildId:
          contextGuildId,
        channelId:
          contextChannelId,
        accessToken: null,
        sessionToken:
          cachedSession.sessionToken,
        error:
          `${message}\n保存・復元はD1セッションで継続できます。`,
      };
    }

    return {
      user: null,
      guildId:
        contextGuildId,
      channelId:
        contextChannelId,
      accessToken: null,
      sessionToken: null,
      error: message,
    };
  }
}

/* =========================================================
 * 同じActivityに参加している人
 * ======================================================= */

export async function getDiscordParticipants(): Promise<DiscordParticipant[]> {
  if (!discordSdk) {
    return [];
  }

  try {
    const response =
      await discordSdk.commands
        .getInstanceConnectedParticipants();

    return (
      response.participants ??
      []
    ) as DiscordParticipant[];
  } catch (error) {
    console.warn(
      "参加者一覧を取得できませんでした。",
      errorToText(error),
    );

    return [];
  }
}

/* =========================================================
 * 参加者数の変化を監視
 * ======================================================= */

export function subscribeDiscordParticipants(
  callback:
    (
      participants:
        DiscordParticipant[],
    ) => void,
): () => void {
  if (!discordSdk) {
    return () => {};
  }

  const handler = (
    payload: {
      participants?:
        DiscordParticipant[];
    },
  ) => {
    callback(
      payload.participants ??
        [],
    );
  };

  void discordSdk.subscribe(
    Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE,
    handler,
  );

  return () => {
    if (!discordSdk) {
      return;
    }

    void discordSdk.unsubscribe(
      Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE,
      handler,
    );
  };
}

/* =========================================================
 * Discord上の「今何をしているか」を日本語化
 * ======================================================= */

export async function updateKotobaruPresence(
  presence:
    KotobaruPresence,
): Promise<void> {
  if (!discordSdk) {
    return;
  }

  const participantText =
    presence.participantCount > 1
      ? `${presence.participantCount}人が参加中`
      : "ことばを考え中";

  let details =
    `第${presence.puzzleNumber}問に挑戦中`;

  if (presence.finished) {
    details =
      presence.won
        ? `第${presence.puzzleNumber}問を${presence.attempts}回で正解`
        : `第${presence.puzzleNumber}問に挑戦済み`;
  }

  try {
    await discordSdk.commands.setActivity({
      activity: {
        type: 0,
        details,
        state:
          participantText,
      },
    });
  } catch (error) {
    console.warn(
      "Discordの挑戦状況表示を更新できませんでした。",
      errorToText(error),
    );
  }
}
