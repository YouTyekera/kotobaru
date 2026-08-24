export type TileState =
  | 'correct'
  | 'present'
  | 'near'
  | 'absent';

export type EvaluatedTile = {
  char: string;
  state: TileState;
};

/* =========================================================
 * ひらがな → カタカナ
 * ======================================================= */

export const toKatakana = (
  value: string,
) =>
  value
    .normalize('NFKC')
    .replace(
      /[ぁ-ゖ]/g,
      (char) =>
        String.fromCharCode(
          char.charCodeAt(0) +
            0x60,
        ),
    )
    .replace(/\s+/g, '');

/* =========================================================
 * 文字分割
 * ======================================================= */

export const splitJapanese = (
  value: string,
) =>
  Array.from(
    toKatakana(value),
  );

/* =========================================================
 * 五十音の行
 *
 * 濁音・半濁音は別グループです。
 * ======================================================= */

const KANA_ROWS:
  Record<string, string> = {
  ア: 'A',
  イ: 'A',
  ウ: 'A',
  エ: 'A',
  オ: 'A',
  ァ: 'A',
  ィ: 'A',
  ゥ: 'A',
  ェ: 'A',
  ォ: 'A',

  カ: 'K',
  キ: 'K',
  ク: 'K',
  ケ: 'K',
  コ: 'K',
  ヵ: 'K',
  ヶ: 'K',

  ガ: 'G',
  ギ: 'G',
  グ: 'G',
  ゲ: 'G',
  ゴ: 'G',

  サ: 'S',
  シ: 'S',
  ス: 'S',
  セ: 'S',
  ソ: 'S',

  ザ: 'Z',
  ジ: 'Z',
  ズ: 'Z',
  ゼ: 'Z',
  ゾ: 'Z',

  タ: 'T',
  チ: 'T',
  ツ: 'T',
  テ: 'T',
  ト: 'T',
  ッ: 'T',

  ダ: 'D',
  ヂ: 'D',
  ヅ: 'D',
  デ: 'D',
  ド: 'D',

  ナ: 'N',
  ニ: 'N',
  ヌ: 'N',
  ネ: 'N',
  ノ: 'N',

  ハ: 'H',
  ヒ: 'H',
  フ: 'H',
  ヘ: 'H',
  ホ: 'H',

  バ: 'B',
  ビ: 'B',
  ブ: 'B',
  ベ: 'B',
  ボ: 'B',

  パ: 'P',
  ピ: 'P',
  プ: 'P',
  ペ: 'P',
  ポ: 'P',

  マ: 'M',
  ミ: 'M',
  ム: 'M',
  メ: 'M',
  モ: 'M',

  ヤ: 'Y',
  ユ: 'Y',
  ヨ: 'Y',
  ャ: 'Y',
  ュ: 'Y',
  ョ: 'Y',

  ラ: 'R',
  リ: 'R',
  ル: 'R',
  レ: 'R',
  ロ: 'R',

  ワ: 'W',
  ヲ: 'W',
  ヮ: 'W',

  ン: 'NN',

  ー: 'LONG',
};

/* =========================================================
 * 文字がどの行か取得
 * ======================================================= */

export function kanaRow(
  char: string,
): string | null {
  return (
    KANA_ROWS[
      toKatakana(char)
    ] ?? null
  );
}

/* =========================================================
 * Wordle判定
 *
 * 優先順位
 *
 * 1. 緑
 * 2. 黄
 * 3. 薄紫
 * 4. 灰
 *
 * 薄紫だけは
 * 「同じ位置にある正解文字と
 *   同じ五十音行か」
 * だけを見ます。
 * ======================================================= */

export function evaluateGuess(
  answer: string,
  guess: string,
): EvaluatedTile[] {
  const a =
    splitJapanese(answer);

  const g =
    splitJapanese(guess);

  const result:
    EvaluatedTile[] =
    g.map((char) => ({
      char,
      state: 'absent',
    }));

  /*
   * 黄色判定で同じ正解文字を
   * 何度も使わないための管理。
   */
  const answerUsed =
    Array.from(
      {
        length: 5,
      },
      () => false,
    );

  /* =========================
   * 1. 緑
   * ======================= */

  for (
    let i = 0;
    i < 5;
    i += 1
  ) {
    if (g[i] === a[i]) {
      result[i].state =
        'correct';

      answerUsed[i] =
        true;
    }
  }

  /* =========================
   * 2. 黄色
   *
   * 同じ文字が
   * 他の場所にある
   * ======================= */

  for (
    let i = 0;
    i < 5;
    i += 1
  ) {
    if (
      result[i].state ===
      'correct'
    ) {
      continue;
    }

    const exactIndex =
      a.findIndex(
        (
          answerChar,
          answerIndex,
        ) =>
          !answerUsed[
            answerIndex
          ] &&
          answerChar ===
            g[i],
      );

    if (
      exactIndex >= 0
    ) {
      result[i].state =
        'present';

      answerUsed[
        exactIndex
      ] = true;
    }
  }

  /* =========================
   * 3. 薄紫
   *
   * ここがことばル独自仕様。
   *
   * 「同じ位置」にある
   * 正解文字と同じ行の場合のみ。
   *
   * 例：
   *
   * 正解
   * ア サ ゴ ハ ン
   *
   * 入力
   * ウ キ ○ ○ ○
   *
   * ウは1文字目なので
   * アと同じア行 → 紫
   *
   * キは2文字目なので
   * サ行ではない → 灰
   * ======================= */

  for (
    let i = 0;
    i < 5;
    i += 1
  ) {
    if (
      result[i].state !==
      'absent'
    ) {
      continue;
    }

    const guessRow =
      kanaRow(g[i]);

    const answerRow =
      kanaRow(a[i]);

    if (
      !guessRow ||
      !answerRow
    ) {
      continue;
    }

    if (
      g[i] !== a[i] &&
      guessRow === answerRow
    ) {
      result[i].state =
        'near';
    }
  }

  return result;
}

/* =========================================================
 * Discord共有用
 * ======================================================= */

export function tileStateToEmoji(
  state: TileState,
) {
  if (
    state === 'correct'
  ) {
    return '🟩';
  }

  if (
    state === 'present'
  ) {
    return '🟨';
  }

  if (
    state === 'near'
  ) {
    return '🟪';
  }

  return '⬛';
}

/* =========================================================
 * 日本時間の日付
 * ======================================================= */

export function jstDateKey(
  date = new Date(),
) {
  const formatter =
    new Intl.DateTimeFormat(
      'ja-JP',
      {
        timeZone:
          'Asia/Tokyo',

        year:
          'numeric',

        month:
          '2-digit',

        day:
          '2-digit',
      },
    );

  return formatter
    .format(date)
    .replaceAll('/', '-');
}

/* =========================================================
 * 問題番号
 * ======================================================= */

export function puzzleNumber(
  date = new Date(),
) {
  /*
   * 第1問：
   * 2026-08-24
   */
  const start =
    Date.UTC(
      2026,
      7,
      24,
    );

  const parts =
    new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone:
          'Asia/Tokyo',

        year:
          'numeric',

        month:
          '2-digit',

        day:
          '2-digit',
      },
    )
      .format(date)
      .split('-')
      .map(Number);

  const today =
    Date.UTC(
      parts[0],
      parts[1] - 1,
      parts[2],
    );

  return Math.max(
    1,
    Math.floor(
      (today - start) /
        86400000,
    ) + 1,
  );
}