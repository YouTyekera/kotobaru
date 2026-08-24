import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  connectDiscord,
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

const ROWS = 6;

/* =========================================================
 * カタカナ → ひらがな
 *
 * ゲーム内部ではカタカナに統一して判定しますが、
 * 盤面では日本語として親しみやすいひらがなを表示します。
 * ======================================================= */

function toHiragana(value: string) {
  return value.replace(
    /[ァ-ヶ]/g,
    (char) =>
      String.fromCharCode(
        char.charCodeAt(0) - 0x60,
      ),
  );
}

/* =========================================================
 * 出題CSV読み込み
 * ======================================================= */

function parseAnswerCsv(
  text: string,
): AnswerEntry[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const comma =
        line.indexOf(',');

      // カンマがない場合
      if (comma < 0) {
        return {
          display: line,
          reading:
            toKatakana(line),
        };
      }

      // カンマより前：漢字などの表示名
      // カンマより後：読み
      return {
        display:
          line.slice(0, comma),

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
 * 盤面の1行
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
  /*
   * 回答済みならguessを表示。
   * 現在入力中の行ならinputを表示。
   */
  const chars = guess
    ? splitJapanese(guess)
    : active
      ? splitJapanese(input)
      : [];

  /*
   * 回答済みの行だけ色判定します。
   */
  const evaluated = guess
    ? evaluateGuess(
        answer,
        guess,
      )
    : null;

  return (
    <div className="board-row">
      {Array.from({
        length: 5,
      }).map((_, index) => {
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
              tile?.state ?? '',
              guess
                ? 'revealed'
                : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={
              guess
                ? {
                    animationDelay:
                      `${index * 110}ms`,
                  }
                : undefined
            }
          >
            {character}
          </div>
        );
      })}
    </div>
  );
}

/* =========================================================
 * メイン画面
 * ======================================================= */

