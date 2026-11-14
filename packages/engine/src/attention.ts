import type { Game } from '@svyazka/core';
import { daysBetween } from './dates.js';

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : Math.round(((s[mid - 1] as number) + (s[mid] as number)) / 2);
}

/** Обычный бюджет внимания: медиана за последние `window_days` до сегодняшнего дня. */
export function usualBudget(game: Game, today: string): number | null {
  const window = game.config.attention.window_days;
  return median(
    game.turns
      .filter((t) => {
        const age = daysBetween(t.date, today);
        return age > 0 && age <= window;
      })
      .map((t) => t.attention.budget),
  );
}

/** Верхняя граница на сегодня: потолок и «не выше обычного плюс запас». */
export function budgetLimit(game: Game, today: string): { usual: number | null; limit: number } {
  const usual = usualBudget(game, today);
  const { cap, over_usual } = game.config.attention;
  return { usual, limit: usual === null ? cap : Math.min(cap, usual + over_usual) };
}

/** Сколько ходов подряд, считая с последнего, бюджет стоял на потолке. */
export function capStreak(game: Game, today: string): number {
  const cap = game.config.attention.cap;
  const past = game.turns.filter((t) => daysBetween(t.date, today) >= 0).sort((a, b) => b.date.localeCompare(a.date));
  let n = 0;
  for (const t of past) {
    if (t.attention.budget < cap) break;
    n += 1;
  }
  return n;
}
