const DAY = 24 * 60 * 60 * 1000;

function toUtc(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1);
}

/** Сколько полных дней прошло от `from` до `to`. Даты в формате ГГГГ-ММ-ДД. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY);
}
