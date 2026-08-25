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
 * 待機
 * ======================================================= */

function sleep(
  milliseconds: number,
) {
  return new Promise<void>(
    (resolve) => {
      window.setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}

/* =========================================================
 * Renderを先に起こす
 *
 * 無料Renderがスリープしている場合、
 * OAuthコードを取得する前にHTTP通信を送って
 * サーバーを起動しておきます。
 * ======================================================= */

async function wakeBackend():
  Promise<boolean> {

  /*
   * 最大6回確認します。
   *
   * 1回目でRenderが寝ていても、
   * 起動するまで少し待ちます。
   */
  for (
    let attempt = 1;
    attempt <= 6;
    attempt += 1
  ) {
    try {
      console.log(
        `Render起動確認 ${attempt}/6`,
      );

      const response =
        await fetch(
          "/api/kotobaru/health",
          {
            method:
              "GET",

            cache:
              "no-store",
          },
        );

      if (response.ok) {
        console.log(
          "Renderへの接続を確認しました。",
        );

        return true;
      }

    } catch (error) {
      console.log(
        "Render起動待機中…",
        error,
      );
    }

    /*
     * 次の確認まで5秒待つ
     */
    await sleep(
      5000,
    );
  }

  console.warn(
    "Renderへの接続確認に時間がかかっています。",
  );

  return false;
}

/* =========================================================
 * Discord接続
 * ======================================================= */

export async function connectDiscord():
  Promise<DiscordConnection> {

  /*
   * Cloudflareを普通のChrome等で
   * 開いた場合。
   */
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
    };
  }

  if (!clientId) {
    console.warn(
      "VITE_DISCORD_CLIENT_ID が設定されていません。",
    );

    return {
      user: null,
      guildId: null,
      channelId: null,
    };
  }

  try {
    /* =====================================================
     * 重要：
     * OAuth認証より前にRenderを起こす
     * =================================================== */

    await wakeBackend();

    /* =====================================================
     * Discord SDK
     * =================================================== */

    const discordSdk =
      new DiscordSDK(
        clientId,
      );

    await discordSdk.ready();

    /* =====================================================
     * OAuthコード取得
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

    /* =====================================================
     * RenderでOAuthコード交換
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
        `OAuthエラー: ${tokenResponse.status} ${text}`,
      );
    }

    const tokenData =
      await tokenResponse.json();

    if (
      !tokenData.access_token
    ) {
      throw new Error(
        "アクセストークンを取得できませんでした。",
      );
    }

    /* =====================================================
     * Discord認証完了
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
    );

    return {
      user,

      guildId:
        discordSdk.guildId ??
        null,

      channelId:
        discordSdk.channelId ??
        null,
    };

  } catch (error) {
    console.error(
      "Discord接続エラー:",
      error,
    );

    return {
      user: null,
      guildId: null,
      channelId: null,
    };
  }
}