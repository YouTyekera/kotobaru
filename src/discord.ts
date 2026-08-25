import {
  DiscordSDK,
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

export type DiscordConnection = {
  user: DiscordUser | null;
  guildId: string | null;
  channelId: string | null;

  /*
   * 接続できなかった理由を
   * App.tsx側にも渡します。
   */
  error: string | null;
};

/* =========================================================
 * Discord Application ID
 * ======================================================= */

const clientId =
  import.meta.env.VITE_DISCORD_CLIENT_ID;

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

  /*
   * Discord Activityから起動された場合、
   * frame_id が付与されます。
   */
  return params.has(
    "frame_id",
  );
}

/* =========================================================
 * Renderを先に起こす
 *
 * Discord Activityでは
 *
 * /.proxy/api/...
 *
 * を使ってURL Mappingを通します。
 * ======================================================= */

async function wakeBackend():
  Promise<void> {

  try {
    console.log(
      "Renderの起動確認を開始します。",
    );

    const response =
      await fetch(
        "/.proxy/api/kotobaru/health",
        {
          method: "GET",
          cache: "no-store",
        },
      );

    if (!response.ok) {
      console.warn(
        "Render health確認失敗:",
        response.status,
      );

      return;
    }

    const data =
      await response.json();

    console.log(
      "Render接続確認:",
      data,
    );
  } catch (error) {
    /*
     * health確認に失敗しても、
     * OAuth自体は試します。
     */
    console.warn(
      "Render起動確認エラー:",
      error,
    );
  }
}

/* =========================================================
 * Discord接続
 * ======================================================= */

export async function connectDiscord():
  Promise<DiscordConnection> {

  /* ---------------------------------------------------------
   * 普通のブラウザ
   * ------------------------------------------------------- */

  if (
    !isDiscordActivityEnvironment()
  ) {
    console.log(
      "通常ブラウザモードで起動しました。",
    );

    return {
      user: null,
      guildId: null,
      channelId: null,
      error: null,
    };
  }

  /* ---------------------------------------------------------
   * Client IDなし
   * ------------------------------------------------------- */

  if (!clientId) {
    const message =
      "VITE_DISCORD_CLIENT_ID が設定されていません。";

    console.error(
      message,
    );

    return {
      user: null,
      guildId: null,
      channelId: null,
      error: message,
    };
  }

  try {
    /* =====================================================
     * 1. Renderを起こす
     * =================================================== */

    await wakeBackend();

    /* =====================================================
     * 2. Discord SDK
     * =================================================== */

    const discordSdk =
      new DiscordSDK(
        clientId,
      );

    await discordSdk.ready();

    console.log(
      "Discord SDK ready",
    );

    /* =====================================================
     * 3. OAuth認証コード取得
     * =================================================== */

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
        ],
      });

    if (
      !authorizeResult.code
    ) {
      throw new Error(
        "Discord認証コードを取得できませんでした。",
      );
    }

    console.log(
      "Discord認証コード取得成功",
    );

    /* =====================================================
     * 4. RenderでAccess Tokenに交換
     *
     * IMPORTANT:
     *
     * /api/... ではなく
     * /.proxy/api/...
     *
     * を使用します。
     * =================================================== */

    const tokenResponse =
      await fetch(
        "/.proxy/api/kotobaru/token",
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

    if (
      !tokenResponse.ok
    ) {
      const text =
        await tokenResponse
          .text()
          .catch(
            () => "",
          );

      throw new Error(
        `OAuth Token交換失敗: HTTP ${tokenResponse.status} ${text}`,
      );
    }

    const tokenData =
      await tokenResponse.json();

    if (
      !tokenData.access_token
    ) {
      throw new Error(
        "Renderからアクセストークンが返されませんでした。",
      );
    }

    console.log(
      "Discord Access Token取得成功",
    );

    /* =====================================================
     * 5. Discord認証完了
     * =================================================== */

    const auth =
      await discordSdk.commands.authenticate({
        access_token:
          tokenData.access_token,
      });

    if (!auth?.user) {
      throw new Error(
        "Discordユーザー情報を取得できませんでした。",
      );
    }

    const user =
      auth.user as DiscordUser;

    console.log(
      "Discord接続成功:",
      user.username,
      user.id,
    );

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
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      "Discord接続エラー:",
      error,
    );

    return {
      user: null,
      guildId: null,
      channelId: null,
      error: message,
    };
  }
}