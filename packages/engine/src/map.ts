import type { Game, GameMap, Task } from '@svyazka/core';
import { daysBetween } from './dates.js';
import { raciLint } from './raci.js';
import { skillCoverage } from './skills.js';

/**
 * Карта экспедиции. Чистая функция от состояния игры и даты: одно и то же
 * состояние всегда даёт одну и ту же карту, а рельеф меняется вместе с данными.
 *
 * Откуда что берётся:
 *   маршрут и лагеря   — team/map.yaml, по порядку;
 *   положение отряда   — доля пройденных переходов к цели;
 *   тропа, перевал, туман, шторм — открытые переходы и их местность по Кеневину;
 *   размер пятна       — сколько дней переход открыт;
 *   дальность обзора   — погода, то есть стадия команды по Такману.
 *
 * Карта строится только по слою `team`: её можно показывать всему отряду.
 */

export const MAP_COLS = 72;
export const MAP_ROWS = 46;

/** Клетки рельефа и их однобуквенные коды в `MapView.cells`. */
export const GROUND = {
  '.': 'forest',
  ',': 'wood',
  ':': 'rock',
  '^': 'snow',
  '~': 'water',
  '"': 'meadow',
  '#': 'ridge',
  '%': 'fog',
  '!': 'storm',
} as const;
export type GroundCode = keyof typeof GROUND;
export type Ground = (typeof GROUND)[GroundCode];

type Terrain = Task['terrain'];
type Phase = GameMap['camps'][number]['phase'];

export interface MapPoint {
  id: string;
  name: string;
  phase: Phase;
  note: string | null;
  kind: 'base' | 'camp' | 'summit';
  /** Порядковый номер лагеря на маршруте; у базы и вершины — null. */
  number: number | null;
  x: number;
  y: number;
  /** Лагерь за целью, до которого при нынешней погоде не видно. */
  hazy: boolean;
}

export interface MapTask {
  id: string;
  title: string;
  terrain: Terrain;
  status: Task['status'];
  /** Лагерь, к которому ведёт переход. null — переход не привязан к маршруту. */
  camp: string | null;
  note: string | null;
  days: number | null;
  /** Кто ведёт и кто отвечает — именами. */
  leads: string[];
  accountable: string | null;
  consulted: string[];
  /** Замечания линтера RACI по этому переходу, короткими фразами. */
  lint: string[];
  /** Разведки: гипотеза и вывод по ней. null — вывода ещё нет. */
  probes: { text: string; outcome: string | null }[];
  x: number;
  y: number;
  /** Радиус пятна местности в клетках по вертикали; по горизонтали пятно шире. */
  radius: number;
}

export interface MapView {
  cols: number;
  rows: number;
  /** Рельеф: `rows` строк по `cols` знаков, коды из `GROUND`. */
  cells: string[];
  route: MapPoint[];
  squad: {
    x: number;
    y: number;
    /** Индекс лагеря в `route`, из которого вышли. */
    from: number;
    /** Переходы к цели: сколько пройдено и сколько всего. */
    done: number;
    total: number;
  };
  tasks: MapTask[];
  /** Дальность обзора в клетках от отряда. null — ясно, видно всё. */
  sight: number | null;
}

// ---------------------------------------------------------------- случайность от состояния

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Число от 0 до 1 для узла решётки. Только целочисленная арифметика: результат одинаков на любой машине. */
function lattice(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 0x100000000;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  return lerp(
    lerp(lattice(ix, iy, seed), lattice(ix + 1, iy, seed), fx),
    lerp(lattice(ix, iy + 1, seed), lattice(ix + 1, iy + 1, seed), fx),
    fy,
  );
}

/** Два слоя шума: крупные формы и мелкая рябь. */
const relief = (x: number, y: number, seed: number) => 0.68 * noise(x, y, seed) + 0.32 * noise(x * 2.3, y * 2.3, seed ^ 0x5bd1e995);

const unit = (text: string) => hash(text) / 0x100000000;

// ---------------------------------------------------------------- раскладка

