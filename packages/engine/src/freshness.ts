import type { Game } from '@svyazka/core';
import { daysBetween } from './dates.js';

export interface Freshness {
  person: string;
  isLead: boolean;
  /** Дней с последнего 1on1. У руководителя — null: сам с собой он не встречается. */
  daysSince1on1: number | null;
  /** Дней с тех пор, как человек сам обновлял свой лист. null — листа нет или он не обновлялся. */
  daysSinceSheet: number | null;
  stale1on1: boolean;
  staleSheet: boolean;
  /** Состояние (силы, нагрузка) свежее срока годности. Устаревшей нагрузке верить нельзя. */
  stateFresh: boolean;
}

/**
 * Давность контекста по каждому человеку. Контекст протухает: всё, что старше
 * `config.ttl_days`, считается устаревшим. Человек, с которым 1on1 не было ни разу,
 * тоже устарел.
 */
export function freshness(game: Game, today: string): Freshness[] {
  const ttl = game.config.ttl_days;
  return game.people.map((p) => {
    const sheet = game.sheets[p.id];
    const daysSince1on1 = p.is_lead || !sheet?.last_1on1 ? null : daysBetween(sheet.last_1on1, today);
    const daysSinceSheet = sheet?.sheet_updated ? daysBetween(sheet.sheet_updated, today) : null;
    const stateAge = sheet?.state ? daysBetween(sheet.state.at, today) : null;
    return {
      person: p.id,
      isLead: p.is_lead,
      daysSince1on1,
      daysSinceSheet,
      stale1on1: !p.is_lead && (daysSince1on1 === null || daysSince1on1 > ttl),
      staleSheet: daysSinceSheet === null || daysSinceSheet > ttl,
      stateFresh: stateAge !== null && stateAge <= ttl,
    };
  });
}
