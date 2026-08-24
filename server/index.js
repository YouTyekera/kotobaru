import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import {
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

const PORT = Number(process.env.PORT || 3001);
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;

// v0.2までの手動ID設定も、移行用フォールバックとして残します。
const LEGACY_LOG_CHANNEL_ID = process.env.KOTOBARU_LOG_CHANNEL_ID;
const LEGACY_SUMMARY_CHANNEL_ID =
  process.env.KOTOBARU_SUMMARY_CHANNEL_ID;

const app = express();

app.use(cors());
app.use(express.json({ limit: '100kb' }));

const bot = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const RECORD_PREFIX = 'KOTOBARU_RECORD:';
const CONFIG_TOPIC_PREFIX = 'KOTOBARU_LOG_CHANNEL:';

// guildId -> {
//   guildId,
//   logChannelId,
//   summaryChannelId
// }
const guildConfigs = new Map();

/* =========================================================
 * 日付処理
 * ======================================================= */

function jstDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function previousJstDateKey() {
  const today = jstDateKey();
  const [year, month, day] = today.split('-').map(Number);

  return jstDateKey(
    new Date(
      Date.UTC(
        year,
        month - 1,
        day - 1,
        12,
        0,
        0,
      ),
    ),
  );
}

/* =========================================================
 * 結果データ検証
 * ======================================================= */

function validateResult(body) {
  if (!body || typeof body !== 'object') {
    return false;
  }

  const requiredStrings = [
    'guildId',
    'userId',
    'displayName',
    'date',
  ];

  if (
    requiredStrings.some(
      (key) =>
        typeof body[key] !== 'string' ||
        body[key].trim() === '',
    )
  ) {
    return false;
  }

  if (
    !Number.isInteger(body.puzzleNumber) ||
    body.puzzleNumber < 1
  ) {
    return false;
  }

  if (typeof body.won !== 'boolean') {
    return false;
  }

  if (
    body.attempts !== null &&
    (
      !Number.isInteger(body.attempts) ||
      body.attempts < 1 ||
      body.attempts > 6
    )
  ) {
    return false;
  }

  if (
    !Array.isArray(body.pattern) ||
    body.pattern.length < 1 ||
    body.pattern.length > 6
  ) {
    return false;
  }

  return body.pattern.every(
    (row) =>
      typeof row === 'string' &&
      /^[🟩🟨🟪⬛]{5}$/u.test(row),
  );
}

/* =========================================================
 * Discordチャンネルトピックから設定を復元
 * ======================================================= */

function configFromTopic(channel) {
  if (channel.type !== ChannelType.GuildText) {
    return null;
  }

  const topic = channel.topic || '';

  if (!topic.startsWith(CONFIG_TOPIC_PREFIX)) {
    return null;
  }

  const summaryChannelId = topic
    .slice(CONFIG_TOPIC_PREFIX.length)
    .split(/\s|\|/)[0]
    ?.trim();

  if (!summaryChannelId) {
    return null;
  }

  return {
    guildId: channel.guildId,
    logChannelId: channel.id,
    summaryChannelId,
  };
}

async function refreshGuildConfig(guild) {
  await guild.channels.fetch().catch(() => null);

  for (const channel of guild.channels.cache.values()) {
    const config = configFromTopic(channel);

    if (config) {
      guildConfigs.set(guild.id, config);
      return config;
    }
  }

  // 旧バージョン用フォールバック
  if (
    LEGACY_LOG_CHANNEL_ID &&
    LEGACY_SUMMARY_CHANNEL_ID
  ) {
    const logChannel =
      guild.channels.cache.get(
        LEGACY_LOG_CHANNEL_ID,
      );

    const summaryChannel =
      guild.channels.cache.get(
        LEGACY_SUMMARY_CHANNEL_ID,
      );

    if (
      logChannel?.guildId === guild.id &&
      summaryChannel?.guildId === guild.id
    ) {
      const config = {
        guildId: guild.id,
        logChannelId:
          LEGACY_LOG_CHANNEL_ID,
        summaryChannelId:
          LEGACY_SUMMARY_CHANNEL_ID,
      };

      guildConfigs.set(guild.id, config);

      return config;
    }
  }

  guildConfigs.delete(guild.id);

  return null;
}

async function getGuildConfig(guildId) {
  const cached =
    guildConfigs.get(guildId);

  if (cached) {
    return cached;
  }

  const guild =
    await bot.guilds
      .fetch(guildId)
      .catch(() => null);

  if (!guild) {
    return null;
  }

  return refreshGuildConfig(guild);
}

async function getTextChannel(channelId) {
  if (!channelId) {
    return null;
  }

  const channel =
    await bot.channels
      .fetch(channelId)
      .catch(() => null);

  return channel?.isTextBased()
    ? channel
    : null;
}

/* =========================================================
 * DiscordチャンネルをDB代わりに使う処理
 * ======================================================= */

async function fetchAllRecentMessages(
  channel,
  max = 1000,
) {
  const result = [];
  let before;

  while (result.length < max) {
    const batch =
      await channel.messages.fetch({
        limit: 100,
        ...(before
          ? { before }
          : {}),
      });

    if (!batch.size) {
      break;
    }

    result.push(...batch.values());

    before =
      batch.last()?.id;

    if (batch.size < 100) {
      break;
    }
  }

  return result;
}

async function loadResultsForDate(
  guildId,
  date,
) {
  const config =
    await getGuildConfig(guildId);

  if (!config) {
    return [];
  }

  const channel =
    await getTextChannel(
      config.logChannelId,
    );

  if (
    !channel ||
    !('messages' in channel)
  ) {
    return [];
  }

  const messages =
    await fetchAllRecentMessages(
      channel,
    );

  const byUser =
    new Map();

  for (const message of messages) {
    if (
      !message.author.bot ||
      !message.content.startsWith(
        RECORD_PREFIX,
      )
    ) {
      continue;
    }

    try {
      const record =
        JSON.parse(
          message.content.slice(
            RECORD_PREFIX.length,
          ),
        );

      if (
        record.guildId !== guildId ||
        record.date !== date
      ) {
        continue;
      }

      if (
        !byUser.has(
          record.userId,
        )
      ) {
        byUser.set(
          record.userId,
          record,
        );
      }
    } catch {
      // 壊れた記録は無視
    }
  }

  return [...byUser.values()];
}

/* =========================================================
 * 昨日の結果を投稿
 * ======================================================= */

async function postSummaryForGuild(
  guildId,
  date = previousJstDateKey(),
) {
  const config =
    await getGuildConfig(guildId);

  if (!config) {
    return false;
  }

  const records =
    await loadResultsForDate(
      guildId,
      date,
    );

  if (!records.length) {
    return false;
  }

  const summaryChannel =
    await getTextChannel(
      config.summaryChannelId,
    );

  if (
    !summaryChannel ||
    !('send' in summaryChannel)
  ) {
    return false;
  }

  const puzzleNumber =
    Math.max(
      ...records.map(
        (record) =>
          record.puzzleNumber,
      ),
    );

  const sorted =
    records.sort((a, b) => {
      if (a.won !== b.won) {
        return a.won
          ? -1
          : 1;
      }

      if (!a.won) {
        return 0;
      }

      return (
        a.attempts -
        b.attempts
      );
    });

  const fields =
    sorted
      .slice(0, 20)
      .map(
        (
          record,
          index,
        ) => ({
          name: `${
            index === 0 &&
            record.won
              ? '👑 '
              : ''
          }${record.displayName}　${
            record.won
              ? `${record.attempts}/6`
              : '×/6'
          }`,
          value:
            record.pattern.join(
              '\n',
            ),
          inline: true,
        }),
      );

  const embed =
    new EmbedBuilder()
      .setTitle(
        `ことばル 第${puzzleNumber}問　昨日の結果`,
      )
      .setDescription(
        `${sorted.length}人が挑戦しました。今日の問題も公開されています。`,
      )
      .addFields(fields)
      .setFooter({
        text: date,
      });

  await summaryChannel.send({
    content:
      '**今日のことばルも遊べます！**',
    embeds: [embed],
  });

  return true;
}

async function postYesterdaySummary() {
  const date =
    previousJstDateKey();

  for (
    const guild of
    bot.guilds.cache.values()
  ) {
    await postSummaryForGuild(
      guild.id,
      date,
    ).catch((error) => {
      console.error(
        `ことばル集計エラー (${guild.id}):`,
        error,
      );
    });
  }
}

/* =========================================================
 * /ことばル設定
 * ======================================================= */

async function createOrUpdateKotobaruSetup(
  interaction,
) {
  if (
    !interaction.guild ||
    !interaction.channel ||
    interaction.channel.type !==
      ChannelType.GuildText
  ) {
    await interaction.reply({
      content:
        'サーバーのテキストチャンネルで実行してください。',
      ephemeral: true,
    });

    return;
  }

  if (
    !interaction
      .memberPermissions
      ?.has(
        PermissionFlagsBits.ManageChannels,
      )
  ) {
    await interaction.reply({
      content:
        'この設定には「チャンネルの管理」権限が必要です。',
      ephemeral: true,
    });

    return;
  }

  await interaction.deferReply({
    ephemeral: true,
  });

  const guild =
    interaction.guild;

  const summaryChannel =
    interaction.channel;

  const currentConfig =
    await refreshGuildConfig(
      guild,
    );

  let logChannel =
    currentConfig
      ? guild.channels.cache.get(
          currentConfig.logChannelId,
        )
      : null;

  if (
    !logChannel ||
    logChannel.type !==
      ChannelType.GuildText
  ) {
    const everyoneRole =
      guild.roles.everyone;

    logChannel =
      await guild.channels.create({
        name: 'ことばル-記録',

        type:
          ChannelType.GuildText,

        parent:
          summaryChannel.parentId ??
          undefined,

        topic:
          `${CONFIG_TOPIC_PREFIX}${summaryChannel.id} | ことばルの結果記録用`,

        permissionOverwrites: [
          {
            id: everyoneRole.id,
            deny: [
              PermissionFlagsBits.ViewChannel,
            ],
          },
          {
            id: bot.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageChannels,
            ],
          },
        ],

        reason:
          'ことばルの結果を一時保存するため',
      });
  } else {
    await logChannel.setTopic(
      `${CONFIG_TOPIC_PREFIX}${summaryChannel.id} | ことばルの結果記録用`,
      'ことばルの結果表示先を変更',
    );
  }

  guildConfigs.set(
    guild.id,
    {
      guildId:
        guild.id,

      logChannelId:
        logChannel.id,

      summaryChannelId:
        summaryChannel.id,
    },
  );

  await interaction.editReply(
    [
      'ことばルの設定が完了しました。',
      `・昨日の結果：${summaryChannel}`,
      `・記録用：${logChannel}`,
      '',
      '記録用チャンネルは一般メンバーから非表示です。',
    ].join('\n'),
  );
}