interface P {
  x: number;
  y: number;
}

/** Подписи шире, чем выше, поэтому по горизонтали точки держатся дальше друг от друга. */
const STRETCH = 2.4;
const apart = (a: P, b: P) => Math.hypot((a.x - b.x) / STRETCH, a.y - b.y);

function layoutRoute(camps: GameMap['camps'], seed: number): P[] {
  const from: P = { x: MAP_COLS * 0.1, y: MAP_ROWS * 0.86 };
  const to: P = { x: MAP_COLS * 0.8, y: MAP_ROWS * 0.2 };
  if (camps.length === 1) return [{ x: MAP_COLS / 2, y: MAP_ROWS / 2 }];
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const normal: P = { x: -(to.y - from.y) / len, y: (to.x - from.x) / len };
  const side = lattice(1, 1, seed) < 0.5 ? -1 : 1;
  return camps.map((camp, i) => {
    const t = i / (camps.length - 1);
    const end = i === 0 || i === camps.length - 1;
    // Дуга в одну сторону и небольшой сдвиг у каждого лагеря: маршрут не бывает прямой линией.
    const bend = Math.sin(t * Math.PI) * 4.5 * side + (end ? 0 : (unit(`camp:${camp.id}`) - 0.5) * 3);
    return { x: lerp(from.x, to.x, t) + normal.x * bend, y: lerp(from.y, to.y, t) + normal.y * bend };
  });
}

function layoutTasks(open: Task[], camps: GameMap['camps'], route: P[], targetIndex: number): Map<string, P> {
  const bySegment = new Map<number, Task[]>();
  for (const task of open) {
    const found = task.camp === undefined ? -1 : camps.findIndex((c) => c.id === task.camp);
    const index = found === -1 ? targetIndex : found;
    bySegment.set(index, [...(bySegment.get(index) ?? []), task]);
  }

  const spots: { id: string; p: P }[] = [];
  for (const [index, tasks] of [...bySegment].sort((a, b) => a[0] - b[0])) {
    const a = route[Math.max(0, index - 1)] as P;
    const b = route[index] as P;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const along: P = index === 0 ? { x: 1, y: 0 } : { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const normal: P = { x: -along.y, y: along.x };
    [...tasks]
      .sort((x, y) => x.id.localeCompare(y.id))
      .forEach((task, j) => {
        const t = 0.2 + (0.7 * (j + 0.5)) / tasks.length;
        const side = j % 2 === 0 ? 1 : -1;
        const off = 7 + 5 * unit(`task:${task.id}`) + Math.floor(j / 2) * 2;
        spots.push({
          id: task.id,
          p: { x: lerp(a.x, b.x, t) + normal.x * off * side, y: lerp(a.y, b.y, t) + normal.y * off * side },
        });
      });
  }

  // Разводим точки, чтобы подписи не наезжали друг на друга и на лагеря. Порядок обхода фиксирован.
  const keepIn = (p: P) => {
    p.x = clamp(p.x, 9, MAP_COLS - 10);
    p.y = clamp(p.y, 5, MAP_ROWS - 6);
  };
  spots.forEach((s) => keepIn(s.p));
  for (let round = 0; round < 60; round += 1) {
    for (let i = 0; i < spots.length; i += 1) {
      const a = (spots[i] as { p: P }).p;
      for (let j = i + 1; j < spots.length; j += 1) {
        const b = (spots[j] as { p: P }).p;
        const d = apart(a, b);
        if (d >= 6) continue;
        const push = (6 - d) / 2 + 0.01;
        const dx = d === 0 ? 1 : (a.x - b.x) / STRETCH / d;
        const dy = d === 0 ? 0 : (a.y - b.y) / d;
        a.x += dx * push * STRETCH;
        a.y += dy * push;
        b.x -= dx * push * STRETCH;
        b.y -= dy * push;
      }
      for (const camp of route) {
        const d = apart(a, camp);
        if (d >= 4.5) continue;
        const push = 4.5 - d + 0.01;
        a.x += (d === 0 ? 1 : (a.x - camp.x) / STRETCH / d) * push * STRETCH;
        a.y += (d === 0 ? 0 : (a.y - camp.y) / d) * push;
      }
      keepIn(a);
    }
  }
  return new Map(spots.map((s) => [s.id, s.p]));
}

function distanceToRoute(p: P, route: P[]): number {
  let best = Infinity;
  for (let i = 0; i < route.length; i += 1) {
    const a = route[Math.max(0, i - 1)] as P;
    const b = route[i] as P;
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2, 0, 1);
    best = Math.min(best, Math.hypot(p.x - lerp(a.x, b.x, t), p.y - lerp(a.y, b.y, t)));
  }
  return best;
}

