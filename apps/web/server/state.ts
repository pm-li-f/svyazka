import { loadGame, type GameMap, type Turn } from '@svyazka/core';
import {
  budgetLimit,
  currentTurn,
  raciMatrix,
  roster,
  signals,
  skillMatrix,
  type RaciMatrix,
  type RosterRow,
  type Signal,
  type SkillMatrix,
} from '@svyazka/engine';

/** Всё, что нужно экранам «отряд», «переходы» и «ход». Листы людей отдаются отдельно, по слою. */
export interface StateView {
  today: string;
  ttlDays: number;
  labels: Record<string, string>;
  actionCosts: Record<string, number>;
  map: GameMap;
  targetCamp: string | null;
  roster: RosterRow[];
  signals: Signal[];
  raci: RaciMatrix;
  skills: SkillMatrix;
  agents: { id: string; name: string; accountable: string; report: { at: string; text: string } | null }[];
  /** Бюджет стресса: сколько осталось до полной загрузки. null — состояние устарело или не заполнено. */
  stress: { id: string; left: number | null }[];
  turn: Turn | null;
  budget: { usual: number | null; limit: number };
}

export function buildState(dir: string, today: string): StateView {
  const game = loadGame(dir);
  const rows = roster(game, today);
  return {
    today,
    ttlDays: game.config.ttl_days,
    labels: game.config.labels,
    actionCosts: game.config.action_costs,
    map: game.map,
    targetCamp: game.map.camps.find((c) => c.id === game.map.target)?.name ?? null,
    roster: rows,
    signals: signals(game, today),
    raci: raciMatrix(game),
    skills: skillMatrix(game),
    agents: game.agents.map((a) => ({
      id: a.id,
      name: a.name,
      accountable: a.accountable,
      report: [...a.reports].sort((x, y) => y.at.localeCompare(x.at))[0] ?? null,
    })),
    stress: rows
      .filter((r) => r.kind === 'person')
      .map((r) => ({ id: r.id, left: r.load === null ? null : Math.max(0, 100 - r.load) }))
      .sort((a, b) => (a.left ?? 101) - (b.left ?? 101)),
    turn: currentTurn(game, today) ?? null,
    budget: budgetLimit(game, today),
  };
}
