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
  import.meta.env
    .VITE_DISCORD_CLIENT_ID;

/* =========================================================
 * Discord SDK
 * ======================================================= */

const discordSdk =
  clientId
    ? new DiscordSDK(
        clientId
      )
    : null;

/* =========================================================
 * Discord接続
 * ======================================================= */

export async function connectDiscord(): Promise<DiscordConnection> {
  /*
   * 普通のブラウザから開いた場合など、
   * Application IDがなければDiscord接続しません。
   */
  if (!discordSdk) {
    return {
      user: null,
      guildId: null,
      channelId: null,
    };
  }

  try {
    /*
     * Discord Activity SDK準備完了まで待つ
     */
    await discordSdk.ready();

    /*
     * Discordから認証コードを取得
     */
    const {
      code,
    } =
      await discordSdk.commands.authorize(
        {
          client_id:
            clientId,

          response_type:
            "code",

          state: "",

          prompt:
            "none",

          scope: [
            "identify",
          ],
        }
      );

    /*
     * 認証コードを本番サーバーへ送る
     *
     * ここが今回変更した部分です。
     *
     * /api/token
     * ではなく
     * /api/kotobaru/token
     */
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
              code,
            }),
        }
      );

    if (
      !tokenResponse.ok
    ) {
      throw new Error(
        `OAuth token error: ${tokenResponse.status}`
      );
    }

    const tokenData =
      await tokenResponse.json();

    /*
     * Discord Activity側へ
     * Access Tokenを渡して認証完了
     */
    const auth =
      await discordSdk.commands.authenticate(
        {
          access_token:
            tokenData.access_token,
        }
      );

    if (!auth) {
      throw new Error(
        "Discord authenticate failed"
      );
    }

    /*
     * guildId / channelId は
     * Activity起動コンテキストから取得。
     */
    return {
      user:
        auth.user as DiscordUser,

      guildId:
        discordSdk.guildId ??
        null,

      channelId:
        discordSdk.channelId ??
        null,
    };
  } catch (error) {
    console.warn(
      "Discordとの接続に失敗しました。",
      error
    );

    /*
     * Discord接続に失敗しても
     * ゲーム単体は遊べるようにする。
     */
    return {
      user: null,
      guildId: null,
      channelId: null,
    };
  }
}