// ---------------------------------------------------------------- рельеф

const STAMP: Record<Terrain, { code: GroundCode; radius: number; grows: boolean; order: number }> = {
  trail: { code: '"', radius: 3.5, grows: false, order: 0 },
  pass: { code: '#', radius: 3.5, grows: true, order: 1 },
  fog: { code: '%', radius: 4.5, grows: true, order: 2 },
  storm: { code: '!', radius: 4.5, grows: true, order: 3 },
};

const STAMP_WIDE = 1.9;

/** Пятно растёт на клетку за десять дней, но не больше чем на две: застарелый шторм виден издалека. */
const stampRadius = (terrain: Terrain, days: number | null) =>
  STAMP[terrain].radius + (STAMP[terrain].grows && days !== null ? Math.min(2, Math.floor(Math.max(0, days) / 10)) : 0);

function paintGround(route: P[], tasks: MapTask[], seed: number): string[] {
  const summit = route[route.length - 1] as P;
  const reach = Math.hypot(MAP_COLS, MAP_ROWS) * 0.62;
  const grid: GroundCode[][] = [];

  for (let y = 0; y < MAP_ROWS; y += 1) {
    const row: GroundCode[] = [];
    for (let x = 0; x < MAP_COLS; x += 1) {
      const height = 0.66 * (1 - clamp(Math.hypot(x - summit.x, y - summit.y) / reach, 0, 1)) + 0.34 * relief(x * 0.085, y * 0.085, seed);
      let code: GroundCode = height > 0.74 ? '^' : height > 0.62 ? ':' : height > 0.48 ? ',' : '.';
      if (height < 0.44 && relief(x * 0.06 + 40, y * 0.06 + 40, seed ^ 0x9e3779b9) < 0.3 && distanceToRoute({ x, y }, route) > 4) {
        code = '~';
      }
      row.push(code);
    }
    grid.push(row);
  }

  for (const task of [...tasks].sort((a, b) => STAMP[a.terrain].order - STAMP[b.terrain].order || a.id.localeCompare(b.id))) {
    const edge = hash(`edge:${task.id}`);
    const r = task.radius;
    // Пятно вытянуто по горизонтали, как и подпись: его видно вокруг неё.
    const rx = r * STAMP_WIDE * 1.4;
    const ry = r * 1.4;
    for (let y = Math.max(0, Math.floor(task.y - ry)); y <= Math.min(MAP_ROWS - 1, Math.ceil(task.y + ry)); y += 1) {
      for (let x = Math.max(0, Math.floor(task.x - rx)); x <= Math.min(MAP_COLS - 1, Math.ceil(task.x + rx)); x += 1) {
        const d = Math.hypot((x - task.x) / STAMP_WIDE, y - task.y);
        if (d < r * (0.7 + 0.6 * noise(x * 0.3, y * 0.3, edge))) (grid[y] as GroundCode[])[x] = STAMP[task.terrain].code;
      }
    }
  }
  return grid.map((row) => row.join(''));
}

// ---------------------------------------------------------------- карта

/** Какую часть карты видно при нынешней погоде. В шторм дальний маршрут не разглядеть. */
const SIGHT: Record<GameMap['weather']['stage'], number | null> = {
  forming: 0.5,
  storming: 0.42,
  norming: 0.72,
  performing: null,
};

