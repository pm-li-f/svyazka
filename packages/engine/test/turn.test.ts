import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadGame, type Game, type Turn } from '@svyazka/core';
import {
  addDecision,
  budgetLimit,
  capStreak,
  endTurn,
  recordAction,
  signals,
  startTurn,
  TurnError,
  usualBudget,
} from '../src/index.js';

const demo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples/demo');
const game = () => loadGame(demo);
const TODAY = '2026-11-14';

function withBudgets(budgets: Record<string, number>): Game {
  const g = game();
  g.turns = Object.entries(budgets).map(
    ([date, budget]): Turn => ({ date, attention: { budget, spent: 0 }, actions: [], decisions: [], untouched: [], closed: true }),
  );
  return g;
}

describe('бюджет внимания', () => {
  it('обычное значение — медиана за окно, сегодняшний ход не считается', () => {
    expect(usualBudget(game(), TODAY)).toBe(8);
    expect(usualBudget(game(), '2026-11-13')).toBeNull();
    expect(usualBudget(withBudgets({ '2026-11-10': 4, '2026-11-11': 6, '2026-11-12': 9 }), TODAY)).toBe(6);
    expect(usualBudget(withBudgets({ '2026-11-12': 5, '2026-11-13': 8 }), TODAY)).toBe(7);
  });

  it('старые ходы выпадают из окна', () => {
    expect(usualBudget(withBudgets({ '2026-10-01': 2, '2026-11-13': 8 }), TODAY)).toBe(8);
  });

  it('граница — потолок и «не выше обычного плюс запас»', () => {
    expect(budgetLimit(game(), TODAY)).toEqual({ usual: 8, limit: 10 });
    expect(budgetLimit(withBudgets({ '2026-11-13': 5 }), TODAY)).toEqual({ usual: 5, limit: 7 });
    expect(budgetLimit(withBudgets({}), TODAY)).toEqual({ usual: null, limit: 10 });
  });
});

describe('начало хода', () => {
  it('без числа берёт обычное значение', () => {
    expect(startTurn(game(), TODAY)).toMatchObject({ date: TODAY, attention: { budget: 8, spent: 0 }, closed: false });
  });

  it('ноль допустим', () => {
    expect(startTurn(game(), TODAY, 0).attention.budget).toBe(0);
  });

  it('объясняет отказ', () => {
    expect(() => startTurn(game(), TODAY, 11)).toThrow('Бюджет 11 выше допустимого 10: потолок 10.');
    expect(() => startTurn(withBudgets({ '2026-11-13': 5 }), TODAY, 8)).toThrow(
      'Бюджет 8 выше допустимого 7: обычно 5, и больше чем на 2 сверху брать нельзя.',
    );
    expect(() => startTurn(withBudgets({}), TODAY)).toThrow(/Укажи бюджет: от 0 до 10/);
    expect(() => startTurn(game(), '2026-11-13', 5)).toThrow('Ход на 2026-11-13 уже начат.');
    expect(() => startTurn(game(), TODAY, -1)).toThrow(TurnError);
  });
});

describe('действия', () => {
  it('списывают внимание по цене из настроек', () => {
    const g = game();
    let t = startTurn(g, TODAY, 3);
    t = recordAction(g, t, 'one-on-one', 'timur', 'заметка');
    expect(t.attention).toEqual({ budget: 3, spent: 2 });
    expect(t.actions).toEqual([{ kind: 'one-on-one', cost: 2, target: 'timur', note: 'заметка' }]);
  });

  it('перерасход разрешён', () => {
    const g = game();
    const t = recordAction(g, recordAction(g, startTurn(g, TODAY, 3), 'route-block'), 'one-on-one', 'mark');
    expect(t.attention).toEqual({ budget: 3, spent: 5 });
  });

  it('неизвестное действие называет известные', () => {
    const g = game();
    expect(() => recordAction(g, startTurn(g, TODAY), 'dance')).toThrow(/Неизвестное действие «dance».*one-on-one \(2\)/);
  });

  it('решения записываются, пустые — нет', () => {
    const t = addDecision(startTurn(game(), TODAY), '  Дублёр — Тимур  ');
    expect(t.decisions).toEqual(['Дублёр — Тимур']);
    expect(() => addDecision(t, '   ')).toThrow(TurnError);
  });
});

describe('конец хода', () => {
  it('всё, что осталось в сигналах, кроме справочных, уходит в «не дошёл»', () => {
    const g = game();
    const t = endTurn(g, startTurn(g, TODAY), TODAY);
    expect(t.closed).toBe(true);
    expect(t.untouched).toHaveLength(7);
    expect(t.untouched.some((u) => u.includes('Погода'))).toBe(false);
  });

  it('закрытый ход нельзя менять', () => {
    const g = game();
    const closed = endTurn(g, startTurn(g, TODAY), TODAY);
    expect(() => recordAction(g, closed, 'read-sheet', 'mark')).toThrow('Ход 2026-11-14 уже закрыт.');
    expect(() => addDecision(closed, 'поздно')).toThrow(TurnError);
    expect(() => endTurn(g, closed, TODAY)).toThrow(TurnError);
  });
});

describe('потолок несколько ходов подряд', () => {
  it('считает серию с последнего хода', () => {
    expect(capStreak(withBudgets({ '2026-11-11': 10, '2026-11-12': 10, '2026-11-13': 10 }), TODAY)).toBe(3);
    expect(capStreak(withBudgets({ '2026-11-11': 10, '2026-11-12': 7, '2026-11-13': 10 }), TODAY)).toBe(1);
    expect(capStreak(game(), TODAY)).toBe(0);
  });

  it('становится сигналом на самого руководителя', () => {
    const g = withBudgets({ '2026-11-11': 10, '2026-11-12': 10, '2026-11-13': 10 });
    const s = signals(g, TODAY).find((x) => x.code === 'attention');
    expect(s).toMatchObject({ severity: 'warn', target: 'you' });
    expect(s?.text).toBe('Потолок внимания — уже 3-й ход подряд. Это сигнал на тебя самого.');
    expect(signals(game(), TODAY).some((x) => x.code === 'attention')).toBe(false);
  });
});
