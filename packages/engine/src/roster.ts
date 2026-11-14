import type { Game } from '@svyazka/core';
import { daysBetween } from './dates.js';
import { freshness } from './freshness.js';

/**
 * Статус описывает, что известно о человеке, а не оценивает его:
 * stale — контекст устарел, loaded — свежая нагрузка выше порога, steady — всё остальное.
 */
export type RosterStatus = 'steady' | 'loaded' | 'stale' | 'running';

export interface RosterRow {
  kind: 'person' | 'agent';
  id: string;
  name: string;
  role: string;
  isLead: boolean;
  mbti: string | null;
  belbin: string | null;
  status: RosterStatus;
  /** Нагрузка в процентах; null, если состояния нет или оно устарело. */
  load: number | null;
  daysSince1on1: number | null;
  /** Для человека — дней с обновления листа, для агента — дней с последнего отчёта. */
  daysSinceUpdate: number | null;
  stale1on1: boolean;
  staleUpdate: boolean;
  owns: string[];
  /** Для агента: кто за него отвечает. */
  accountable: string | null;
}

/** Строки экрана «Отряд»: сначала руководитель, потом люди, потом агенты. */
export function roster(game: Game, today: string): RosterRow[] {
  const fresh = new Map(freshness(game, today).map((f) => [f.person, f]));
  const people = [...game.people].sort((a, b) => Number(b.is_lead) - Number(a.is_lead));

  const rows: RosterRow[] = people.map((p) => {
    const f = fresh.get(p.id);
    const state = game.sheets[p.id]?.state;
    const load = f?.stateFresh && state ? state.load : null;
    const stale = f?.stale1on1 ?? false;
    return {
      kind: 'person',
      id: p.id,
      name: p.name,
      role: p.role,
      isLead: p.is_lead,
      mbti: p.mbti ?? null,
      belbin: p.belbin ?? null,
      status: stale ? 'stale' : load !== null && load >= game.config.signals.load_crit ? 'loaded' : 'steady',
      load,
      daysSince1on1: f?.daysSince1on1 ?? null,
      daysSinceUpdate: f?.daysSinceSheet ?? null,
      stale1on1: stale,
      staleUpdate: f?.staleSheet ?? true,
      owns: p.owns,
      accountable: null,
    };
  });

  for (const a of game.agents) {
    const last = a.reports.map((r) => r.at).sort().at(-1);
    const days = last ? daysBetween(last, today) : null;
    rows.push({
      kind: 'agent',
      id: a.id,
      name: a.name,
      role: a.purpose,
      isLead: false,
      mbti: null,
      belbin: null,
      status: 'running',
      load: null,
      daysSince1on1: null,
      daysSinceUpdate: days,
      stale1on1: false,
      staleUpdate: days === null || days > game.config.ttl_days,
      owns: [],
      accountable: a.accountable,
    });
  }
  return rows;
}
