import type { MapView } from '@svyazka/engine';

/**
 * Раскладка подписей на карте. Считается в клетках карты при самой мелкой
 * клетке, на которую рассчитан экран: если подписи не пересекаются здесь,
 * на более широком экране они тем более не пересекутся.
 */

/** Ширина клетки в пикселях при минимальной ширине карты. */
export const CELL_PX = 12;
export const MAP_MIN_WIDTH = 72 * CELL_PX;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type Anchor = 'left' | 'right' | 'above' | 'below' | 'center';

export interface Placed {
  /** Точка привязки в клетках и сторона, с которой от неё стоит подпись. */
  x: number;
  y: number;
  anchor: Anchor;
}

const cells = (px: number) => px / CELL_PX;
/** Прямоугольник подписи для заданной стороны. `gap` — отступ от точки. */
function boxAt(x: number, y: number, w: number, h: number, anchor: Anchor, gap: number): Box {
  switch (anchor) {
    case 'left':
      return { left: x - gap - w, top: y - h / 2, width: w, height: h };
    case 'right':
      return { left: x + gap, top: y - h / 2, width: w, height: h };
    case 'above':
      return { left: x - w / 2, top: y - gap - h, width: w, height: h };
    case 'below':
      return { left: x - w / 2, top: y + gap, width: w, height: h };
    case 'center':
      return { left: x - w / 2, top: y - h / 2, width: w, height: h };
  }
}

/** Размер подписи перехода: две строки и, если есть замечание линтера, третья. */
export function taskBox(task: { id: string; head: string; lint: string | null }): { width: number; height: number } {
  const chars = Math.max(task.head.length * 6.9, task.id.length * 7.6, (task.lint?.length ?? 0) * 6.4);
  return { width: cells(chars + 22), height: cells(task.lint ? 62 : 46) };
}

export function pointBox(text: string): { width: number; height: number } {
  return { width: cells(text.length * 7.3 + 18), height: cells(24) };
}

export const TERRAIN_NAME = { trail: 'тропа', pass: 'перевал', fog: 'туман', storm: 'шторм' } as const;
export const dayOf = (days: number | null) => (days === null ? null : `день ${Math.max(0, days) + 1}`);

/** Первая строка подписи перехода: местность и сколько дней он открыт. */
export const taskHead = (t: Pick<MapView['tasks'][number], 'terrain' | 'status' | 'days'>) =>
  [TERRAIN_NAME[t.terrain].toUpperCase(), t.status === 'blocked' ? 'СТОИТ' : dayOf(t.days)].filter(Boolean).join(' · ');

/** Подпись лагеря на карте. */
export function pointText(p: Pick<MapView['route'][number], 'kind' | 'number' | 'name' | 'phase'>): string {
  if (p.kind === 'base') return p.name.toLowerCase();
  return `${p.kind === 'summit' ? 'вершина' : `лагерь ${p.number}`} · ${p.name}${p.phase === 'done' ? ' ✓' : ''}`;
}

export const SQUAD_LABEL = 'отряд здесь';

/** Раскладка подписей для карты с теми текстами, которые показывает экран. */
export const labelsFor = (view: LabelInput['view']) =>
  placeLabels({
    view,
    taskLabels: Object.fromEntries(view.tasks.map((t) => [t.id, { head: taskHead(t), lint: t.lint[0] ?? null }])),
    pointLabels: Object.fromEntries(view.route.map((p) => [p.id, pointText(p)])),
    squadLabel: SQUAD_LABEL,
  });

export interface LabelInput {
  view: Pick<MapView, 'cols' | 'rows' | 'route' | 'squad' | 'tasks'>;
  taskLabels: Record<string, { head: string; lint: string | null }>;
  pointLabels: Record<string, string>;
  squadLabel: string;
}

export interface Labels {
  tasks: Record<string, Placed>;
  points: Record<string, Placed>;
  squad: Placed;
}

/** Зазор между подписями, в клетках. */
const GAP = 0.4;