async function showKotobaruSetup(
  interaction,
) {
  if (!interaction.guild) {
    await interaction.reply({
      content:
        'サーバー内で実行してください。',
      ephemeral: true,
    });

    return;
  }

  const config =
    await refreshGuildConfig(
      interaction.guild,
    );

  if (!config) {
    await interaction.reply({
      content:
        'まだ設定されていません。結果を表示したいチャンネルで `/ことばル設定` を実行してください。',
      ephemeral: true,
    });

    return;
  }

  await interaction.reply({
    content: [
      '現在の設定',
      `・昨日の結果：<#${config.summaryChannelId}>`,
      `・記録用：<#${config.logChannelId}>`,
    ].join('\n'),

    ephemeral: true,
  });
}

/* =========================================================
 * スラッシュコマンド定義
 * ======================================================= */

const slashCommands = [
  new SlashCommandBuilder()
    .setName('ことばル設定')
    .setDescription(
      'このチャンネルを「昨日の結果」の投稿先に設定します',
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageChannels,
    ),

  new SlashCommandBuilder()
    .setName(
      'ことばル設定確認',
    )
    .setDescription(
      'ことばルの現在のチャンネル設定を確認します',
    ),

  new SlashCommandBuilder()
    .setName(
      'ことばル集計テスト',
    )
    .setDescription(
      '昨日の結果の集計をテスト投稿します',
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageChannels,
    ),
].map(
  (command) =>
    command.toJSON(),
);

