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
 * 今Discord Activityの中にいるか判定
 * ======================================================= */

function isDiscordActivity() {
  /*
   * Discord Activityとして起動した場合、
   * DiscordからURLに以下のような情報が渡されます。
   *
   * frame_id
   * instance_id
   * platform
   *
   * 普通のChromeからworkers.devを開いた場合は
   * これらがありません。
   */

  if (typeof window === "undefined") {
    return false;
  }

  const params =
    new URLSearchParams(
      window.location.search,
    );

  return (
    params.has("frame_id") ||
    params.has("instance_id") ||
    params.has("platform")
  );
}

/* =========================================================
 * Discord接続
 * ======================================================= */

export async function connectDiscord():
  Promise<DiscordConnection> {

  /*
   * Application IDがない場合
   */
  if (!clientId) {
    console.log(
      "Discord Application IDがありません。通常ブラウザモードで起動します。",
    );

    return {
      user: null,
      guildId: null,
      channelId: null,
    };
  }

  /*
   * Discord Activityではなく、
   * Chromeなどから直接開いた場合。
   *
   * Discord SDKには接続せず、
   * 普通のWebゲームとして起動します。
   */
  if (!isDiscordActivity()) {
    console.log(
      "通常ブラウザから起動しました。Discord接続を省略します。",
    );

    return {
      user: null,
      guildId: null,
      channelId: null,
    };
  }

  try {
    /*
     * Discord Activityの中にいることを
     * 確認してからSDKを生成します。
     */
    const discordSdk =
      new DiscordSDK(clientId);

    /*
     * Discord SDKの準備完了を待つ
     */
    await discordSdk.ready();

    /*
     * DiscordからOAuth認証コードを取得
     */
    const authorizeResult =
      await discordSdk.commands.authorize({
        client_id: clientId,

        response_type: "code",

        state: "",

        prompt: "none",

        scope: [
          "identify",
        ],
      });

    const code =
      authorizeResult.code;

    if (!code) {
      throw new Error(
        "Discord認証コードを取得できませんでした。",
      );
    }

    /*
     * 認証コードをRenderへ送ります。
     *
     * Discord URL Mappingで
     *
     * /api
     * ↓
     * Render
     *
     * とする予定なので、
     * フロント側では相対URLのままでOKです。
     */
    const tokenResponse =
      await fetch(
        "/api/kotobaru/token",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              code,
            }),
        },
      );

    if (!tokenResponse.ok) {
      const errorText =
        await tokenResponse
          .text()
          .catch(() => "");

      throw new Error(
        `Discord OAuthに失敗しました: ${tokenResponse.status} ${errorText}`,
      );
    }

    const tokenData =
      await tokenResponse.json();

    if (!tokenData.access_token) {
      throw new Error(
        "Discord Access Tokenを取得できませんでした。",
      );
    }

    /*
     * Discord Activity側で認証完了
     */
    const auth =
      await discordSdk.commands.authenticate({
        access_token:
          tokenData.access_token,
      });

    if (!auth?.user) {
      throw new Error(
        "Discordユーザーを取得できませんでした。",
      );
    }

    console.log(
      "Discord接続成功:",
      auth.user.username,
    );

    return {
      user:
        auth.user as DiscordUser,

      guildId:
        discordSdk.guildId ?? null,

      channelId:
        discordSdk.channelId ?? null,
    };
  } catch (error) {
    /*
     * Discord接続に失敗しても、
     * ゲームそのものは遊べる状態を維持します。
     */
    console.error(
      "Discordとの接続に失敗しました。",
      error,
    );

    return {
      user: null,
      guildId: null,
      channelId: null,
    };
  }
}