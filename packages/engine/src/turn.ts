import type { Game, Turn } from '@svyazka/core';
import { budgetLimit } from './attention.js';
import { signals } from './signals.js';

/** Ошибка хода с текстом для человека: её показывают как есть. */
export class TurnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TurnError';
  }
}

export function currentTurn(game: Game, today: string): Turn | undefined {
  return game.turns.find((t) => t.date === today);
}

/** Утренняя отметка. Без `budget` берётся обычное значение. */
export function startTurn(game: Game, today: string, budget?: number): Turn {
  if (currentTurn(game, today)) throw new TurnError(`Ход на ${today} уже начат.`);
  const { usual, limit } = budgetLimit(game, today);
  const value = budget ?? usual;
  if (value === null) {
    throw new TurnError(`Истории ходов ещё нет, обычное значение не посчитать. Укажи бюджет: от 0 до ${limit}.`);
  }
  if (!Number.isInteger(value) || value < 0) throw new TurnError('Бюджет — целое число от 0.');
  if (value > limit) {
    const why =
      usual !== null && limit < game.config.attention.cap
        ? `обычно ${usual}, и больше чем на ${game.config.attention.over_usual} сверху брать нельзя`
        : `потолок ${game.config.attention.cap}`;
    throw new TurnError(`Бюджет ${value} выше допустимого ${limit}: ${why}.`);
  }
  return { date: today, attention: { budget: value, spent: 0 }, actions: [], decisions: [], untouched: [], closed: false };
}

function open(turn: Turn): void {
  if (turn.closed) throw new TurnError(`Ход ${turn.date} уже закрыт.`);
}

/** Записывает действие и списывает внимание. Перерасход разрешён: игра — зеркало, а не турникет. */
export function recordAction(game: Game, turn: Turn, kind: string, target?: string, note?: string): Turn {
  open(turn);
  const cost = game.config.action_costs[kind];
  if (cost === undefined) {
    throw new TurnError(
      `Неизвестное действие «${kind}». Есть: ${Object.entries(game.config.action_costs)
        .map(([k, c]) => `${k} (${c})`)
        .join(', ')}.`,
    );
  }
  return {
    ...turn,
    attention: { ...turn.attention, spent: turn.attention.spent + cost },
    actions: [...turn.actions, { kind, cost, ...(target ? { target } : {}), ...(note ? { note } : {}) }],
  };
}

export function hasAction(turn: Turn, kind: string, target?: string): boolean {
  return turn.actions.some((a) => a.kind === kind && a.target === target);
}

/** Строка в журнал решений: что решил и почему. */
export function addDecision(turn: Turn, text: string): Turn {
  open(turn);
  if (!text.trim()) throw new TurnError('Пустое решение не записываю.');
  return { ...turn, decisions: [...turn.decisions, text.trim()] };
}

/** Закрывает ход: всё, что осталось в сигналах, уходит в «до чего не дошёл». */
export function endTurn(game: Game, turn: Turn, today: string): Turn {
  open(turn);
  const untouched = signals(game, today)
    .filter((s) => s.severity !== 'info')
    .map((s) => s.text);
  return { ...turn, untouched, closed: true };
}
