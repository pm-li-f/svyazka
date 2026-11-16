import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadGame, type Game } from '@svyazka/core';
import { DEFAULT_SETTINGS, events, facts, type GameEvent, plan, SPLASH_MS } from '../src/index.js';

const demo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples/demo');
const TODAY = '2026-11-14';
const game = () => loadGame(demo);
/** События между примером и примером после правки. */
const after = (change: (g: Game) => void, today = TODAY): GameEvent[] => {
  const g = game();
  change(g);
  return events(facts(game(), TODAY), facts(g, today));
};
const kinds = (list: GameEvent[]) => list.map((e) => e.kind);
const turn = (closed: boolean) => ({ date: TODAY, attention: { budget: 8, spent: 0 }, actions: [], decisions: [], untouched: closed ? ['a', 'b'] : [], closed });

describe('события', () => {
  it('первый снимок, тот же снимок и смена дня событий не дают', () => {
    expect(events(null, facts(game(), TODAY))).toEqual([]);
    expect(after(() => {})).toEqual([]);
    expect(after((g) => g.turns.push({ ...turn(false), date: '2026-11-15' }), '2026-11-15')).toEqual([]);
  });

  it('начало и конец хода', () => {
    expect(after((g) => g.turns.push(turn(false)))).toEqual([{ kind: 'turn-start', date: TODAY, budget: 8 }]);
    const open = game();
    open.turns.push(turn(false));
    const closed = game();
    closed.turns.push(turn(true));
    expect(events(facts(open, TODAY), facts(closed, TODAY))).toEqual([{ kind: 'turn-end', date: TODAY, untouched: 2 }]);
  });

  it('шторм: новый переход-шторм или смена местности', () => {
    expect(after((g) => (g.tasks.find((t) => t.id === 'onboarding-v2')!.terrain = 'storm'))).toEqual([
      { kind: 'storm', id: 'onboarding-v2', title: 'Онбординг v2' },
    ]);
    // Шторм закончился — заставки нет: она только про начало.
    expect(kinds(after((g) => (g.tasks.find((t) => t.id === 'queue-incident')!.status = 'done')))).not.toContain('storm');
  });

  it('новый участник', () => {
    const list = after((g) => g.people.push({ ...g.people[1]!, id: 'yulia', name: 'Юля', craft: {} }));
    expect(list).toContainEqual({ kind: 'new-member', id: 'yulia', name: 'Юля' });
    expect(kinds(list)).not.toContain('sheet-updated');
  });

  it('лагерь взят', () => {
    expect(after((g) => (g.map.camps.find((c) => c.id === 'beta')!.phase = 'done'))).toEqual([{ kind: 'camp-taken', id: 'beta', name: 'Бета-релиз' }]);
  });

  it('снят сигнал: после встречи контекст снова свежий', () => {
    expect(after((g) => (g.sheets['timur']!.last_1on1 = TODAY))).toEqual([{ kind: 'signal-cleared', code: 'stale-context', target: 'timur', subject: 'Тимур' }]);
  });

  it('назначен дублёр: навык держат уже двое', () => {
    expect(after((g) => (g.people.find((p) => p.id === 'anya')!.craft['databases'] = { level: 2, agreed: TODAY }))).toEqual([
      { kind: 'backup-assigned', skill: 'Базы данных' },
    ]);
  });

  it('линтер RACI зелёный: отдельные замечания при этом не перечисляются', () => {
    const list = after((g) => {
      g.tasks.find((t) => t.id === 'deps-update')!.raci.A = 'anya';
      g.tasks.find((t) => t.id === 'second-rope')!.raci.R = ['lena'];
      g.tasks.find((t) => t.id === 'review-policy')!.raci.A = 'lena';
      g.tasks.find((t) => t.id === 'billing-migration')!.raci.A = 'mark';
    });
    expect(kinds(list)).toEqual(['lint-green']);
  });

  it('одно замечание линтера закрыто — снят сигнал этого перехода', () => {
    expect(after((g) => (g.tasks.find((t) => t.id === 'second-rope')!.raci.R = ['lena']))).toEqual([
      { kind: 'signal-cleared', code: 'raci', target: 'second-rope', subject: 'second-rope' },
    ]);
  });

  it('шаг личного квеста', () => {
    expect(after((g) => (g.sheets['mark']!.quest!.done += 1))).toEqual([{ kind: 'quest-step', id: 'mark', name: 'Марк', done: 2, steps: 3 }]);
  });

  it('человек обновил свой лист: одно событие, а не два', () => {
    expect(after((g) => (g.sheets['timur']!.sheet_updated = TODAY))).toEqual([{ kind: 'sheet-updated', id: 'timur', name: 'Тимур' }]);
  });

  it('человека убрали из отряда — его сигналы исчезли, но это не достижение', () => {
    expect(
      after((g) => {
        g.people = g.people.filter((p) => p.id !== 'timur');
        delete g.sheets['timur'];
        for (const t of g.tasks) {
          t.raci.R = t.raci.R.filter((id) => id !== 'timur');
          t.raci.C = t.raci.C.filter((id) => id !== 'timur');
          t.raci.I = t.raci.I.filter((id) => id !== 'timur');
        }
      }).filter((e) => e.kind === 'signal-cleared' && e.target === 'timur'),
    ).toEqual([]);
  });
});

