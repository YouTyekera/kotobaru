import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import {
  connectDiscord,
  getDiscordParticipants,
  isDiscordActivityEnvironment,
  subscribeDiscordParticipants,
  updateKotobaruPresence,
  type DiscordUser,
} from './discord';

import {
  evaluateGuess,
  jstDateKey,
  puzzleNumber,
  splitJapanese,
  tileStateToEmoji,
  toKatakana,
  type EvaluatedTile,
} from './game';

/* =========================================================
 * 型
 * ======================================================= */

type AnswerEntry = {
  display: string;
  reading: string;
};

type SavedGame = {
  date: string;
  guesses: string[];
  finished: boolean;
  won: boolean;
};

type RemoteGameState = {
  found: boolean;
  restorable: boolean;
  date?: string;
  puzzleNumber?: number;
  guesses?: string[];
  finished?: boolean;
  won?: boolean;
  updatedAt?: string | null;
};

type KeyUsage = {
  used: boolean;

  state:
    | 'correct'
    | 'present'
    | 'absent'
    | null;

  /*
   * この文字と同じ五十音行の文字が、
   * 正解のどこかにあることが分かったか。
   *
   * 新ルールでは位置に依存しないため、
   * ①〜⑤の位置情報は持ちません。
   */
  near: boolean;
};

type DiscordStatus =
  | 'browser'
  | 'connecting'
  | 'connected'
  | 'error';

type SaveStatus =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'error';

const ROWS = 6;

/* =========================================================
 * 五十音キーボード
 * ======================================================= */

const BASIC_KEYS:
  (string | null)[][] = [
  [
    'あ',
    'か',
    'さ',
    'た',
    'な',
    'は',
    'ま',
    'や',
    'ら',
    'わ',
  ],
  [
    'い',
    'き',
    'し',
    'ち',
    'に',
    'ひ',
    'み',
    null,
    'り',
    null,
  ],
  [
    'う',
    'く',
    'す',
    'つ',
    'ぬ',
    'ふ',
    'む',
    'ゆ',
    'る',
    'ん',
  ],
  [
    'え',
    'け',
    'せ',
    'て',
    'ね',
    'へ',
    'め',
    null,
    'れ',
    null,
  ],
  [
    'お',
    'こ',
    'そ',
    'と',
    'の',
    'ほ',
    'も',
    'よ',
    'ろ',
    'を',
  ],
];

const EXTRA_KEYS:
  (string | null)[][] = [
  /*
   * 基本文字と同じく、同じ「行」が縦に並ぶ配置。
   *
   * が ざ だ ば ぱ ぁ ゃ っ ー
   * ぎ じ ぢ び ぴ ぃ
   * ぐ ず づ ぶ ぷ ぅ ゅ
   * げ ぜ で べ ぺ ぇ
   * ご ぞ ど ぼ ぽ ぉ ょ
   *
   * 小書き文字は基本文字とは別の列として表示します。
   */
  [
    'が',
    'ざ',
    'だ',
    'ば',
    'ぱ',
    'ぁ',
    'ゃ',
    'っ',
    'ー',
  ],
  [
    'ぎ',
    'じ',
    'ぢ',
    'び',
    'ぴ',
    'ぃ',
    null,
    null,
    null,
  ],
  [
    'ぐ',
    'ず',
    'づ',
    'ぶ',
    'ぷ',
    'ぅ',
    'ゅ',
    null,
    null,
  ],
  [
    'げ',
    'ぜ',
    'で',
    'べ',
    'ぺ',
    'ぇ',
    null,
    null,
    null,
  ],
  [
    'ご',
    'ぞ',
    'ど',
    'ぼ',
    'ぽ',
    'ぉ',
    'ょ',
    null,
    null,
  ],
];

/* =========================================================
 * カタカナ → ひらがな
 * ======================================================= */

function toHiragana(
  value: string,
) {
  return value.replace(
    /[ァ-ヶ]/g,
    (char) =>
      String.fromCharCode(
        char.charCodeAt(0) -
          0x60,
      ),
  );
}

/* =========================================================
 * CSV
 * ======================================================= */

function parseAnswerCsv(
  text: string,
): AnswerEntry[] {
  return text
    .split(/\r?\n/)
    .map(
      (line) =>
        line.trim(),
    )
    .filter(Boolean)
    .map((line) => {
      const comma =
        line.indexOf(',');

      if (comma < 0) {
        return {
          display: line,

          reading:
            toKatakana(
              line,
            ),
        };
      }

      return {
        display:
          line.slice(
            0,
            comma,
          ),

        reading:
          toKatakana(
            line.slice(
              comma + 1,
            ),
          ),
      };
    })
    .filter(
      (entry) =>
        splitJapanese(
          entry.reading,
        ).length === 5,
    );
}

/* =========================================================
 * 盤面1行
 * ======================================================= */

function BoardRow({
  guess,
  answer,
  active,
  input,
}: {
  guess?: string;
  answer: string;
  active: boolean;
  input: string;
}) {
  const chars =
    guess
      ? splitJapanese(
          guess,
        )
      : active
        ? splitJapanese(
            input,
          )
        : [];

  const evaluated =
    guess
      ? evaluateGuess(
          answer,
          guess,
        )
      : null;

  return (
    <div className="board-row">
      {Array.from({
        length: 5,
      }).map(
        (_, index) => {
          const tile =
            evaluated?.[
              index
            ] as
              | EvaluatedTile
              | undefined;

          const character =
            chars[index]
              ? toHiragana(
                  chars[index],
                )
              : '';

          return (
            <div
              key={index}
              className={[
                'tile',
                tile?.state ??
                  '',
                guess
                  ? 'revealed'
                  : '',
              ]
                .filter(
                  Boolean,
                )
                .join(' ')}
              style={
                guess
                  ? {
                      animationDelay:
                        `${
                          index *
                          110
                        }ms`,
                    }
                  : undefined
              }
            >
              {character}
            </div>
          );
        },
      )}
    </div>
  );
}

