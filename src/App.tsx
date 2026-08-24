import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  connectDiscord,
  isDiscordActivityEnvironment,
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

  /*
   * キー全体に付ける状態。
   *
   * nearは位置依存なので
   * ここには入れません。
   */
  state:
    | 'correct'
    | 'present'
    | 'absent'
    | null;

  /*
   * 薄紫になった位置。
   *
   * 例：
   * [1, 3]
   */
  nearPositions:
    number[];
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
 * 使用済み文字キーボード
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
      isDiscordActivityEnvironment()
        ? 'connecting'
        : 'browser',
    );

  const [
    saveStatus,
    setSaveStatus,
  ] =
    useState<SaveStatus>(
      'idle',
    );

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
   * 辞書を読み込む
   *
   * Discord接続とは分離します。
   *
   * Renderが起きるのを待っている間も
   * ゲーム画面は先に表示できます。
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
   * Discord接続
   * ======================================================= */

  useEffect(() => {
    if (
      !isDiscordActivityEnvironment()
    ) {
      setDiscordStatus(
        'browser',
      );

      return;
    }

    setDiscordStatus(
      'connecting',
    );

    connectDiscord()
      .then(
        async (
          discord,
        ) => {
          setDiscordUser(
            discord.user,
          );

          setGuildId(
            discord.guildId,
          );

          if (
            discord.user &&
            discord.guildId
          ) {
            setDiscordStatus(
              'connected',
            );

            /*
             * HTTP通信を1回送ることで
             * Renderが眠っていれば起こします。
             *
             * 同時に「昨日の結果」が
             * 未投稿なら投稿します。
             */
            fetch(
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
                  }),
              },
            ).catch(
              (error) => {
                console.warn(
                  'Render起動確認に失敗:',
                  error,
                );
              },
            );
          } else {
            setDiscordStatus(
              'error',
            );
          }
        },
      )
      .catch(
        (error) => {
          console.error(
            'Discord接続エラー:',
            error,
          );

          setDiscordStatus(
            'error',
          );
        },
      );
  }, []);

  /* =========================================================
   * 保存済みゲーム復元
   * ======================================================= */

  useEffect(() => {
    if (!answer) {
      return;
    }

    const raw =
      localStorage.getItem(
        'kotobaru-today',
      );

    if (!raw) {
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
      }
    } catch {
      console.warn(
        '保存済みゲームデータを読み込めませんでした。',
      );
    }
  }, [
    answer,
    dateKey,
  ]);

  /* =========================================================
   * localStorage
   * ======================================================= */

  const save = (
    nextGuesses:
      string[],
    nextFinished:
      boolean,
    nextWon:
      boolean,
  ) => {
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
      'kotobaru-today',
      JSON.stringify(
        data,
      ),
    );
  };

  /* =========================================================
   * 使用済み文字情報
   * ======================================================= */

  const keyUsage =
    useMemo(() => {
      const map =
        new Map<
          string,
          KeyUsage
        >();

      const priority:
        Record<
          Exclude<
            TileState,
            'near'
          >,
          number
        > = {
        absent: 1,
        present: 2,
        correct: 3,
      };

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
            } else {
              const nextState =
                tile.state;

              if (
                !current.state ||
                priority[
                  nextState
                ] >
                  priority[
                    current
                      .state
                  ]
              ) {
                current.state =
                  nextState;
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
   * Discord結果保存
   *
   * Render起動直後などを考えて
   * 数回再試行します。
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
      };

      setSaveStatus(
        'saving',
      );

      /*
       * 最大5回。
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
            setSaveStatus(
              'saved',
            );

            return;
          }

          console.warn(
            `結果保存失敗 ${attempt}/5`,
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
          await new Promise(
            (resolve) =>
              setTimeout(
                resolve,
                4000,
              ),
          );
        }
      }

      setSaveStatus(
        'error',
      );
    };

  /* =========================================================
   * 回答
   * ======================================================= */

  const submit = () => {
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

    if (
      didFinish
    ) {
      void submitResult(
        nextGuesses,
        didWin,
      );
    } else {
      /*
       * 次の回答をすぐ打てるよう
       * 入力欄へ戻します。
       */
      setTimeout(
        () =>
          focusInput(),
        50,
      );
    }
  };

  /* =========================================================
   * 入力フォーカス
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

  /*
   * 画面の余白・盤面などを押したら
   * 入力欄へフォーカスします。
   *
   * ボタンや入力欄そのものを
   * 押した場合は何もしません。
   */
  const handleScreenClick =
    (
      event:
        React.MouseEvent<
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

      setTimeout(
        () =>
          focusInput(),
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

      setTimeout(
        () =>
          focusInput(),
        20,
      );
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

        {/* =====================
            盤面
           =================== */}

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

        {/* =====================
            凡例
           =================== */}

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

        {/* =====================
            メッセージ
           =================== */}

        {message && (
          <div className="toast">
            {message}
          </div>
        )}

        {/* =====================
            終了
           =================== */}

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

            {discordStatus ===
              'connected' && (
              <span className="save-status">
                {saveStatus ===
                  'saving' &&
                  '結果をDiscordへ保存しています…'}

                {saveStatus ===
                  'saved' &&
                  '結果をDiscordへ保存しました'}

                {saveStatus ===
                  'error' &&
                  'Discordへの結果保存に失敗しました'}
              </span>
            )}
          </div>
        )}

        {/* =====================
            入力
           =================== */}

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

        <p className="hint">
          画面をクリックすると文字入力できます
        </p>

        {/* =====================
            五十音キーボード
           =================== */}

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
                                `blank-${index}`
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

      {/* =========================
          遊び方
         ========================= */}

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
              文字は違うが、その位置の正解文字と同じ五十音行
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

      {/* =========================
          設定
         ========================= */}

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
                '通常ブラウザ'}

              {discordStatus ===
                'error' &&
                '接続できませんでした'}
            </p>

            {discordUser && (
              <p>
                プレイヤー：
                {' '}
                {discordUser
                  .global_name ||
                  discordUser
                    .username}
              </p>
            )}

            <p className="settings-note">
              昨日の結果を表示するチャンネルは、Discordで
              <strong>
                {' '}
                /ことばル設定
                {' '}
              </strong>
              を実行して設定できます。
            </p>

            <p className="settings-note">
              Botが眠っている場合は、ことばルを開くことでRenderを起動します。接続後しばらくしてからコマンドを実行してください。
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