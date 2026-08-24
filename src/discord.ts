import {
  DiscordSDK,
} from "@discord/embedded-app-sdk";

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

const clientId =
  import.meta.env.VITE_DISCORD_CLIENT_ID;

/* =========================================================
 * Discord Activity内かどうか確認
 * ======================================================= */

function isDiscordActivity(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const params =
    new URLSearchParams(
      window.location.search,
    );

  /*
   * Discord Activityとして起動された場合は、
   * frame_id が必ず渡されます。
   *
   * 通常ブラウザでworkers.devを開いた場合には
   * frame_idが存在しません。
   */
  return params.has("frame_id");
}

/* =========================================================
 * Discord接続
 * ======================================================= */

export async function connectDiscord():
  Promise<DiscordConnection> {

  /*
   * 普通のブラウザなら、
   * DiscordSDKを「生成すらしない」ことが重要です。
   */
  if (!isDiscordActivity()) {
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
    /*
     * ここまで来た場合だけDiscordSDKを生成。
     */
    const discordSdk =
      new DiscordSDK(clientId);

    await discordSdk.ready();

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

    if (!authorizeResult.code) {
      throw new Error(
        "Discord認証コードを取得できませんでした。",
      );
    }

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
              code:
                authorizeResult.code,
            }),
        },
      );

    if (!tokenResponse.ok) {
      const text =
        await tokenResponse
          .text()
          .catch(() => "");

      throw new Error(
        `OAuthエラー: ${tokenResponse.status} ${text}`,
      );
    }

    const tokenData =
      await tokenResponse.json();

    if (!tokenData.access_token) {
      throw new Error(
        "アクセストークンを取得できませんでした。",
      );
    }

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

    console.log(
      "Discord接続成功:",
      auth.user.username,
    );

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