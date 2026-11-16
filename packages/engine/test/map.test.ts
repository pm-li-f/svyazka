import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadGame, type Game } from '@svyazka/core';
import { attentionSplit, GROUND, mapView, strategy } from '../src/index.js';

const demo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples/demo');
const TODAY = '2026-11-13';
const game = () => loadGame(demo);
const count = (cells: string[], code: string) => cells.join('').split(code).length - 1;
const task = (g: Game, id: string) => g.tasks.find((t) => t.id === id)!;

describe('карта', () => {
  it('одно и то же состояние даёт одну и ту же карту', () => {
    expect(mapView(game(), TODAY)).toEqual(mapView(game(), TODAY));
  });

  it('рельеф нужного размера и только из известных клеток', () => {
    const view = mapView(game(), TODAY);
    expect(view.detail).toBe(2);
    expect(view.cells).toHaveLength(view.rows * view.detail);
    for (const row of view.cells) {
      expect(row).toHaveLength(view.cols * view.detail);
      for (const code of row) expect(Object.keys(GROUND)).toContain(code);
    }
  });

  it('маршрут идёт по лагерям из файла: база, лагеря по номерам, вершина', () => {
    const view = mapView(game(), TODAY);
    expect(view.route.map((p) => `${p.kind}${p.number ?? ''}:${p.id}`)).toEqual([
      'base:base',
      'camp1:mvp',
      'camp2:beta',
      'camp3:paying',
      'summit:breakeven',
    ]);
    for (const p of view.route) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(view.cols);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThan(view.rows);
    }
  });

  it('на карте все открытые переходы, каждый со своей местностью, и подписи не слипаются', () => {
    const view = mapView(game(), TODAY);
    expect(view.tasks.map((t) => t.id).sort()).toEqual([
      'billing-migration',
      'deps-update',
      'onboarding-v2',
      'queue-incident',
      'review-policy',
      'second-rope',
    ]);
    for (const code of ['"', '#', '%', '!']) expect(count(view.cells, code)).toBeGreaterThan(0);
    for (const a of view.tasks) {
      expect(view.cells[Math.round(a.y * view.detail)]?.[Math.round(a.x * view.detail)]).toBeDefined();
      for (const b of view.tasks) {
        if (a.id >= b.id) continue;
        expect(Math.hypot((a.x - b.x) / 2.4, a.y - b.y)).toBeGreaterThan(5);
      }
    }
  });

  it('шторм рисуется, только пока есть переход-шторм', () => {
    const g = game();
    task(g, 'queue-incident').status = 'done';
    const view = mapView(g, TODAY);
    expect(count(view.cells, '!')).toBe(0);
    expect(view.tasks.map((t) => t.id)).not.toContain('queue-incident');
  });

  it('местность перехода меняет рельеф', () => {
    const g = game();
    const before = count(mapView(g, TODAY).cells, '%');
    task(g, 'queue-incident').terrain = 'fog';
    const view = mapView(g, TODAY);
    expect(count(view.cells, '!')).toBe(0);
    expect(count(view.cells, '%')).toBeGreaterThan(before);
  });

  it('пятно растёт, пока переход открыт, но не бесконечно', () => {
    const radius = (today: string) => mapView(game(), today).tasks.find((t) => t.id === 'queue-incident')!.radius;
    expect(radius('2026-11-13')).toBe(4.5);
    expect(radius('2026-11-23')).toBe(5.5);
    expect(radius('2027-03-01')).toBe(6.5);
    expect(mapView(game(), '2027-03-01').tasks.find((t) => t.id === 'deps-update')!.radius).toBe(3.5);
  });

  it('отряд стоит между пройденным лагерем и целью и сдвигается с каждым пройденным переходом', () => {
    const g = game();
    const start = mapView(g, TODAY);
    const [from, to] = [start.route[1]!, start.route[2]!];
    expect(start.squad).toMatchObject({ from: 1, done: 0, total: 5 });
    expect(start.squad.x).toBeGreaterThan(from.x);
    expect(start.squad.x).toBeLessThan(to.x);

    task(g, 'deps-update').status = 'done';
    task(g, 'queue-incident').status = 'done';
    const later = mapView(g, TODAY);
    expect(later.squad).toMatchObject({ done: 2, total: 5 });
    expect(later.squad.x).toBeGreaterThan(start.squad.x);
    expect(later.squad.x).toBeLessThan(to.x);
  });

  it('погода задаёт дальность обзора: в шторм вершина в дымке, в ясную погоду видно всё', () => {
    const g = game();
    const storming = mapView(g, TODAY);
    expect(storming.sight).not.toBeNull();
    expect(storming.route.at(-1)!.hazy).toBe(true);
    expect(storming.route[2]!.hazy).toBe(false);

    g.map.weather.stage = 'performing';
    const clear = mapView(g, TODAY);
    expect(clear.sight).toBeNull();
    expect(clear.route.some((p) => p.hazy)).toBe(false);
    expect(clear.cells).toEqual(storming.cells);
  });

  it('цель не уходит в дымку, даже когда до неё далеко', () => {
    const g = game();
    g.map.camps = [
      { id: 'base', name: 'База', phase: 'done' },
      { id: 'beta', name: 'Бета', phase: 'current' },
    ];
    g.map.weather.stage = 'forming';
    expect(mapView(g, TODAY).route.map((p) => p.hazy)).toEqual([false, false]);
  });

  it('линтер RACI виден на карте', () => {
    const view = mapView(game(), TODAY);
    const lint = Object.fromEntries(view.tasks.map((t) => [t.id, t.lint]));
    expect(lint['deps-update']).toEqual(['отвечает агент — нужен человек']);
    expect(lint['second-rope']).toEqual(['никто не ведёт']);
    expect(lint['billing-migration']).toEqual([]);
  });

  it('строится только по слою отряда: листы, заметки и ходы на неё не влияют', () => {
    const g = game();
    const full = mapView(g, TODAY);
    const bare = mapView({ ...g, sheets: {}, journals: {}, privates: {}, turns: [] }, TODAY);
    expect(bare).toEqual(full);
    expect(strategy({ ...g, sheets: {}, journals: {}, privates: {}, turns: [] }, bare)).toEqual(strategy(g, full));
  });

  it('работает на папке из одного лагеря и без переходов', () => {
    const g = game();
    g.map.camps = [{ id: 'beta', name: 'Бета', phase: 'current' }];
    g.tasks = [];
    const view = mapView(g, TODAY);
    expect(view.route).toHaveLength(1);
    expect(view.squad).toMatchObject({ x: view.route[0]!.x, y: view.route[0]!.y, total: 0 });
    expect(view.tasks).toEqual([]);
  });

  it('переход без лагеря попадает на участок к цели', () => {
    const g = game();
    delete task(g, 'deps-update').camp;
    const view = mapView(g, TODAY);
    expect(view.tasks.find((t) => t.id === 'deps-update')!.camp).toBeNull();
    expect(view.squad.total).toBe(4);
  });
});