export function mapView(game: Game, today: string): MapView {
  const { camps, target, weather } = game.map;
  const seed = hash([game.map.vision ?? '', ...camps.map((c) => c.id)].join('|'));
  const name = (id: string) =>
    game.people.find((p) => p.id === id)?.name ?? game.agents.find((a) => a.id === id)?.name ?? id;

  const points = layoutRoute(camps, seed);
  const targetIndex = Math.max(0, camps.findIndex((c) => c.id === target));
  const fromIndex = Math.max(0, targetIndex - 1);

  const toTarget = game.tasks.filter((t) => t.camp === target);
  const done = toTarget.filter((t) => t.status === 'done').length;
  const progress = toTarget.length === 0 ? 0 : done / toTarget.length;
  const a = points[fromIndex] as P;
  const b = points[targetIndex] as P;
  // Отряд не стоит ровно на лагере: вышли — значит, уже в пути.
  const step = fromIndex === targetIndex ? 0 : 0.14 + 0.72 * progress;
  const squad = { x: lerp(a.x, b.x, step), y: lerp(a.y, b.y, step) };

  const open = game.tasks.filter((t) => t.status !== 'done');
  const spots = layoutTasks(open, camps, points, targetIndex);
  const findings = raciLint(game);
  const tasks: MapTask[] = open.map((task) => {
    const spot = spots.get(task.id) as P;
    const days = task.since === undefined ? null : daysBetween(task.since, today);
    const lint: string[] = [];
    for (const f of findings) {
      if (f.code === 'accountable-overload' || f.task !== task.id) continue;
      if (f.code === 'no-responsible') lint.push('никто не ведёт');
      if (f.code === 'no-accountable') lint.push('нет ответственного');
      if (f.code === 'agent-accountable') lint.push('отвечает агент — нужен человек');
    }
    return {
      id: task.id,
      title: task.title,
      terrain: task.terrain,
      status: task.status,
      camp: task.camp ?? null,
      note: task.note ?? null,
      days,
      leads: task.raci.R.map(name),
      accountable: task.raci.A === null ? null : name(task.raci.A),
      consulted: task.raci.C.map(name),
      lint,
      probes: task.probes.map((probe) => ({ text: probe.text, outcome: probe.outcome ?? null })),
      x: spot.x,
      y: spot.y,
      radius: stampRadius(task.terrain, days),
    };
  });

  const part = SIGHT[weather.stage];
  const sight = part === null ? null : Math.hypot(MAP_COLS, MAP_ROWS) * part;
  let number = 0;
  const route: MapPoint[] = camps.map((camp, i) => {
    const p = points[i] as P;
    const kind: MapPoint['kind'] = camp.phase === 'idea' && i === camps.length - 1 ? 'summit' : i === 0 && camp.phase === 'done' ? 'base' : 'camp';
    if (kind === 'camp') number += 1;
    return {
      id: camp.id,
      name: camp.name,
      phase: camp.phase,
      note: camp.note ?? null,
      kind,
      number: kind === 'camp' ? number : null,
      x: p.x,
      y: p.y,
      // Цель видна в любую погоду: в дымку уходит только то, что за ней.
      hazy: sight !== null && i > targetIndex && Math.hypot(p.x - squad.x, p.y - squad.y) > sight,
    };
  });

  return {
    cols: MAP_COLS,
    rows: MAP_ROWS,
    cells: paintGround(points, tasks, seed),
    route,
    squad: { ...squad, from: fromIndex, done, total: toTarget.length },
    tasks,
    sight,
  };
}

// ---------------------------------------------------------------- стратегия вокруг карты

