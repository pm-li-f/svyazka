import { readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadGame } from '@svyazka/core';
import { attentionSplit, capStreak, mapView, raciLint, roster, sheetView, signals, strategy } from '../src/index.js';

const examples = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples');
const TODAY = '2026-11-13';
const names = readdirSync(examples).filter((n) => statSync(join(examples, n)).isDirectory());
const game = (name: string) => loadGame(join(examples, name));
const by = (name: string) => {
  const g = game(name);
  const view = mapView(g, TODAY);
  const all = signals(g, TODAY);
  return {
    g,
    view,
    plan: strategy(g, view),
    all,
    count: (severity: string, code?: string) => all.filter((s) => s.severity === severity && (code === undefined || s.code === code)).length,
    terrain: (t: string) => view.tasks.filter((x) => x.terrain === t).length,
  };
};

describe('примеры', () => {
  it('их шесть, и в каждом от пяти до восьми человек', () => {
    expect(names.sort()).toEqual(['agenty-razberutsya', 'demo', 'ezhik-v-tumane', 'kak-po-maslu', 'svezhaya-krov', 'this-is-fine']);
    for (const name of names) {
      const people = game(name).people.length;
      expect(people, name).toBeGreaterThanOrEqual(5);
      expect(people, name).toBeLessThanOrEqual(8);
    }
  });

  for (const name of names) {
    it(`${name}: все экраны собираются для каждого человека и слоя`, () => {
      const g = game(name);
      expect(roster(g, TODAY)).toHaveLength(g.people.length + g.agents.length);
      for (const p of g.people) {
        for (const layer of ['team', 'pair', 'me'] as const) expect(sheetView(g, p.id, TODAY, layer).person.id).toBe(p.id);
      }
      expect(mapView(g, TODAY).tasks).toHaveLength(g.tasks.filter((t) => t.status !== 'done').length);
      // Ход на дату примера не начат: его можно прожить самому.
      expect(g.turns.every((t) => t.closed)).toBe(true);
    });
  }

  it('kak-po-maslu: сигналов нет, видно весь маршрут, отряд прошёл большую часть пути', () => {
    const { g, view, plan, all } = by('kak-po-maslu');
    expect(all).toEqual([]);
    expect(raciLint(g)).toEqual([]);
    expect(view.sight).toBeNull();
    expect(view.squad).toMatchObject({ done: 4, total: 6 });
    expect(plan.cracks).toEqual([]);
    expect(plan.squad).toMatchObject({ people: 6, missingRoles: [], headcount: { need: 0 } });
    const split = attentionSplit(g, TODAY);
    expect(split.route / split.spent).toBeGreaterThan(0.4);
    expect(capStreak(g, TODAY)).toBe(0);
  });

  it('this-is-fine: критические сигналы, три шторма, никто не ведёт, внимание на потолке и мимо маршрута', () => {
    const { g, view, plan, count, terrain } = by('this-is-fine');
    expect(count('crit', 'spof')).toBe(2);
    expect(count('warn', 'stale-context')).toBe(6);
    expect(count('warn', 'attention')).toBe(1);
    expect(terrain('storm')).toBe(3);
    expect(view.tasks.filter((t) => t.lint.includes('никто не ведёт')).map((t) => t.id).sort()).toEqual(['data-loss', 'why-churn']);
    expect(view.tasks.filter((t) => t.lint.includes('отвечает агент — нужен человек'))).toHaveLength(2);
    expect(view.squad).toMatchObject({ done: 0 });
    expect(view.route.at(-1)?.hazy).toBe(true);
    expect(plan.squad.headcount?.need).toBe(5);
    expect(plan.cracks.filter((c) => c.code === 'no-holder')).toHaveLength(3);
    expect(capStreak(g, TODAY)).toBe(5);
    expect(attentionSplit(g, TODAY)).toMatchObject({ turns: 5, route: 0 });
  });

  it('ezhik-v-tumane: почти вся местность — туман, у туманных переходов есть разведки', () => {
    const { g, view, terrain } = by('ezhik-v-tumane');
    expect(g.map.cycle).toBe('planning');
    expect(terrain('fog')).toBe(5);
    expect(terrain('storm')).toBe(0);
    for (const t of view.tasks.filter((x) => x.terrain === 'fog')) expect(t.probes.length, t.id).toBeGreaterThan(0);
    expect(view.tasks.find((t) => t.id === 'what-hurts')?.probes.filter((p) => p.outcome !== null)).toHaveLength(2);
    const split = attentionSplit(g, TODAY);
    expect(split.route / split.spent).toBeGreaterThan(0.5);
  });

  it('agenty-razberutsya: агентов больше, чем людей, линтер ловит агентов в ответственных, проверка на одном человеке', () => {
    const { g, all, count } = by('agenty-razberutsya');
    expect(g.agents.length).toBeGreaterThan(g.people.length);
    expect(raciLint(g).filter((f) => f.code === 'agent-accountable').map((f) => f.task).sort()).toEqual(['db-migrations', 'test-coverage']);
    expect(raciLint(g).find((f) => f.code === 'accountable-overload')).toMatchObject({ actor: 'ira' });
    expect(count('crit')).toBe(1);
    expect(all[0]).toMatchObject({ code: 'spof', target: 'verification' });
    const rows = roster(g, TODAY).filter((r) => r.kind === 'agent');
    expect(rows.find((r) => r.id === 'migrator')?.daysSinceUpdate).toBe(17);
    expect(rows.find((r) => r.id === 'docs')?.daysSinceUpdate).toBeNull();
  });

  it('svezhaya-krov: восемь человек, погода forming, новички без 1on1, старые с протухшим контекстом', () => {
    const { g, view, plan, all, count } = by('svezhaya-krov');
    expect(g.people).toHaveLength(8);
    expect(g.map.weather.stage).toBe('forming');
    expect(view.sight).not.toBeNull();
    const never = all.filter((s) => s.code === 'stale-context' && s.text.includes('ни разу')).map((s) => s.target);
    expect(never.sort()).toEqual(['marat', 'tasya']);
    expect(all.filter((s) => s.code === 'stale-context').map((s) => s.target).sort()).toEqual(['alina', 'boris', 'fedya', 'marat', 'tasya']);
    expect(count('crit', 'spof')).toBe(1);
    expect(plan.squad.headcount).toMatchObject({ target: 12, need: 4 });
    expect(capStreak(g, TODAY)).toBe(4);
    expect(attentionSplit(g, TODAY).route).toBe(0);
  });
});
