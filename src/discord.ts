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

  /*
   * Discord Activityとして起動された場合、
   * frame_id がURLに含まれます。
   *
   * CloudflareのURLを普通のブラウザで開いた場合は
   * frame_id がありません。
   */
  return params.has(
    "frame_id",
  );
}

/* =========================================================
 * Discord接続
 * ======================================================= */

export async function connectDiscord():
  Promise<DiscordConnection> {

  /*
   * 通常ブラウザの場合。
   *
   * DiscordSDKを生成すると
   * frame_id エラーになるため、
   * ここで終了します。
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

  /*
   * Application IDが設定されていない場合
   */
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
     * Discord SDK作成
     * =================================================== */

    const discordSdk =
      new DiscordSDK(
        clientId,
      );

    /*
     * Discord側の準備完了を待つ
     */
    await discordSdk.ready();

    /* =====================================================
     * Discord OAuth認証
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

    /*
     * Discordから認証コードを取得できなかった場合
     */
    if (
      !authorizeResult.code
    ) {
      throw new Error(
        "Discord認証コードを取得できませんでした。",
      );
    }

    /* =====================================================
     * Renderへ認証コードを渡す
     *
     * Discord URL Mapping：
     *
     * /api
     * ↓
     * relay-shogi-activity.onrender.com
     *
     * となっているため、
     * 相対URLで問題ありません。
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

    /* =====================================================
     * OAuth失敗
     * =================================================== */

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

    /*
     * RenderからAccess Tokenを取得できなかった場合
     */
    if (
      !tokenData.access_token
    ) {
      throw new Error(
        "アクセストークンを取得できませんでした。",
      );
    }

    /* =====================================================
     * Discord側で認証完了
     * =================================================== */

    const auth =
      await discordSdk.commands.authenticate({
        access_token:
          tokenData.access_token,
      });

    /*
     * ユーザー情報が取得できない場合
     */
    if (!auth?.user) {
      throw new Error(
        "Discordユーザー情報を取得できませんでした。",
      );
    }

    console.log(
      "Discord接続成功:",
      auth.user.username,
    );

    /* =====================================================
     * 接続情報をApp.tsxへ返す
     * =================================================== */

    const user =
      auth.user as DiscordUser;

    return {
      user:
        user,

      guildId:
        discordSdk.guildId ??
        null,

      channelId:
        discordSdk.channelId ??
        null,
    };

  } catch (error) {
    /*
     * Discord認証に失敗しても、
     * ことばルそのものは遊べるようにします。
     */
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