/* =========================================================
 * スラッシュコマンド登録
 * ======================================================= */

async function registerGuildCommands() {
  for (
    const guild of
    bot.guilds.cache.values()
  ) {
    try {
      await guild.commands.set(
        slashCommands,
      );

      console.log(
        `ことばルコマンド同期完了: ${guild.name} (${guild.id})`,
      );
    } catch (error) {
      console.error(
        `ことばルコマンド同期エラー: ${guild.name} (${guild.id})`,
        error,
      );
    }
  }
}

/* =========================================================
 * コマンド実行処理
 * ======================================================= */

bot.on(
  Events.InteractionCreate,
  async (interaction) => {
    if (
      !interaction.isChatInputCommand()
    ) {
      return;
    }

    try {
      if (
        interaction.commandName ===
        'ことばル設定'
      ) {
        await createOrUpdateKotobaruSetup(
          interaction,
        );

        return;
      }

      if (
        interaction.commandName ===
        'ことばル設定確認'
      ) {
        await showKotobaruSetup(
          interaction,
        );

        return;
      }

      if (
        interaction.commandName ===
        'ことばル集計テスト'
      ) {
        if (!interaction.guild) {
          await interaction.reply({
            content:
              'サーバー内で実行してください。',
            ephemeral: true,
          });

          return;
        }

        await interaction.deferReply({
          ephemeral: true,
        });

        const posted =
          await postSummaryForGuild(
            interaction.guild.id,
          );

        await interaction.editReply(
          posted
            ? '前日の結果を投稿しました。'
            : '前日分の記録が見つかりませんでした。',
        );
      }
    } catch (error) {
      console.error(
        'ことばルコマンド処理エラー:',
        error,
      );

      const message =
        '処理中にエラーが発生しました。Botの権限と設定を確認してください。';

      if (
        interaction.deferred ||
        interaction.replied
      ) {
        await interaction
          .editReply(message)
          .catch(() => null);
      } else {
        await interaction
          .reply({
            content: message,
            ephemeral: true,
          })
          .catch(() => null);
      }
    }
  },
);