/**
 * Раздвигает подписи переходов, пока они не перестанут наезжать друг на друга
 * и на значки лагерей. Подпись сдвигается по той оси, где наезд меньше, так что
 * остаётся рядом со своим пятном. Порядок обхода фиксирован: результат один и тот же.
 */
function spread(boxes: Box[], fixed: Box[], cols: number, rows: number): void {
  const keepIn = (b: Box) => {
    b.left = Math.min(Math.max(b.left, 0.6), cols - b.width - 0.6);
    b.top = Math.min(Math.max(b.top, 0.6), rows - b.height - 0.6);
  };
  const push = (a: Box, b: Box, share: number): boolean => {
    const dx = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left) + GAP;
    const dy = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top) + GAP;
    if (dx <= 0 || dy <= 0) return false;
    if (dy <= dx) {
      const up = a.top + a.height / 2 <= b.top + b.height / 2 ? -1 : 1;
      a.top += up * dy * share;
      b.top -= up * dy * (1 - share);
    } else {
      const left = a.left + a.width / 2 <= b.left + b.width / 2 ? -1 : 1;
      a.left += left * dx * share;
      b.left -= left * dx * (1 - share);
    }
    return true;
  };
  boxes.forEach(keepIn);
  for (let round = 0; round < 200; round += 1) {
    let moved = false;
    for (let i = 0; i < boxes.length; i += 1) {
      const a = boxes[i] as Box;
      for (let j = i + 1; j < boxes.length; j += 1) moved = push(a, boxes[j] as Box, 0.5) || moved;
      // Значок лагеря стоит на месте: двигается только подпись.
      for (const f of fixed) moved = push(a, { ...f }, 1) || moved;
      keepIn(a);
    }
    if (!moved) return;
  }
}

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

/**
 * Подписи переходов стоят на своих пятнах и раздвигаются, если им тесно. Подписи
 * лагерей и отряда выбирают сторону, где свободно: сначала слева, как на бумажной карте.
 */
export function placeLabels({ view, taskLabels, pointLabels, squadLabel }: LabelInput): Labels {
  const inside = (b: Box) => b.left >= 0.5 && b.top >= 0.5 && b.left + b.width <= view.cols - 0.5 && b.top + b.height <= view.rows - 0.5;

  // Значки лагерей и отряда занимают место и не двигаются.
  const marks: Box[] = [...view.route.map((p) => boxAt(p.x, p.y, 1.8, 1.8, 'center', 0)), boxAt(view.squad.x, view.squad.y, 2.2, 2.2, 'center', 0)];
  const taskBoxes = view.tasks.map((t) => {
    const size = taskBox({ id: t.id, ...(taskLabels[t.id] ?? { head: '', lint: null }) });
    return boxAt(t.x, t.y, size.width, size.height, 'center', 0);
  });
  spread(taskBoxes, marks, view.cols, view.rows);

  const tasks: Labels['tasks'] = {};
  view.tasks.forEach((t, i) => {
    const box = taskBoxes[i] as Box;
    tasks[t.id] = { x: box.left + box.width / 2, y: box.top + box.height / 2, anchor: 'center' };
  });
  const taken: Box[] = [...taskBoxes, ...marks];

  const pick = (x: number, y: number, text: string, order: Anchor[]): Placed => {
    const size = pointBox(text);
    const options = order.map((anchor) => ({ anchor, box: boxAt(x, y, size.width, size.height, anchor, 1.3) }));
    // Свободная сторона, а если такой нет — та, где наезд меньше всего.
    const cost = (box: Box) => taken.reduce((sum, t) => sum + overlap(t, box), 0) + (inside(box) ? 0 : 1000);
    const best = options.reduce((a, b) => (cost(b.box) < cost(a.box) ? b : a));
    taken.push(best.box);
    return { x, y, anchor: best.anchor };
  };

  const points: Labels['points'] = {};
  for (const p of view.route) points[p.id] = pick(p.x, p.y, pointLabels[p.id] ?? p.name, ['left', 'right', 'above', 'below']);
  const squad = pick(view.squad.x, view.squad.y, squadLabel, ['right', 'below', 'left', 'above']);
  return { tasks, points, squad };
}
