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
const hits = (a: Box, b: Box) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

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

/**
 * Подписи переходов стоят по центру своих пятен. Подписи лагерей и отряда
 * выбирают сторону, где свободно: сначала слева, как на бумажной карте.
 */
export function placeLabels({ view, taskLabels, pointLabels, squadLabel }: LabelInput): Labels {
  const taken: Box[] = [];
  const inside = (b: Box) => b.left >= 0.5 && b.top >= 0.5 && b.left + b.width <= view.cols - 0.5 && b.top + b.height <= view.rows - 0.5;
  const free = (b: Box) => inside(b) && !taken.some((t) => hits(t, b));

  const tasks: Labels['tasks'] = {};
  for (const t of view.tasks) {
    const size = taskBox({ id: t.id, ...(taskLabels[t.id] ?? { head: '', lint: null }) });
    // У края карты подпись сдвигается внутрь, а не обрезается.
    const x = Math.min(Math.max(t.x, size.width / 2 + 0.6), view.cols - size.width / 2 - 0.6);
    const y = Math.min(Math.max(t.y, size.height / 2 + 0.6), view.rows - size.height / 2 - 0.6);
    tasks[t.id] = { x, y, anchor: 'center' };
    taken.push(boxAt(x, y, size.width, size.height, 'center', 0));
  }
  // Значки лагерей и отряда тоже занимают место.
  for (const p of view.route) taken.push(boxAt(p.x, p.y, 1.6, 1.6, 'center', 0));
  taken.push(boxAt(view.squad.x, view.squad.y, 2, 2, 'center', 0));

  const pick = (x: number, y: number, text: string, order: Anchor[]): Placed => {
    const size = pointBox(text);
    for (const anchor of order) {
      const box = boxAt(x, y, size.width, size.height, anchor, 1.3);
      if (free(box)) {
        taken.push(box);
        return { x, y, anchor };
      }
    }
    const anchor = order[0] as Anchor;
    taken.push(boxAt(x, y, size.width, size.height, anchor, 1.3));
    return { x, y, anchor };
  };

  const points: Labels['points'] = {};
  for (const p of view.route) points[p.id] = pick(p.x, p.y, pointLabels[p.id] ?? p.name, ['left', 'right', 'above', 'below']);
  const squad = pick(view.squad.x, view.squad.y, squadLabel, ['right', 'below', 'left', 'above']);
  return { tasks, points, squad };
}
