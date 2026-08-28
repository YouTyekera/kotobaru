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
  type TileState,
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

type KeyUsage = {
  used: boolean;

  state:
    | 'correct'
    | 'present'
    | 'absent'
    | null;

  /*
   * 薄紫になった位置。
   *
   * 例：
   * [1, 4]
   *
   * → その文字を1文字目・4文字目で
   *   入れた際に同じ行だった
   */
  nearPositions: number[];
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

const EXTRA_KEYS =
  [
    'が',
    'ぎ',
    'ぐ',
    'げ',
    'ご',

    'ざ',
    'じ',
    'ず',
    'ぜ',
    'ぞ',

    'だ',
    'ぢ',
    'づ',
    'で',
    'ど',

    'ば',
    'び',
    'ぶ',
    'べ',
    'ぼ',

    'ぱ',
    'ぴ',
    'ぷ',
    'ぺ',
    'ぽ',

    'ぁ',
    'ぃ',
    'ぅ',
    'ぇ',
    'ぉ',

    'ゃ',
    'ゅ',
    'ょ',
    'っ',
    'ー',
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

    usage
      ?.nearPositions
      .length
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

      {!!usage
        ?.nearPositions
        .length && (
        <span className="near-position-list">
          {usage
            .nearPositions
            .map(
              (
                position,
              ) => (
                <span
                  key={
                    position
                  }
                  className="near-position-badge"
                >
                  {
                    position
                  }
                </span>
              ),
            )}
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
             * Renderを起こし、昨日の結果が未投稿なら確認します。
             */
            try {
              const response =
                await fetch(
                  '/api/kotobaru/awake',
                  {
                    method:
                      'POST',

                    headers: {
                      'Content-Type':
                        'application/json',
                    },

                    body:
                      JSON.stringify({
                        guildId:
                          discord.guildId,

                        channelId:
                          discord.channelId,
                      }),
                  },
                );

              console.log(
                'ことばル起動確認:',
                response.status,
              );
            } catch (
              error
            ) {
              console.warn(
                '起動確認通信失敗:',
                error,
              );
            }

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
   * ユーザーが確定したら
   * その人専用の盤面を復元
   * ======================================================= */

  useEffect(() => {
    if (
      !answer ||
      !discordIdentityReady
    ) {
      return;
    }

    /*
     * Discord Activityなのに
     * ユーザーIDが取得できていない場合は
     * 誰のデータか分からないため
     * 永続データを読みません。
     */
    if (!storageKey) {
      setGuesses([]);
      setFinished(false);
      setWon(false);

      return;
    }

    const raw =
      localStorage.getItem(
        storageKey,
      );

    /*
     * 新しいユーザーなら
     * 空の盤面から開始。
     */
    if (!raw) {
      setGuesses([]);
      setFinished(false);
      setWon(false);

      return;
    }

    try {
      const saved =
        JSON.parse(
          raw,
        ) as SavedGame;

      if (
        saved.date ===
        dateKey
      ) {
        setGuesses(
          saved.guesses,
        );

        setFinished(
          saved.finished,
        );

        setWon(
          saved.won,
        );
      } else {
        /*
         * 昨日のデータだったら
         * 今日の盤面を初期化。
         */
        setGuesses([]);
        setFinished(false);
        setWon(false);
      }
    } catch {
      console.warn(
        '保存済みゲームデータを読み込めませんでした。',
      );

      setGuesses([]);
      setFinished(false);
      setWon(false);
    }
  }, [
    answer,
    dateKey,
    storageKey,
    discordIdentityReady,
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
            index,
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
                nearPositions:
                  [],
              };

            current.used =
              true;

            /*
             * 紫は位置依存。
             */
            if (
              tile.state ===
              'near'
            ) {
              const position =
                index + 1;

              if (
                !current
                  .nearPositions
                  .includes(
                    position,
                  )
              ) {
                current
                  .nearPositions
                  .push(
                    position,
                  );
              }
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
        !guildId
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
            '/api/kotobaru/progress',
            {
              method:
                'POST',

              headers: {
                'Content-Type':
                  'application/json',
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
            '途中経過の共有に失敗しました:',
            response.status,
            await response
              .text()
              .catch(
                () => '',
              ),
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
        !guildId
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
              '/api/kotobaru/result',
              {
                method:
                  'POST',

                headers: {
                  'Content-Type':
                    'application/json',
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
            console.log(
              'ことばル結果保存成功',
            );

            setSaveStatus(
              'saved',
            );

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

  if (!answer) {
    return (
      <main className="app">
        <div className="loading">
          ことばを準備しています…
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
            同じ位置・同じ行
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
            <div className="extra-keyboard">
              {EXTRA_KEYS.map(
                (
                  char,
                ) => (
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
            紫の①〜⑤は、その位置で同じ五十音行だったことを示します
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

              その位置の正解文字と同じ五十音行
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