describe('чего в игре нет', () => {
  it('трата внимания и число встреч событий не дают', () => {
    const open = game();
    open.turns.push(turn(false));
    const spent = game();
    spent.turns.push({
      ...turn(false),
      attention: { budget: 8, spent: 9 },
      actions: [
        { kind: 'one-on-one', cost: 2, target: 'anya' },
        { kind: 'one-on-one', cost: 2, target: 'lena' },
        { kind: 'route-block', cost: 3 },
        { kind: 'read-sheet', cost: 1, target: 'mark' },
        { kind: 'read-sheet', cost: 1, target: 'anya' },
      ],
      decisions: ['Решение'],
    });
    expect(events(facts(open, TODAY), facts(spent, TODAY))).toEqual([]);
  });

  it('оценки людей, состояние и нагрузка событий не дают', () => {
    expect(
      after((g) => {
        const sheet = g.sheets['anya']!;
        for (const key of Object.keys(sheet.thinking)) sheet.thinking[key] = { ...sheet.thinking[key]!, self: 5, lead: 5 };
        sheet.state = { ...sheet.state!, energy: 5, load: 10 };
        g.people.find((p) => p.id === 'lena')!.craft['interfaces'] = { level: 3, agreed: TODAY };
      }),
    ).toEqual([]);
  });

  it('потолок внимания перестал быть сигналом — эффекта нет', () => {
    const streak = (budget: number) => {
      const g = game();
      g.turns = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map((date) => ({ ...turn(true), date, attention: { budget, spent: budget } }));
      return facts(g, TODAY);
    };
    expect(Object.keys(streak(10).signals)).toContain('attention:you');
    expect(events(streak(10), streak(6))).toEqual([]);
  });

  it('в фактах нет имён для сравнения людей: только то, что нужно для событий', () => {
    expect(Object.keys(facts(game(), TODAY)).sort()).toEqual(['budget', 'camps', 'date', 'lint', 'people', 'quests', 'sheets', 'signals', 'storms', 'turn', 'untouched']);
  });
});

describe('настройки', () => {
  const list: GameEvent[] = [
    { kind: 'turn-start', date: TODAY, budget: 8 },
    { kind: 'storm', id: 's', title: 'Шторм' },
    { kind: 'camp-taken', id: 'c', name: 'Лагерь' },
    { kind: 'new-member', id: 'm', name: 'Юля' },
    { kind: 'lint-green' },
    { kind: 'quest-step', id: 'mark', name: 'Марк', done: 2, steps: 3 },
  ];

  it('по умолчанию: только редкие заставки, сдержанные эффекты, звук выключен', () => {
    expect(DEFAULT_SETTINGS).toEqual({ splash: 'rare', effects: 'calm', sound: false });
    const shown = plan(list, DEFAULT_SETTINGS, false);
    expect(kinds(shown.splashes)).toEqual(['camp-taken', 'new-member']);
    expect(kinds(shown.effects)).toEqual(['lint-green', 'quest-step']);
  });

  it('все заставки: ежедневные тоже, но не больше двух за раз и сначала самая редкая', () => {
    expect(kinds(plan(list, { ...DEFAULT_SETTINGS, splash: 'all' }, false).splashes)).toEqual(['camp-taken', 'new-member']);
    expect(kinds(plan([list[0]!], { ...DEFAULT_SETTINGS, splash: 'all' }, false).splashes)).toEqual(['turn-start']);
    expect(plan([list[0]!], DEFAULT_SETTINGS, false).splashes).toEqual([]);
  });

  it('игровой слой отключается целиком', () => {
    expect(plan(list, { splash: 'off', effects: 'off', sound: false }, false)).toEqual({ splashes: [], effects: [] });
  });

  it('в шторм эффекты молчат, а заставка о шторме показывается', () => {
    const shown = plan(list, { splash: 'all', effects: 'full', sound: true }, true);
    expect(shown.effects).toEqual([]);
    expect(kinds(shown.splashes)).toEqual(['camp-taken', 'new-member']);
    expect(kinds(plan([list[1]!], DEFAULT_SETTINGS, true).splashes)).toEqual(['storm']);
  });

  it('чем чаще событие, тем короче заставка', () => {
    expect(SPLASH_MS['turn-start']).toBeLessThanOrEqual(2000);
    expect(SPLASH_MS['turn-end']).toBeLessThanOrEqual(2000);
    expect(SPLASH_MS.storm).toBeGreaterThanOrEqual(3000);
    expect(SPLASH_MS['new-member']).toBeLessThanOrEqual(4000);
    expect(SPLASH_MS['camp-taken']).toBeGreaterThanOrEqual(5000);
    expect(SPLASH_MS['camp-taken']).toBeLessThanOrEqual(8000);
  });
});