export default function App() {
  /* -------------------------
   * 辞書・問題
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
   * ゲーム状態
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

  /*
   * 日本語IMEで変換中かどうか。
   *
   * 例：
   * tamagoyaki
   * ↓
   * たまごやき
   *
   * 変換途中にEnterを押しても、
   * 回答を送信しないために使用します。
   */
  const [
    isComposing,
    setIsComposing,
  ] = useState(false);

  /* -------------------------
   * Discord情報
   * ----------------------- */

  const [
    discordUser,
    setDiscordUser,
  ] =
    useState<DiscordUser | null>(
      null,
    );

  const [
    guildId,
    setGuildId,
  ] =
    useState<string | null>(
      null,
    );

  /* =========================================================
   * 今日の問題
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

  /*
   * 内部の正解はカタカナ。
   *
   * 例：
   * タマゴヤキ
   */
  const answer =
    answerEntry?.reading ??
    '';

  /* =========================================================
   * 起動時：
   * ・入力辞書
   * ・問題辞書
   * ・Discord情報
   * を読み込みます。
   * ======================================================= */

  useEffect(() => {
    Promise.all([
      fetch(
        './data/A_data_new.csv',
      ).then((response) =>
        response.text(),
      ),

      fetch(
        './data/Q_fil_ippan.csv',
      ).then((response) =>
        response.text(),
      ),

      connectDiscord(),
    ])
      .then(
        ([
          dictText,
          answerText,
          discord,
        ]) => {
          /*
           * 入力可能辞書をSetにします。
           *
           * Setにすると
           * 「この単語は辞書にあるか」
           * を高速に確認できます。
           */
          const words =
            dictText
              .split(/\r?\n/)
              .map((word) =>
                toKatakana(
                  word.trim(),
                ),
              )
              .filter(Boolean);

          setDictionary(
            new Set(words),
          );

          /*
           * 出題候補
           */
          setAnswers(
            parseAnswerCsv(
              answerText,
            ),
          );

          /*
           * Discordのユーザー情報
           */
          setDiscordUser(
            discord.user,
          );

          setGuildId(
            discord.guildId,
          );
        },
      )
      .catch(
        (error) => {
          console.error(
            'ことばルの初期化に失敗しました。',
            error,
          );

          setMessage(
            'ゲームの読み込みに失敗しました',
          );
        },
      );
  }, []);

  /* =========================================================
   * 今日すでに遊んでいた場合、
   * localStorageから盤面を復元
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

      /*
       * 今日のデータだけ復元します。
       *
       * 昨日のデータだった場合は無視します。
       */
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
      /*
       * localStorageが壊れていても
       * ゲーム自体は起動させます。
       */
      console.warn(
        '保存済みゲームデータを読み込めませんでした。',
      );
    }
  }, [
    answer,
    dateKey,
  ]);

  /* =========================================================
   * 端末内に今日の盤面を保存
   * ======================================================= */

  const save = (
    nextGuesses: string[],
    nextFinished: boolean,
    nextWon: boolean,
  ) => {
    const data: SavedGame =
      {
        date: dateKey,
        guesses:
          nextGuesses,
        finished:
          nextFinished,
        won: nextWon,
      };

    localStorage.setItem(
      'kotobaru-today',
      JSON.stringify(data),
    );
  };

  /* =========================================================
   * ゲーム終了時にDiscord側へ結果を送る
   *
   * 単語そのものは送信しません。
   *
   * 送るもの：
   * ・Discordユーザー
   * ・問題番号
   * ・日付
   * ・何回で成功したか
   * ・色のパターン
   * ======================================================= */

  const submitResult =
    async (
      nextGuesses: string[],
      didWin: boolean,
    ) => {
      /*
       * ブラウザ単体で開いている場合など、
       * Discord情報がなければ
       * 送信しません。
       */
      if (
        !discordUser ||
        !guildId
      ) {
        return;
      }

      /*
       * Discord共有用の
       * 色パターンを生成。
       *
       * 緑   🟩
       * 黄   🟨
       * 紫   🟪
       * 灰   ⬛
       */
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
                  {
                    guildId,

                    userId:
                      discordUser.id,

                    displayName:
                      discordUser.global_name ||
                      discordUser.username,

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

                    pattern,
                  },
                ),
            },
          );

        if (!response.ok) {
          console.warn(
            '結果をDiscordへ保存できませんでした。',
            await response
              .text()
              .catch(
                () => '',
              ),
          );
        }
      } catch (error) {
        /*
         * Discordへの保存に失敗しても、
         * ゲーム結果はlocalStorageに残ります。
         */
        console.warn(
          '結果送信に失敗しました。ゲーム結果は端末内には保存されています。',
          error,
        );
      }
    };

  /* =========================================================
   * 「決定」を押したときの処理
   * ======================================================= */

  const submit = () => {
    /*
     * 問題未読み込み、
     * またはゲーム終了後なら何もしません。
     */
    if (
      !answer ||
      finished
    ) {
      return;
    }

    /*
     * 入力をカタカナに統一。
     *
     * 例：
     * たまごやき
     * ↓
     * タマゴヤキ
     */
    const normalized =
      toKatakana(input);

    /*
     * 5文字でなければ拒否。
     */
    if (
      splitJapanese(
        normalized,
      ).length !== 5
    ) {
      setMessage(
        '5文字入力してください',
      );

      return;
    }

    /*
     * 辞書にない単語なら拒否。
     */
    if (
      !dictionary.has(
        normalized,
      )
    ) {
      setMessage(
        '辞書にないことばです',
      );

      return;
    }

    /*
     * 回答を追加。
     */
    const nextGuesses = [
      ...guesses,
      normalized,
    ];

    /*
     * 完全一致なら正解。
     */
    const didWin =
      normalized ===
      answer;

    /*
     * 正解した、
     * または6回使い切ったら終了。
     */
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

    /*
     * 端末内保存
     */
    save(
      nextGuesses,
      didFinish,
      didWin,
    );

    /*
     * ゲーム終了時だけ
     * Discordへ結果を保存。
     */
    if (didFinish) {
      void submitResult(
        nextGuesses,
        didWin,
      );
    }
  };

  /* =========================================================
   * 日本語入力欄
   * ======================================================= */

  const handleInputChange = (
    value: string,
  ) => {
    /*
     * IME変換中は制限しません。
     *
     * ここで5文字制限すると、
     * ローマ字入力途中で文字が消えることがあります。
     */
    if (isComposing) {
      setInput(value);
      return;
    }

    /*
     * 変換が終わっている場合のみ、
     * 日本語の文字単位で先頭5文字までにします。
     */
    const characters =
      Array.from(value);

    setInput(
      characters
        .slice(0, 5)
        .join(''),
    );
  };

  /* =========================================================
   * 6行分の盤面
   * ======================================================= */

  const boardRows =
    useMemo(
      () =>
        Array.from({
          length: ROWS,
        }),
      [],
    );

  /* =========================================================
   * 問題読み込み中
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
   * 画面
   * ======================================================= */

  return (
    <main className="app">
      {/* =========================
          上部
         ========================= */}

      <header className="header">
        <button
          className="icon-button"
          aria-label="遊び方"
          type="button"
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
        >
          ⚙
        </button>
      </header>

      {/* =========================
          ゲーム本体
         ========================= */}

      <section className="game-area">
        <div className="puzzle-label">
          第{number}問
        </div>

        {/* 盤面 */}

        <div className="board">
          {boardRows.map(
            (_, row) => (
              <BoardRow
                key={row}
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

        {/* =========================
            色の説明
           ========================= */}

        <div
          className="legend"
          aria-label="色の意味"
        >
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

        {/* =========================
            エラーメッセージ
           ========================= */}

        {message && (
          <div className="toast">
            {message}
          </div>
        )}

        {/* =========================
            ゲーム終了
           ========================= */}

        {finished && (
          <div className="result-card">
            <strong>
              {won
                ? `${guesses.length}回で正解！`
                : '今回は正解できませんでした'}
            </strong>

            <span>
              正解：
              {answerEntry?.display}

              {answerEntry?.reading
                ? `（${toHiragana(
                    answerEntry.reading,
                  )}）`
                : ''}
            </span>
          </div>
        )}

        {/* =========================
            入力欄
           ========================= */}

        {!finished && (
          <div className="input-panel">
            <input
              autoFocus
              value={input}

              /*
               * 日本語IMEで変換開始
               */
              onCompositionStart={() => {
                setIsComposing(
                  true,
                );
              }}

              /*
               * 日本語IMEの変換確定
               */
              onCompositionEnd={(
                event,
              ) => {
                setIsComposing(
                  false,
                );

                const value =
                  event
                    .currentTarget
                    .value;

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
              }}

              /*
               * 通常の文字入力
               */
              onChange={(
                event,
              ) => {
                handleInputChange(
                  event.target
                    .value,
                );
              }}

              /*
               * Enterで決定。
               *
               * ただし日本語変換中のEnterは
               * 「変換確定」なので送信しません。
               */
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
          ひらがな・カタカナのどちらでも入力できます
        </p>
      </section>
    </main>
  );
}