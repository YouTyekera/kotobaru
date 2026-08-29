export type TileState = 'correct' | 'present' | 'near' | 'absent';
export type EvaluatedTile = { char: string; state: TileState };

export const toKatakana = (value: string) =>
  value
    .normalize('NFKC')
    .replace(/[ぁ-ゖ]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) + 0x60),
    )
    .replace(/\s+/g, '');

export const splitJapanese = (value: string) => Array.from(toKatakana(value));

// 「同じ行」の判定に使用する五十音グループ。
// 濁音・半濁音は、ヒントが広くなりすぎないよう別の行として扱う。
// 小書き文字は対応する行（ャュョ→ヤ行など）に含める。
const KANA_ROWS: Record<string, string> = {
  ア: 'A', イ: 'A', ウ: 'A', エ: 'A', オ: 'A', ァ: 'A', ィ: 'A', ゥ: 'A', ェ: 'A', ォ: 'A',
  カ: 'K', キ: 'K', ク: 'K', ケ: 'K', コ: 'K', ヵ: 'K', ヶ: 'K',
  ガ: 'G', ギ: 'G', グ: 'G', ゲ: 'G', ゴ: 'G',
  サ: 'S', シ: 'S', ス: 'S', セ: 'S', ソ: 'S',
  ザ: 'Z', ジ: 'Z', ズ: 'Z', ゼ: 'Z', ゾ: 'Z',
  タ: 'T', チ: 'T', ツ: 'T', テ: 'T', ト: 'T', ッ: 'T',
  ダ: 'D', ヂ: 'D', ヅ: 'D', デ: 'D', ド: 'D',
  ナ: 'N', ニ: 'N', ヌ: 'N', ネ: 'N', ノ: 'N',
  ハ: 'H', ヒ: 'H', フ: 'H', ヘ: 'H', ホ: 'H',
  バ: 'B', ビ: 'B', ブ: 'B', ベ: 'B', ボ: 'B',
  パ: 'P', ピ: 'P', プ: 'P', ペ: 'P', ポ: 'P',
  マ: 'M', ミ: 'M', ム: 'M', メ: 'M', モ: 'M',
  ヤ: 'Y', ユ: 'Y', ヨ: 'Y', ャ: 'Y', ュ: 'Y', ョ: 'Y',
  ラ: 'R', リ: 'R', ル: 'R', レ: 'R', ロ: 'R',
  ワ: 'W', ヲ: 'W', ヮ: 'W',
  ン: 'NN',
  ー: 'LONG',
};

export function kanaRow(char: string): string | null {
  return KANA_ROWS[toKatakana(char)] ?? null;
}

export function evaluateGuess(answer: string, guess: string): EvaluatedTile[] {
  const a = splitJapanese(answer);
  const g = splitJapanese(guess);
  const result: EvaluatedTile[] = g.map((char) => ({ char, state: 'absent' }));

  // Wordleと同じく、同じ文字が複数ある場合にヒントを出し過ぎないよう、
  // 「正解側でまだ使われていない位置」を管理する。
  const answerUsed = Array.from({ length: 5 }, () => false);

  // 1. 文字と位置が一致 → 緑
  for (let i = 0; i < 5; i += 1) {
    if (g[i] === a[i]) {
      result[i].state = 'correct';
      answerUsed[i] = true;
    }
  }

  // 2. 同じ文字が別の位置にある → 黄
  for (let i = 0; i < 5; i += 1) {
    if (result[i].state === 'correct') continue;

    const exactIndex = a.findIndex((answerChar, answerIndex) =>
      !answerUsed[answerIndex] && answerChar === g[i],
    );

    if (exactIndex >= 0) {
      result[i].state = 'present';
      answerUsed[exactIndex] = true;
    }
  }

  // 3. 文字そのものはないが、正解の「どこか」に
  //    同じ五十音行の文字が残っている → 薄紫
  //
  //    以前は「別の位置だけ」を対象にしていたため、
  //    同じ位置に同じ行の別文字があっても灰色になる場合がありました。
  //    新ルールでは位置を問わず、正解全体から同じ行を探します。
  //
  //    ただし、緑・黄・紫で一度使った正解文字は再利用しません。
  //    これにより、正解にカ行が1文字しかないのに入力したカ行3文字が
  //    全部紫になる、といった過剰ヒントを防ぎます。
  for (let i = 0; i < 5; i += 1) {
    if (result[i].state !== 'absent') continue;

    const row = kanaRow(g[i]);
    if (!row) continue;

    const nearIndex = a.findIndex((answerChar, answerIndex) =>
      !answerUsed[answerIndex]
      && answerChar !== g[i]
      && kanaRow(answerChar) === row,
    );

    if (nearIndex >= 0) {
      result[i].state = 'near';
      answerUsed[nearIndex] = true;
    }
  }

  return result;
}

export function tileStateToEmoji(state: TileState) {
  if (state === 'correct') return '🟩';
  if (state === 'present') return '🟨';
  if (state === 'near') return '🟪';
  return '⬛';
}

export function jstDateKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return formatter.format(date).replaceAll('/', '-');
}

export function puzzleNumber(date = new Date()) {
  const start = Date.UTC(2026, 7, 24);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date).split('-').map(Number);
  const today = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  return Math.max(1, Math.floor((today - start) / 86400000) + 1);
}
