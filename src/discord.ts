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

  return params.has(
    "frame_id",
  );
}

/* =========================================================
 * エラーを人間が読める文字列にする
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
    console.log(
      "Renderへの接続確認を開始します。",
    );

    /*
     * 現在のDiscord Activityでは
     * /api のURL Mappingを
     * そのまま利用できます。
     */
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
     * ここで失敗しても
     * Discord認証自体は続けます。
     */
    console.warn(
      "Render health確認失敗:",
      errorToText(error),
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
   * Client ID確認
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
     * 2. Discord SDK作成
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
     * 3. OAuth
     *
     * Discord公式チュートリアルに合わせて
     * 3つのscopeを要求します。
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
          "guilds",
          "applications.commands",
        ],
      });

    console.log(
      "authorize 成功",
    );

    if (
      !authorizeResult.code
    ) {
      throw new Error(
        "Discord認証コードが返されませんでした。",
      );
    }

    /* =====================================================
     * 4. RenderでToken交換
     * =================================================== */

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

    console.log(
      "Access Token取得成功",
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
        "authenticate後にDiscordユーザーを取得できませんでした。",
      );
    }

    const user =
      auth.user as DiscordUser;

    console.log(
      "Discord接続成功:",
      user.username,
      user.id,
    );

    console.log(
      "guildId:",
      discordSdk.guildId,
    );

    console.log(
      "channelId:",
      discordSdk.channelId,
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
      errorToText(
        error,
      );

    console.error(
      "Discord接続エラー:",
      message,
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