describe('стратегия', () => {
  it('дальний маршрут: подписи лагерей и открытые переходы по местности', () => {
    const s = strategy(game(), mapView(game(), TODAY));
    expect(s.camps.map((c) => `${c.label} · ${c.name}`)).toEqual([
      'база · База',
      'лагерь 1 · MVP',
      'лагерь 2 · Бета-релиз',
      'лагерь 3 · Первые платящие',
      'вершина · Окупаемость',
    ]);
    const beta = s.camps.find((c) => c.id === 'beta')!;
    expect(beta.isTarget).toBe(true);
    expect(beta.open).toEqual({ trail: 1, pass: 2, fog: 1, storm: 1 });
    expect(s.camps.find((c) => c.id === 'paying')!.open.fog).toBe(1);
  });

  it('состав: план и роли по Белбину, которых нет', () => {
    const g = game();
    const s = strategy(g, mapView(g, TODAY));
    expect(s.squad).toMatchObject({ people: 5, agents: 2, headcount: { target: 12, by: '2027-11-01', need: 7 } });
    expect(s.squad.missingRoles).toEqual(['исследователь ресурсов', 'координатор', 'мотиватор', 'душа команды', 'доводчик']);

    for (const p of g.people) delete p.belbin;
    delete g.map.headcount;
    const empty = strategy(g, mapView(g, TODAY));
    expect(empty.squad.missingRoles).toBeNull();
    expect(empty.squad.headcount).toBeNull();
  });

  it('трещины: навык на одном человеке и переход, который никто не ведёт', () => {
    const g = game();
    const s = strategy(g, mapView(g, TODAY));
    expect(s.cracks.find((c) => c.target === 'databases')).toMatchObject({ code: 'spof', title: 'Базы данных' });
    expect(s.cracks.find((c) => c.target === 'databases')!.text).toContain('Марк');
    expect(s.cracks.find((c) => c.target === 'second-rope')).toMatchObject({ code: 'stuck' });
    // Нагрузка — слой пары: в трещинах её нет.
    expect(JSON.stringify(s)).not.toMatch(/\d+%/);
  });
});

describe('внимание на маршрут', () => {
  it('считает, сколько потрачено и сколько из этого ушло на маршрут', () => {
    expect(attentionSplit(game(), TODAY)).toEqual({ windowDays: 14, turns: 1, spent: 6, route: 3 });
  });

  it('ходы за пределами окна и из будущего не учитываются', () => {
    expect(attentionSplit(game(), '2026-11-27')).toMatchObject({ turns: 0, spent: 0, route: 0 });
    expect(attentionSplit(game(), '2026-11-12')).toMatchObject({ turns: 0 });
  });
});