export interface Strategy {
  vision: string | null;
  camps: {
    id: string;
    /** Как подписан на карте: «база», «лагерь 2», «вершина». */
    label: string;
    name: string;
    phase: Phase;
    note: string | null;
    isTarget: boolean;
    hazy: boolean;
    /** Открытые переходы к этому лагерю по местности. */
    open: Record<Terrain, number>;
  }[];
  squad: {
    people: number;
    agents: number;
    /** План состава и сколько людей до него не хватает. */
    headcount: { target: number; by: string; need: number } | null;
    /** Роли по Белбину, которых в отряде нет. null — роли ни у кого не заполнены. */
    missingRoles: string[] | null;
  };
  /** Трещины: то, на чём маршрут может сорваться. */
  cracks: { code: 'spof' | 'no-holder' | 'stuck'; target: string; title: string; text: string }[];
}

export const pointLabel = (p: Pick<MapPoint, 'kind' | 'number'>) =>
  p.kind === 'base' ? 'база' : p.kind === 'summit' ? 'вершина' : `лагерь ${p.number}`;

/** Правая колонка экрана стратегии: дальний маршрут, состав, трещины. Только слой `team`. */
export function strategy(game: Game, view: MapView): Strategy {
  const label = (id: string) => game.config.labels[id] ?? id;
  const name = (id: string) => game.people.find((p) => p.id === id)?.name ?? id;

  const filled = game.people.filter((p) => p.belbin !== undefined);
  const have = new Set(filled.map((p) => (p.belbin as string).trim().toLowerCase()));
  const plan = game.map.headcount;

  const cracks: Strategy['cracks'] = [];
  for (const c of skillCoverage(game)) {
    if (c.none) cracks.push({ code: 'no-holder', target: c.skill, title: label(c.skill), text: 'Навык не держит никто.' });
    else if (c.single) {
      cracks.push({
        code: 'spof',
        target: c.skill,
        title: label(c.skill),
        text: `Держит один человек — ${name(c.holders[0] as string)}. Сорвётся — связка стоит.`,
      });
    }
  }
  for (const t of view.tasks) {
    if (t.lint.includes('никто не ведёт')) cracks.push({ code: 'stuck', target: t.id, title: t.id, text: 'Никто не ведёт: переход стоит.' });
    else if (t.status === 'blocked') cracks.push({ code: 'stuck', target: t.id, title: t.id, text: `Переход стоит${t.note ? `: ${t.note}` : '.'}` });
  }

  return {
    vision: game.map.vision ?? null,
    camps: view.route.map((p) => {
      const open: Record<Terrain, number> = { trail: 0, pass: 0, fog: 0, storm: 0 };
      for (const t of view.tasks) if (t.camp === p.id) open[t.terrain] += 1;
      return {
        id: p.id,
        label: pointLabel(p),
        name: p.name,
        phase: p.phase,
        note: p.note,
        isTarget: p.id === game.map.target,
        hazy: p.hazy,
        open,
      };
    }),
    squad: {
      people: game.people.length,
      agents: game.agents.length,
      headcount: plan ? { target: plan.target, by: plan.by, need: Math.max(0, plan.target - game.people.length) } : null,
      missingRoles: filled.length === 0 ? null : game.config.belbin_roles.filter((r) => !have.has(r.trim().toLowerCase())),
    },
    cracks,
  };
}

/** Действие «поработать над маршрутом»: единственное, что тратит внимание на стратегию, а не на людей. */
export const ROUTE_ACTION = 'route-block';

export interface AttentionSplit {
  /** За сколько дней считаем, включая сегодня. */
  windowDays: number;
  turns: number;
  spent: number;
  /** Сколько из потраченного ушло на маршрут. */
  route: number;
}

/**
 * Куда уходило внимание руководителя: на людей и сигналы или на маршрут.
 * Это данные о самом руководителе — слой `me`, отряду не показываются.
 */
export function attentionSplit(game: Game, today: string): AttentionSplit {
  const windowDays = game.config.attention.window_days;
  const turns = game.turns.filter((t) => {
    const age = daysBetween(t.date, today);
    return age >= 0 && age < windowDays;
  });
  let spent = 0;
  let route = 0;
  for (const turn of turns) {
    for (const action of turn.actions) {
      spent += action.cost;
      if (action.kind === ROUTE_ACTION) route += action.cost;
    }
  }
  return { windowDays, turns: turns.length, spent, route };
}