/* =========================================================
 * キーボード1文字
 * ======================================================= */

function KanaKey({
  char,
  usage,
  onPress,
}: {
  char: string;
  usage?: KeyUsage;
  onPress:
    (
      char: string,
    ) => void;
}) {
  const classes = [
    'kana-key',

    usage?.state
      ? `key-${usage.state}`
      : '',

    usage?.used
      ? 'key-used'
      : '',

    usage?.near
      ? 'key-has-near'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      data-no-focus="true"
      onClick={() =>
        onPress(char)
      }
      aria-label={
        `${char}を入力`
      }
    >
      <span className="kana-key-char">
        {char}
      </span>

      {usage?.near && (
        <span className="near-position-list">
          <span className="near-position-badge">
            行
          </span>
        </span>
      )}
    </button>
  );
}

/* =========================================================
 * App
 * ======================================================= */

export default function App() {
  const inputRef =
    useRef<HTMLInputElement>(
      null,
    );

  /*
   * 公開Previewへ同じ盤面を何度も送らないための同期キー。
   * デプロイ後にActivityを開き直した場合も、現在の盤面を
   * 既存Previewへ上書きできるようにします。
   */
  const previewSyncRef =
    useRef<string>('');

  const insideDiscord =
    isDiscordActivityEnvironment();

  /* -------------------------
   * 辞書
   * ----------------------- */

  const [
    answers,
    setAnswers,
  ] = useState<
    AnswerEntry[]
  >([]);

  const [
    dictionary,
    setDictionary,
  ] = useState<
    Set<string>
  >(new Set());

  /* -------------------------
   * ゲーム
   * ----------------------- */

  const [
    input,
    setInput,
  ] = useState('');

  const [
    guesses,
    setGuesses,
  ] = useState<
    string[]
  >([]);

  const [
    message,
    setMessage,
  ] = useState('');

  const [
    finished,
    setFinished,
  ] = useState(false);

  const [
    won,
    setWon,
  ] = useState(false);

  const [
    isComposing,
    setIsComposing,
  ] = useState(false);

  const [
    showExtraKeys,
    setShowExtraKeys,
  ] = useState(false);

  const [
    showHelp,
    setShowHelp,
  ] = useState(false);

  const [
    showSettings,
    setShowSettings,
  ] = useState(false);

  /* -------------------------
   * Discord
   * ----------------------- */

  const [
    discordUser,
    setDiscordUser,
  ] =
    useState<
      DiscordUser | null
    >(null);

  const [
    guildId,
    setGuildId,
  ] =
    useState<
      string | null
    >(null);

  const [
    kotobaruSessionToken,
    setKotobaruSessionToken,
  ] =
    useState<
      string | null
    >(null);

  /*
   * localStorageが消えていても、Discord LOGから復元確認が終わるまでは
   * 空の盤面を「新規ゲーム」として見せません。
   */
  const [
    restoreReady,
    setRestoreReady,
  ] =
    useState(
      !insideDiscord,
    );

  const [
    discordStatus,
    setDiscordStatus,
  ] =
    useState<DiscordStatus>(
      insideDiscord
        ? 'connecting'
        : 'browser',
    );

  const [
    discordError,
    setDiscordError,
  ] =
    useState<string | null>(
      null,
    );

  const [
    discordIdentityReady,
    setDiscordIdentityReady,
  ] =
    useState(
      !insideDiscord,
    );

  const [
    saveStatus,
    setSaveStatus,
  ] =
    useState<SaveStatus>(
      'idle',
    );


  const [
    participantCount,
    setParticipantCount,
  ] = useState(0);

  /* =========================================================
   * 今日
   * ======================================================= */

  const number =
    puzzleNumber();

  const dateKey =
    jstDateKey();

  const answerEntry =
    answers.length
      ? answers[
          (number - 1) %
            answers.length
        ]
      : null;

  const answer =
    answerEntry
      ?.reading ?? '';

  /* =========================================================
   * ユーザー別localStorageキー
   *
   * Discord:
   *
   * kotobaru-today:user:123456...
   *
   * 通常ブラウザ:
   *
   * kotobaru-today:browser
   *
   * Discord認証失敗時はnull。
   * 他人の盤面を誤って復元しないためです。
   * ======================================================= */

  const storageKey =
    useMemo(
      () => {
        if (
          !insideDiscord
        ) {
          return (
            'kotobaru-today:browser'
          );
        }

        if (
          discordUser?.id
        ) {
          return (
            `kotobaru-today:user:${discordUser.id}`
          );
        }

        return null;
      },
      [
        insideDiscord,
        discordUser?.id,
      ],
    );

  /* =========================================================
   * 辞書読み込み
   * ======================================================= */

  useEffect(() => {
    Promise.all([
      fetch(
        './data/A_data_new.csv',
      ).then(
        (response) =>
          response.text(),
      ),

      fetch(
        './data/Q_fil_ippan.csv',
      ).then(
        (response) =>
          response.text(),
      ),
    ])
      .then(
        ([
          dictText,
          answerText,
        ]) => {
          const words =
            dictText
              .split(/\r?\n/)
              .map(
                (word) =>
                  toKatakana(
                    word.trim(),
                  ),
              )
              .filter(
                Boolean,
              );

          setDictionary(
            new Set(
              words,
            ),
          );

          setAnswers(
            parseAnswerCsv(
              answerText,
            ),
          );
        },
      )
      .catch(
        (error) => {
          console.error(
            '辞書読み込みエラー:',
            error,
          );

          setMessage(
            'ゲームの読み込みに失敗しました',
          );
        },
      );
  }, []);

  /* =========================================================
   * Discord接続・同じActivityの参加者監視
   * ======================================================= */

  useEffect(() => {
    let unsubscribeParticipants:
      (() => void) | null = null;

    let cancelled = false;

    if (
      !insideDiscord
    ) {
      setDiscordStatus(
        'browser',
      );

      setDiscordIdentityReady(
        true,
      );

      return;
    }

    setDiscordStatus(
      'connecting',
    );

    setDiscordError(
      null,
    );

    connectDiscord()
      .then(
        async (
          discord,
        ) => {
          if (cancelled) {
            return;
          }

          setDiscordUser(
            discord.user,
          );

          setGuildId(
            discord.guildId,
          );

          setKotobaruSessionToken(
            discord.sessionToken,
          );

          setDiscordError(
            discord.error,
          );

          setDiscordIdentityReady(
            true,
          );

          if (
            discord.user &&
            discord.guildId
          ) {
            setDiscordStatus(
              'connected',
            );

            /*
             * 同じActivityに現在参加している人数を取得。
             * Discord側の挑戦状況表示にも利用します。
             */
            const participants =
              await getDiscordParticipants();

            if (!cancelled) {
              setParticipantCount(
                participants.length,
              );
            }

            unsubscribeParticipants =
              subscribeDiscordParticipants(
                (
                  nextParticipants,
                ) => {
                  if (!cancelled) {
                    setParticipantCount(
                      nextParticipants.length,
                    );
                  }
                },
              );

            /*
             * Render起床・昨日の結果確認はdiscord.ts側で
             * OAuthより前に実行します。
             * 429時でも日次集計を止めないため、ここでは重複送信しません。
             */

          } else {
            setDiscordStatus(
              'error',
            );
          }
        },
      )
      .catch(
        (error) => {
          if (cancelled) {
            return;
          }

          console.error(
            'Discord接続処理エラー:',
            error,
          );

          setDiscordError(
            error instanceof Error
              ? error.message
              : String(error),
          );

          setDiscordStatus(
            'error',
          );

          setDiscordIdentityReady(
            true,
          );
        },
      );

    return () => {
      cancelled = true;

      if (
        unsubscribeParticipants
      ) {
        unsubscribeParticipants();
      }
    };
  }, [
    insideDiscord,
  ]);

  /* =========================================================
   * Discordの挑戦状況表示
   * ======================================================= */

  useEffect(() => {
    if (
      discordStatus !==
        'connected'
    ) {
      return;
    }

    void updateKotobaruPresence({
      puzzleNumber:
        number,

      participantCount:
        Math.max(
          1,
          participantCount,
        ),

      finished,
      won,

      attempts:
        guesses.length,
    });
  }, [
    discordStatus,
    number,
    participantCount,
    finished,
    won,
    guesses.length,
  ]);

  /* =========================================================
   * 盤面復元
   *
   * 1. localStorageに残っていれば即座に表示
   * 2. Discord ActivityではサーバーLOGも確認
   * 3. 両方にある場合は「回答数が多い方」を採用
   * 4. 同数なら終了済みを優先
   *
   * Discord内のlocalStorageが消えたり別コンテキストになっても、
   * KOTOBARU_PROGRESSの暗号化LOGから復元できます。
   * ======================================================= */

  useEffect(() => {
    if (
      !answer ||
      !discordIdentityReady
    ) {
      return;
    }

    let cancelled =
      false;

    const applySavedGame = (
      saved:
        SavedGame,
    ) => {
      if (cancelled) {
        return;
      }

      setGuesses(
        saved.guesses,
      );

      setFinished(
        saved.finished,
      );

      setWon(
        saved.won,
      );
    };

    const localGame = (():
      SavedGame | null => {
      if (!storageKey) {
        return null;
      }

      const raw =
        localStorage.getItem(
          storageKey,
        );

      if (!raw) {
        return null;
      }

      try {
        const saved =
          JSON.parse(
            raw,
          ) as SavedGame;

        if (
          saved.date !==
            dateKey ||
          !Array.isArray(
            saved.guesses,
          )
        ) {
          return null;
        }

        return saved;
      } catch {
        console.warn(
          '端末内の保存データを読み込めませんでした。',
        );

        return null;
      }
    })();

    /*
     * 端末側に残っていれば、サーバー確認を待たず即復元します。
     */
    if (localGame) {
      applySavedGame(
        localGame,
      );

      setRestoreReady(
        true,
      );
    } else if (
      !insideDiscord
    ) {
      setGuesses([]);
      setFinished(false);
      setWon(false);
      setRestoreReady(
        true,
      );

      return () => {
        cancelled = true;
      };
    } else {
      /*
       * Discord内で端末保存が消えている場合、
       * LOG確認が終わるまで空盤面を表示しません。
       */
      setRestoreReady(
        false,
      );
    }

    const restoreFromServer =
      async () => {
        if (
          !insideDiscord ||
          !discordUser ||
          !guildId ||
          !kotobaruSessionToken
        ) {
          if (
            !localGame &&
            !cancelled
          ) {
            setGuesses([]);
            setFinished(false);
            setWon(false);
            setRestoreReady(
              true,
            );
          }

          return;
        }

        let remote:
          RemoteGameState | null =
            null;

        let remoteRequestCompleted =
          false;

        /*
         * Render起床直後も考慮し、短い再試行を行います。
         * 盤面を失ったように見える時間をできるだけ短くしつつ、
         * 一時的な通信失敗で新規ゲーム扱いにしないためです。
         */
        for (
          let attempt = 1;
          attempt <= 4;
          attempt += 1
        ) {
          try {
            const response =
              await fetch(
                '/data/state',
                {
                  method:
                    'POST',

                  headers: {
                    'Content-Type':
                      'application/json',

                    Authorization:
                      `Bearer ${kotobaruSessionToken}`,
                  },

                  body:
                    JSON.stringify({
                      guildId,
                      date:
                        dateKey,
                      puzzleNumber:
                        number,
                    }),
                },
              );

            if (
              response.ok
            ) {
              remoteRequestCompleted =
                true;

              remote =
                await response.json() as
                  RemoteGameState;

              break;
            }

            console.warn(
              `保存盤面の取得失敗 ${attempt}/4:`,
              response.status,
            );
          } catch (
            error
          ) {
            console.warn(
              `保存盤面の取得通信失敗 ${attempt}/4:`,
              error,
            );
          }

          if (
            attempt < 4
          ) {
            await new Promise<void>(
              (resolve) => {
                window.setTimeout(
                  resolve,
                  1200,
                );
              },
            );
          }
        }

        if (cancelled) {
          return;
        }

        /*
         * サーバー確認中にユーザーが回答を進めた可能性もあるため、
         * 比較直前にlocalStorageをもう一度読みます。
         */
        let chosen =
          localGame;

        if (storageKey) {
          const latestRaw =
            localStorage.getItem(
              storageKey,
            );

          if (latestRaw) {
            try {
              const latestLocal =
                JSON.parse(
                  latestRaw,
                ) as SavedGame;

              if (
                latestLocal.date ===
                  dateKey &&
                Array.isArray(
                  latestLocal.guesses,
                )
              ) {
                chosen =
                  latestLocal;
              }
            } catch {
              // 初回に読めたデータをそのまま使います。
            }
          }
        }

        if (
          remote?.found &&
          remote.restorable &&
          remote.date ===
            dateKey &&
          Array.isArray(
            remote.guesses,
          )
        ) {
          const remoteGame:
            SavedGame = {
            date:
              dateKey,

            guesses:
              remote.guesses,

            finished:
              Boolean(
                remote.finished,
              ),

            won:
              Boolean(
                remote.won,
              ),
          };

          /*
           * より進んでいる方を正本にします。
           * 回答数が同じなら、終了済み状態を優先します。
           */
          const localLength =
            chosen?.guesses
              .length ?? -1;

          const remoteLength =
            remoteGame.guesses
              .length;

          if (
            !chosen ||
            remoteLength >
              localLength ||
            (
              remoteLength ===
                localLength &&
              remoteGame.finished &&
              !chosen.finished
            )
          ) {
            chosen =
              remoteGame;
          }
        }

        if (chosen) {
          applySavedGame(
            chosen,
          );

          /*
           * LOGから復元した場合はlocalStorageも再生します。
           * 次回は即座に盤面を出せます。
           */
          if (storageKey) {
            localStorage.setItem(
              storageKey,
              JSON.stringify(
                chosen,
              ),
            );
          }
        } else {
          setGuesses([]);
          setFinished(false);
          setWon(false);

          if (
            remote?.found &&
            !remote.restorable
          ) {
            setMessage(
              '前回の記録は見つかりましたが、旧形式のため盤面を復元できませんでした。',
            );
          } else if (
            !remoteRequestCompleted
          ) {
            setMessage(
              '前回の進行状況を確認できませんでした。通信状態によっては、開き直すと復元できる場合があります。',
            );
          }
        }

        setRestoreReady(
          true,
        );
      };

    void restoreFromServer();

    return () => {
      cancelled = true;
    };
  }, [
    answer,
    dateKey,
    number,
    storageKey,
    discordIdentityReady,
    insideDiscord,
    discordUser?.id,
    guildId,
    kotobaruSessionToken,
  ]);

  /* =========================================================
   * localStorage保存
   * ======================================================= */

  const save = (
    nextGuesses:
      string[],
    nextFinished:
      boolean,
    nextWon:
      boolean,
  ) => {
    /*
     * Discord認証失敗時は
     * アカウントを区別できないため
     * localStorageへ保存しません。
     */
    if (!storageKey) {
      return;
    }

    const data:
      SavedGame = {
      date:
        dateKey,

      guesses:
        nextGuesses,

      finished:
        nextFinished,

      won:
        nextWon,
    };

    localStorage.setItem(
      storageKey,
      JSON.stringify(
        data,
      ),
    );
  };

  /* =========================================================
   * 使用済み文字
   * ======================================================= */

  const keyUsage =
    useMemo(() => {
      const map =
        new Map<
          string,
          KeyUsage
        >();

      function priority(
        state:
          | 'correct'
          | 'present'
          | 'absent'
          | null,
      ) {
        if (
          state ===
          'correct'
        ) {
          return 3;
        }

        if (
          state ===
          'present'
        ) {
          return 2;
        }

        if (
          state ===
          'absent'
        ) {
          return 1;
        }

        return 0;
      }

      for (
        const guess of
        guesses
      ) {
        const evaluated =
          evaluateGuess(
            answer,
            guess,
          );

        evaluated.forEach(
          (
            tile,
          ) => {
            const key =
              toKatakana(
                tile.char,
              );

            const current =
              map.get(
                key,
              ) ?? {
                used: false,
                state: null,
                near: false,
              };

            current.used =
              true;

            /*
             * 紫は「正解のどこかに同じ五十音行がある」ヒント。
             * 位置情報は持たず、1度でも紫になれば「行」バッジを表示します。
             */
            if (
              tile.state ===
              'near'
            ) {
              current.near =
                true;
            }

            /*
             * 緑・黄・灰は
             * キー本体の色に使用。
             */
            if (
              tile.state ===
                'correct' ||
              tile.state ===
                'present' ||
              tile.state ===
                'absent'
            ) {
              if (
                priority(
                  tile.state,
                ) >
                priority(
                  current.state,
                )
              ) {
                current.state =
                  tile.state;
              }
            }

            map.set(
              key,
              current,
            );
          },
        );
      }

      return map;
    }, [
      guesses,
      answer,
    ]);

  /* =========================================================
   * Discordチャンネルへ途中経過を反映
   *
   * 正解の文字そのものは送らず、色の並びだけを送ります。
   * 同じチャンネルの人は、誰が何手目まで進んだかを
   * 本家Wordleに近い形で見ることができます。
   * ======================================================= */

  const submitProgress =
    async (
      nextGuesses:
        string[],
      didFinish:
        boolean,
      didWin:
        boolean,
    ) => {
      if (
        !discordUser ||
        !guildId ||
        !kotobaruSessionToken
      ) {
        return;
      }

      const syncKey =
        [
          discordUser.id,
          dateKey,
          number,
          nextGuesses.join('|'),
          didFinish
            ? 'finished'
            : 'playing',
          didWin
            ? 'won'
            : 'not-won',
        ].join(':');

      previewSyncRef.current =
        syncKey;

      const pattern =
        nextGuesses.map(
          (guess) =>
            evaluateGuess(
              answer,
              guess,
            )
              .map(
                (tile) =>
                  tileStateToEmoji(
                    tile.state,
                  ),
              )
              .join(''),
        );

      try {
        const response =
          await fetch(
            '/data/progress',
            {
              method:
                'POST',

              headers: {
                'Content-Type':
                  'application/json',
                Authorization:
                  `Bearer ${kotobaruSessionToken}`,
              },

              body:
                JSON.stringify({
                  guildId,

                  userId:
                    discordUser.id,

                  displayName:
                    discordUser
                      .global_name ||
                    discordUser
                      .username,

                  avatarHash:
                    discordUser.avatar ??
                    null,

                  puzzleNumber:
                    number,

                  date:
                    dateKey,

                  attempts:
                    didWin
                      ? nextGuesses.length
                      : null,

                  won:
                    didWin,

                  finished:
                    didFinish,

                  pattern,

                  /*
                   * Render側で直ちに暗号化し、
                   * Discord LOGには平文を保存しません。
                   */
                  guesses:
                    nextGuesses,
                }),
            },
          );

        if (!response.ok) {
          console.warn(
            '途中経過のD1保存に失敗しました:',
            response.status,
            await response
              .text()
              .catch(
                () => '',
              ),
          );
          return;
        }

        const stored =
          await response.json() as {
            sessionId?: string;
          };

        /*
         * D1保存を先に確定し、Discord Previewは後追い同期。
         * Render/Discordが制限中でもゲームデータは失いません。
         */
        if (stored.sessionId) {
          void fetch(
            '/api/kotobaru/preview-sync',
            {
              method: 'POST',
              headers: {
                'Content-Type':
                  'application/json',
              },
              body:
                JSON.stringify({
                  guildId,
                  date: dateKey,
                  puzzleNumber: number,
                  sessionId:
                    stored.sessionId,
                }),
            },
          ).catch(
            () => null,
          );
        }
      } catch (error) {
        console.warn(
          '途中経過の共有通信に失敗しました:',
          error,
        );
      }
    };

  /* =========================================================
   * 既存Previewを現在の盤面で再同期
   *
   * コード更新後にActivityを開き直したとき、過去のPreviewを
   * 新しい画像形式へ「上書き」するための処理です。
   * ======================================================= */

  useEffect(() => {
    if (
      !discordUser ||
      !guildId ||
      !answer ||
      guesses.length === 0
    ) {
      return;
    }

    const didWin =
      guesses[
        guesses.length - 1
      ] === answer;

    const didFinish =
      didWin ||
      guesses.length >= ROWS;

    const syncKey =
      [
        discordUser.id,
        dateKey,
        number,
        guesses.join('|'),
        didFinish
          ? 'finished'
          : 'playing',
        didWin
          ? 'won'
          : 'not-won',
      ].join(':');

    if (
      previewSyncRef.current ===
      syncKey
    ) {
      return;
    }

    previewSyncRef.current =
      syncKey;

    void submitProgress(
      guesses,
      didFinish,
      didWin,
    );
  }, [
    discordUser?.id,
    guildId,
    answer,
    dateKey,
    number,
    guesses,
  ]);

  /* =========================================================
   * Discord結果保存
   * ======================================================= */

  const submitResult =
    async (
      nextGuesses:
        string[],
      didWin:
        boolean,
    ) => {
      if (
        !discordUser ||
        !guildId ||
        !kotobaruSessionToken
      ) {
        console.warn(
          'Discordユーザーを取得できていないため結果送信を省略します。',
        );

        setSaveStatus(
          'error',
        );

        return;
      }

      const pattern =
        nextGuesses.map(
          (guess) =>
            evaluateGuess(
              answer,
              guess,
            )
              .map(
                (tile) =>
                  tileStateToEmoji(
                    tile.state,
                  ),
              )
              .join(''),
        );

      const payload = {
        guildId,

        userId:
          discordUser.id,

        displayName:
          discordUser
            .global_name ||
          discordUser
            .username,

        avatarHash:
          discordUser.avatar ??
          null,

        puzzleNumber:
          number,

        date:
          dateKey,

        attempts:
          didWin
            ? nextGuesses
                .length
            : null,

        won:
          didWin,

        pattern,

        /*
         * 翌日の「使ったことば」表示用。
         * サーバー側でAES暗号化してからLOGへ保存します。
         */
        guesses:
          nextGuesses,
      };

      setSaveStatus(
        'saving',
      );

      /*
       * Renderの起動待ちも考慮し、
       * 最大5回再試行。
       */
      for (
        let attempt = 1;
        attempt <= 5;
        attempt += 1
      ) {
        try {
          const response =
            await fetch(
              '/data/result',
              {
                method:
                  'POST',

                headers: {
                  'Content-Type':
                    'application/json',
                  Authorization:
                    `Bearer ${kotobaruSessionToken}`,
                },

                body:
                  JSON.stringify(
                    payload,
                  ),
              },
            );

          if (
            response.ok
          ) {
            const stored =
              await response.json() as {
                sessionId?: string;
              };

            console.log(
              'ことばル結果をD1へ保存しました',
            );

            setSaveStatus(
              'saved',
            );

            if (stored.sessionId) {
              void fetch(
                '/api/kotobaru/preview-sync',
                {
                  method: 'POST',
                  headers: {
                    'Content-Type':
                      'application/json',
                  },
                  body:
                    JSON.stringify({
                      guildId,
                      date: dateKey,
                      puzzleNumber: number,
                      sessionId:
                        stored.sessionId,
                    }),
                },
              ).catch(
                () => null,
              );
            }

            return;
          }

          console.warn(
            `結果保存失敗 ${attempt}/5`,
            response.status,
            await response
              .text()
              .catch(
                () => '',
              ),
          );

        } catch (
          error
        ) {
          console.warn(
            `結果送信失敗 ${attempt}/5`,
            error,
          );
        }

        if (
          attempt < 5
        ) {
          await new Promise<void>(
            (resolve) => {
              window.setTimeout(
                resolve,
                4000,
              );
            },
          );
        }
      }

      setSaveStatus(
        'error',
      );
    };

  /* =========================================================
   * 入力欄へフォーカス
   * ======================================================= */

  const focusInput =
    () => {
      if (finished) {
        return;
      }

      inputRef
        .current
        ?.focus();
    };

  /* =========================================================
   * 回答
   * ======================================================= */

  const submit = async () => {
    if (
      !answer ||
      finished
    ) {
      return;
    }

    const normalized =
      toKatakana(
        input,
      );

    if (
      splitJapanese(
        normalized,
      ).length !== 5
    ) {
      setMessage(
        '5文字入力してください',
      );

      focusInput();

      return;
    }

    if (
      !dictionary.has(
        normalized,
      )
    ) {
      setMessage(
        '辞書にないことばです',
      );

      focusInput();

      return;
    }

    const nextGuesses = [
      ...guesses,
      normalized,
    ];

    const didWin =
      normalized ===
      answer;

    const didFinish =
      didWin ||
      nextGuesses.length >=
        ROWS;

    setGuesses(
      nextGuesses,
    );

    setInput('');

    setMessage('');

    setWon(
      didWin,
    );

    setFinished(
      didFinish,
    );

    save(
      nextGuesses,
      didFinish,
      didWin,
    );

    /*
     * 重要：終了時は /progress と /result を同時に送らない。
     *
     * 以前は最終手で2本のリクエストを同時送信していたため、
     * Render再起動直後などに別々のsessionIdを掴み、
     * 「結果は保存済みなのにPreviewだけ挑戦中」の状態が
     * 残る可能性がありました。
     *
     * 終了時は /result だけを正本として送ります。
     * /result 側で進捗LOG・終了済みキャッシュ・Previewを
     * まとめて確定します。
     */
    if (
      didFinish
    ) {
      const finalSyncKey =
        [
          discordUser?.id ?? 'unknown',
          dateKey,
          number,
          nextGuesses.join('|'),
          'finished',
          didWin
            ? 'won'
            : 'not-won',
        ].join(':');

      /*
       * setGuesses後の再同期useEffectが同時に/progressを
       * 送らないよう、先に最終状態の同期キーを確定します。
       */
      previewSyncRef.current =
        finalSyncKey;

      await submitResult(
        nextGuesses,
        didWin,
      );
    } else {
      /*
       * プレイ途中だけ /progress を使います。
       */
      void submitProgress(
        nextGuesses,
        false,
        false,
      );

      window.setTimeout(
        focusInput,
        50,
      );
    }
  };

  /* =========================================================
   * IME
   * ======================================================= */

  const handleInputChange =
    (
      value:
        string,
    ) => {
      if (
        isComposing
      ) {
        setInput(
          value,
        );

        return;
      }

      setInput(
        Array.from(
          value,
        )
          .slice(
            0,
            5,
          )
          .join(''),
      );
    };

  /* =========================================================
   * 五十音キー入力
   * ======================================================= */

  const pressKanaKey =
    (
      char:
        string,
    ) => {
      if (
        finished
      ) {
        return;
      }

      const current =
        Array.from(
          input,
        );

      if (
        current.length >=
        5
      ) {
        focusInput();

        return;
      }

      setInput(
        [
          ...current,
          char,
        ].join(''),
      );

      window.setTimeout(
        focusInput,
        20,
      );
    };

  const backspace =
    () => {
      setInput(
        Array.from(
          input,
        )
          .slice(
            0,
            -1,
          )
          .join(''),
      );

      window.setTimeout(
        focusInput,
        20,
      );
    };

  /* =========================================================
   * 画面クリック
   * ======================================================= */

  const handleScreenClick =
    (
      event:
        ReactMouseEvent<
          HTMLElement
        >,
    ) => {
      const target =
        event.target;

      if (
        !(target instanceof
          HTMLElement)
      ) {
        return;
      }

      /*
       * ボタン・入力欄・モーダル等は除外。
       */
      if (
        target.closest(
          'button, input, [data-no-focus="true"]',
        )
      ) {
        return;
      }

      focusInput();
    };

  /* =========================================================
   * 盤面
   * ======================================================= */

  const boardRows =
    useMemo(
      () =>
        Array.from({
          length:
            ROWS,
        }),
      [],
    );

  /* =========================================================
   * Loading
   * ======================================================= */

  if (
    !answer ||
    !restoreReady
  ) {
    return (
      <main className="app">
        <div className="loading">
          {!answer
            ? 'ことばを準備しています…'
            : '前回の続きがないか確認しています…'}
        </div>
      </main>
    );
  }

  /* =========================================================
   * UI
   * ======================================================= */

  return (
    <main
      className="app"
      onClick={
        handleScreenClick
      }
    >
      <header className="header">
        <button
          className="icon-button"
          aria-label="遊び方"
          type="button"
          data-no-focus="true"
          onClick={() =>
            setShowHelp(
              true,
            )
          }
        >
          ？
        </button>

        <h1>
          ことばル
        </h1>

        <button
          className="icon-button"
          aria-label="設定"
          type="button"
          data-no-focus="true"
          onClick={() =>
            setShowSettings(
              true,
            )
          }
        >
          ⚙
        </button>
      </header>

      <section className="game-area">
        <div className="puzzle-label">
          第{number}問
        </div>

        {insideDiscord &&
          discordStatus ===
            'connected' &&
          participantCount > 0 && (
            <div className="participant-status">
              現在{participantCount}人が挑戦中
            </div>
          )}

        {/* 盤面 */}

        <div className="board">
          {boardRows.map(
            (
              _,
              row,
            ) => (
              <BoardRow
                key={
                  row
                }
                guess={
                  guesses[
                    row
                  ]
                }
                answer={
                  answer
                }
                active={
                  !finished &&
                  row ===
                    guesses.length
                }
                input={
                  input
                }
              />
            ),
          )}
        </div>

        {/* 凡例 */}

        <div className="legend">
          <span>
            <i className="legend-swatch correct" />
            文字・位置が一致
          </span>

          <span>
            <i className="legend-swatch present" />
            文字はある
          </span>

          <span>
            <i className="legend-swatch near" />
            同じ行の文字がある
          </span>

          <span>
            <i className="legend-swatch absent" />
            該当なし
          </span>
        </div>

        {message && (
          <div className="toast">
            {message}
          </div>
        )}

        {/* 結果 */}

        {finished && (
          <div className="result-card">
            <strong>
              {won
                ? `${guesses.length}回で正解！`
                : '今回は正解できませんでした'}
            </strong>

            <span>
              正解：
              {
                answerEntry
                  ?.display
              }

              {answerEntry
                ?.reading
                ? `（${toHiragana(
                    answerEntry.reading,
                  )}）`
                : ''}
            </span>

            {insideDiscord && (
              <span className="save-status">
                {saveStatus ===
                  'saving' &&
                  '結果をDiscordへ記録しています…'}

                {saveStatus ===
                  'saved' &&
                  '結果をDiscordへ記録しました'}

                {saveStatus ===
                  'error' &&
                  'Discordへの結果記録に失敗しました'}
              </span>
            )}
          </div>
        )}

        {/* 入力 */}

        {!finished && (
          <div className="input-panel">
            <input
              ref={
                inputRef
              }
              autoFocus
              value={
                input
              }
              onCompositionStart={() =>
                setIsComposing(
                  true,
                )
              }
              onCompositionEnd={(
                event,
              ) => {
                setIsComposing(
                  false,
                );

                setInput(
                  Array.from(
                    event
                      .currentTarget
                      .value,
                  )
                    .slice(
                      0,
                      5,
                    )
                    .join(''),
                );
              }}
              onChange={(
                event,
              ) =>
                handleInputChange(
                  event
                    .target
                    .value,
                )
              }
              onKeyDown={(
                event,
              ) => {
                if (
                  event.key ===
                    'Enter' &&
                  !isComposing
                ) {
                  submit();
                }
              }}
              placeholder="5文字のことば"
              aria-label="5文字のことばを入力"
            />

            <button
              type="button"
              onClick={
                submit
              }
            >
              決定
            </button>
          </div>
        )}

        {!finished && (
          <p className="hint">
            画面をクリックすると文字入力できます
          </p>
        )}

        {/* =================================================
            五十音キーボード
           =============================================== */}

        <section
          className="kana-keyboard"
          aria-label="使用した文字"
          data-no-focus="true"
        >
          <div className="keyboard-title-row">
            <span>
              使用した文字
            </span>

            <button
              type="button"
              className="keyboard-toggle"
              data-no-focus="true"
              onClick={() =>
                setShowExtraKeys(
                  (
                    value,
                  ) =>
                    !value,
                )
              }
            >
              {showExtraKeys
                ? '基本文字'
                : '濁音・小文字'}
            </button>
          </div>

          {!showExtraKeys && (
            <div className="basic-keyboard">
              {BASIC_KEYS.map(
                (
                  row,
                  rowIndex,
                ) => (
                  <div
                    className="kana-key-row"
                    key={
                      rowIndex
                    }
                  >
                    {row.map(
                      (
                        char,
                        index,
                      ) =>
                        char
                          ? (
                            <KanaKey
                              key={
                                char
                              }
                              char={
                                char
                              }
                              usage={
                                keyUsage.get(
                                  toKatakana(
                                    char,
                                  ),
                                )
                              }
                              onPress={
                                pressKanaKey
                              }
                            />
                          )
                          : (
                            <span
                              key={
                                `blank-${rowIndex}-${index}`
                              }
                              className="kana-key blank"
                            />
                          ),
                    )}
                  </div>
                ),
              )}
            </div>
          )}

          {showExtraKeys && (
            <div className="basic-keyboard extra-keyboard">
              {EXTRA_KEYS.map(
                (
                  row,
                  rowIndex,
                ) => (
                  <div
                    className="kana-key-row"
                    key={
                      `extra-row-${rowIndex}`
                    }
                  >
                    {row.map(
                      (
                        char,
                        index,
                      ) =>
                        char
                          ? (
                            <KanaKey
                              key={
                                char
                              }
                              char={
                                char
                              }
                              usage={
                                keyUsage.get(
                                  toKatakana(
                                    char,
                                  ),
                                )
                              }
                              onPress={
                                pressKanaKey
                              }
                            />
                          )
                          : (
                            <span
                              key={
                                `extra-blank-${rowIndex}-${index}`
                              }
                              className="kana-key blank"
                            />
                          ),
                    )}
                  </div>
                ),
              )}
            </div>
          )}

          {!finished && (
            <div className="keyboard-actions">
              <button
                type="button"
                data-no-focus="true"
                onClick={
                  backspace
                }
              >
                一字消す
              </button>

              <button
                type="button"
                className="keyboard-submit"
                data-no-focus="true"
                onClick={
                  submit
                }
              >
                決定
              </button>
            </div>
          )}

          <p className="near-key-help">
            紫の「行」は、正解のどこかに同じ行の文字があることを示します。基本文字と小文字は別扱いで、ぁぃぅぇぉ同士・ゃゅょ同士はそれぞれ小文字だけの行として判定します。濁音・半濁音も別の行です
          </p>
        </section>
      </section>

      {/* =================================================
          遊び方
         =============================================== */}

      {showHelp && (
        <div
          className="modal-backdrop"
          data-no-focus="true"
          onClick={() =>
            setShowHelp(
              false,
            )
          }
        >
          <div
            className="modal"
            onClick={(
              event,
            ) =>
              event
                .stopPropagation()
            }
          >
            <h2>
              遊び方
            </h2>

            <p>
              5文字のことばを6回以内に当ててください。
            </p>

            <div className="help-row">
              <span className="help-tile correct">
                あ
              </span>

              文字も位置も正しい
            </div>

            <div className="help-row">
              <span className="help-tile present">
                あ
              </span>

              文字は正解に含まれるが位置が違う
            </div>

            <div className="help-row">
              <span className="help-tile near">
                あ
              </span>

              正解のどこかに同じ行の文字がある。基本文字と小文字は別扱いで、ぁぃぅぇぉ同士・ゃゅょ同士はそれぞれ紫判定する
            </div>

            <div className="help-row">
              <span className="help-tile absent">
                あ
              </span>

              どれにも当てはまらない
            </div>

            <button
              type="button"
              onClick={() =>
                setShowHelp(
                  false,
                )
              }
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* =================================================
          設定
         =============================================== */}

      {showSettings && (
        <div
          className="modal-backdrop"
          data-no-focus="true"
          onClick={() =>
            setShowSettings(
              false,
            )
          }
        >
          <div
            className="modal"
            onClick={(
              event,
            ) =>
              event
                .stopPropagation()
            }
          >
            <h2>
              ことばル設定
            </h2>

            <p>
              Discord接続：
              {' '}

              {discordStatus ===
                'connected' &&
                '接続済み'}

              {discordStatus ===
                'connecting' &&
                '接続中…'}

              {discordStatus ===
                'browser' &&
                '通常の閲覧画面'}

              {discordStatus ===
                'error' &&
                '接続できませんでした'}
            </p>

            {discordUser && (
              <p>
                挑戦者：
                {' '}
                {discordUser
                  .global_name ||
                  discordUser
                    .username}
              </p>
            )}

            {discordError && (
              <div className="discord-error-box">
                <strong>
                  接続エラー
                </strong>

                <p>
                  {discordError}
                </p>
              </div>
            )}

            <p className="settings-note">
              Discord接続に成功すると、回答履歴はDiscordアカウントごとに別々に保存されます。
            </p>

            <p className="settings-note">
              通常の閲覧画面から開いた場合は、この端末専用の回答履歴を使用します。
            </p>

            <button
              type="button"
              onClick={() =>
                setShowSettings(
                  false,
                )
              }
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </main>
  );
}