/* =========================================================
 * HTTP API
 * ======================================================= */

app.get(
  '/health',
  (_req, res) => {
    res.json({
      ok: true,
      service: 'kotobaru',
      discordReady:
        bot.isReady(),
    });
  },
);

app.post(
  '/api/token',
  async (req, res) => {
    if (
      !DISCORD_CLIENT_ID ||
      !DISCORD_CLIENT_SECRET
    ) {
      return res
        .status(503)
        .json({
          error:
            'Discord OAuth is not configured',
        });
    }

    const code =
      req.body?.code;

    if (
      typeof code !==
        'string' ||
      !code
    ) {
      return res
        .status(400)
        .json({
          error:
            'code is required',
        });
    }

    try {
      const response =
        await fetch(
          'https://discord.com/api/oauth2/token',
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/x-www-form-urlencoded',
            },

            body:
              new URLSearchParams({
                client_id:
                  DISCORD_CLIENT_ID,

                client_secret:
                  DISCORD_CLIENT_SECRET,

                grant_type:
                  'authorization_code',

                code,
              }),
          },
        );

      const data =
        await response.json();

      if (!response.ok) {
        return res
          .status(
            response.status,
          )
          .json(data);
      }

      return res.json({
        access_token:
          data.access_token,
      });
    } catch (error) {
      console.error(
        'Discord OAuth token exchange error:',
        error,
      );

      return res
        .status(500)
        .json({
          error:
            'token exchange failed',
        });
    }
  },
);

