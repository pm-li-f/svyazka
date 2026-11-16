/** Раскраска вывода. Без цвета все функции возвращают строку как есть. */
export interface Paint {
  red: (s: string) => string;
  yellow: (s: string) => string;
  green: (s: string) => string;
  blue: (s: string) => string;
  dim: (s: string) => string;
  bold: (s: string) => string;
  /** Цвет включён: можно рисовать картинку, а не только подкрашивать текст. */
  enabled: boolean;
}

export function makePaint(color: boolean): Paint {
  const wrap = (code: number) => (s: string) => (color ? `\u001b[${code}m${s}\u001b[0m` : s);
  return { red: wrap(31), yellow: wrap(33), green: wrap(32), blue: wrap(34), dim: wrap(2), bold: wrap(1), enabled: color };
}

/** Ширина в знаках, а не в байтах: кириллица и значки считаются по одному. */
export const width = (s: string) => [...s].length;

export const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - width(s)));

/** Ячейка таблицы: текст и необязательная раскраска, которая не влияет на ширину. */
export type Cell = string | { t: string; c?: (s: string) => string };

const text = (c: Cell) => (typeof c === 'string' ? c : c.t);
const paint = (c: Cell, padded: string) => (typeof c === 'string' || !c.c ? padded : c.c(padded));

/** Выравнивает столбцы по самой широкой ячейке. Последний столбец не дополняется пробелами. */
export function table(rows: Cell[][], gap = 2): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, width(text(cell)));
    });
  }
  return rows.map((row) =>
    row
      .map((cell, i) => {
        const last = i === row.length - 1;
        const padded = last ? text(cell) : pad(text(cell), widths[i] ?? 0);
        return paint(cell, padded) + (last ? '' : ' '.repeat(gap));
      })
      .join('')
      .trimEnd(),
  );
}

export const days = (n: number | null) => (n === null ? '—' : `${n}d`);

export const dots = (n: number, of: number) => '●'.repeat(n) + '○'.repeat(Math.max(0, of - n));
