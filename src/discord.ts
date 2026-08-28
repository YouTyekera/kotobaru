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
  error: string | null;
};

export type KotobaruPresence = {
  puzzleNumber: number;
  participantCount: number;
  finished: boolean;
  won: boolean;
  attempts: number;
};

/* =========================================================
 * Discord Application ID
 * ======================================================= */

const clientId =
  import.meta.env.VITE_DISCORD_CLIENT_ID;

const TOKEN_CACHE_KEY =
  "kotobaru-discord-access-token";

let discordSdk:
  | DiscordSDK
  | null = null;

/* =========================================================
 * Discord Activity内か確認
 * ======================================================= */

export function isDiscordActivityEnvironment():
  boolean {

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
    return (
      `${error.name}: ${error.message}`
    );
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
 * Renderを起こす
 * ======================================================= */

async function wakeBackend():
  Promise<void> {

  try {
    const response =
      await fetch(
        "/api/kotobaru/health",
        {
          method: "GET",
          cache: "no-store",
        },
      );

    console.log(
      "Render health:",
      response.status,
    );
  } catch (error) {
    /*
     * ここで失敗してもOAuth自体は試します。
     */
    console.warn(
      "Render health確認失敗:",
      errorToText(error),
    );
  }
}

/* =========================================================
 * Activityが開いたことをRenderへ伝える
 *
 * Discord標準の高速起動では一時的にゲーム招待カードが作られます。
 * SDKのREADYまで到達した時点でguild/channelは分かるため、
 * OAuth完了を待たずにRenderへ通知してカード整理を始めます。
 * ======================================================= */

async function notifyBackendAwake(
  guildId: string | null,
  channelId: string | null,
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
          body: JSON.stringify({
            guildId,
            channelId,
          }),
        },
      );

    console.log(
      "Render awake:",
      response.status,
    );
  } catch (error) {
    console.warn(
      "Render awake通知失敗:",
      errorToText(error),
    );
  }
}

/* =========================================================
 * キャッシュ済みAccess Tokenで認証
 *
 * Activityを開き直すたびにOAuth Token交換を行わず、
 * 同一セッション内では既存Tokenを再利用します。
 * Discord APIの429対策にもなります。
 * ======================================================= */

async function authenticateWithCachedToken() {
  if (!discordSdk) {
    return null;
  }

  const cached =
    sessionStorage.getItem(
      TOKEN_CACHE_KEY,
    );

  if (!cached) {
    return null;
  }

  try {
    const auth =
      await discordSdk.commands.authenticate({
        access_token: cached,
      });

    if (auth?.user) {
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

  sessionStorage.removeItem(
    TOKEN_CACHE_KEY,
  );

  return null;
}

/* =========================================================
 * Discord接続
 * ======================================================= */

export async function connectDiscord():
  Promise<DiscordConnection> {

  if (
    !isDiscordActivityEnvironment()
  ) {
    return {
      user: null,
      guildId: null,
      channelId: null,
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
      error: message,
    };
  }

  try {
    await wakeBackend();

    discordSdk =
      new DiscordSDK(
        clientId,
      );

    await discordSdk.ready();

    /*
     * Renderが起動したら、OAuthより先に起動カード整理を開始します。
     * これによりDiscord APIの429等で認証が遅れても、
     * チャンネルには不要な起動カードが残りにくくなります。
     */
    await notifyBackendAwake(
      discordSdk.guildId ?? null,
      discordSdk.channelId ?? null,
    );

    let auth =
      await authenticateWithCachedToken();

    if (!auth) {
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
          "/api/kotobaru/token",
          {
            method:
              "POST",

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
        !tokenResponse.ok
      ) {
        throw new Error(
          `Token交換失敗 HTTP ${tokenResponse.status}: ${tokenText}`,
        );
      }

      let tokenData:
        {
          access_token?: string;
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

      sessionStorage.setItem(
        TOKEN_CACHE_KEY,
        tokenData.access_token,
      );

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

    return {
      user,

      guildId:
        discordSdk.guildId ??
        null,

      channelId:
        discordSdk.channelId ??
        null,

      error: null,
    };

  } catch (error) {
    const message =
      errorToText(
        error,
      );

    console.error(
      "Discord接続エラー:",
      message,
    );

    return {
      user: null,
      guildId: null,
      channelId: null,
      error: message,
    };
  }
}

/* =========================================================
 * 同じActivityに参加している人
 * ======================================================= */

export async function getDiscordParticipants():
  Promise<DiscordParticipant[]> {

  if (!discordSdk) {
    return [];
  }

  try {
    const response =
      await discordSdk.commands
        .getInstanceConnectedParticipants();

    return (response.participants ?? []) as DiscordParticipant[];
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
    /*
     * Rich Presenceが使えなくてもゲームには影響させません。
     */
    console.warn(
      "Discordの挑戦状況表示を更新できませんでした。",
      errorToText(error),
    );
  }
}