app.post(
  '/api/kotobaru/result',
  async (req, res) => {
    if (
      !validateResult(
        req.body,
      )
    ) {
      return res
        .status(400)
        .json({
          error:
            'invalid result',
        });
    }

    if (!bot.isReady()) {
      return res
        .status(503)
        .json({
          error:
            'Discord bot is not ready',
        });
    }

    const config =
      await getGuildConfig(
        req.body.guildId,
      );

    if (!config) {
      return res
        .status(503)
        .json({
          error:
            'kotobaru is not configured for this guild',
        });
    }

    const channel =
      await getTextChannel(
        config.logChannelId,
      );

    if (
      !channel ||
      !('send' in channel)
    ) {
      return res
        .status(503)
        .json({
          error:
            'log channel is not available',
        });
    }

    // Discordチャンネルを一時DBとして使用。
    // 入力単語や正解語そのものは保存しません。
    const record = {
      guildId:
        req.body.guildId,

      userId:
        req.body.userId,

      displayName:
        req.body.displayName.slice(
          0,
          80,
        ),

      puzzleNumber:
        req.body.puzzleNumber,

      date:
        req.body.date,

      attempts:
        req.body.attempts,

      won:
        req.body.won,

      pattern:
        req.body.pattern,

      savedAt:
        new Date().toISOString(),
    };

    await channel.send(
      `${RECORD_PREFIX}${JSON.stringify(
        record,
      )}`,
    );

    return res.json({
      ok: true,
    });
  },
);

app.post(
  '/api/kotobaru/summary-now',
  async (req, res) => {
    if (
      process.env.NODE_ENV ===
      'production'
    ) {
      return res
        .status(404)
        .end();
    }

    const guildId =
      req.body?.guildId;

    if (
      typeof guildId !==
        'string' ||
      !guildId
    ) {
      return res
        .status(400)
        .json({
          error:
            'guildId is required',
        });
    }

    const posted =
      await postSummaryForGuild(
        guildId,
      );

    return res.json({
      ok: true,
      posted,
    });
  },
);

/* =========================================================
 * 毎日0:05に前日の結果を投稿
 * ======================================================= */

cron.schedule(
  '5 0 * * *',
  () => {
    postYesterdaySummary().catch(
      (error) => {
        console.error(
          'ことばル日次集計エラー:',
          error,
        );
      },
    );
  },
  {
    timezone:
      'Asia/Tokyo',
  },
);

/* =========================================================
 * Bot起動
 * ======================================================= */

if (DISCORD_TOKEN) {
  bot.once(
    Events.ClientReady,
    async (readyClient) => {
      console.log(
        `Discord bot ready: ${readyClient.user.tag}`,
      );

      // Bot参加中の各サーバーへ
      // Guild Commandとして即時登録
      await registerGuildCommands();

      // Discordチャンネルから設定を復元
      for (
        const guild of
        readyClient.guilds.cache.values()
      ) {
        await refreshGuildConfig(
          guild,
        ).catch((error) => {
          console.error(
            `ことばル設定復元エラー: ${guild.name}`,
            error,
          );
        });
      }
    },
  );

  // Botが新しいサーバーに追加された場合
  bot.on(
    Events.GuildCreate,
    async (guild) => {
      try {
        await guild.commands.set(
          slashCommands,
        );

        console.log(
          `新規サーバーへことばルコマンド同期完了: ${guild.name}`,
        );

        await refreshGuildConfig(
          guild,
        );
      } catch (error) {
        console.error(
          `新規サーバー初期化エラー: ${guild.name}`,
          error,
        );
      }
    },
  );

  bot.login(
    DISCORD_TOKEN,
  ).catch((error) => {
    console.error(
      'Discord Botログイン失敗:',
      error,
    );
  });
} else {
  console.warn(
    'DISCORD_TOKEN が未設定のため、Discord結果保存機能は停止しています。',
  );
}

/* =========================================================
 * HTTPサーバー起動
 * ======================================================= */

app.listen(
  PORT,
  () => {
    console.log(
      `ことばル server listening on :${PORT}`,
    );
  },
);