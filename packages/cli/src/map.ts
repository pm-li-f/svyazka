import type { Game } from '@svyazka/core';
import { attentionSplit, mapView, type MapView, strategy } from '@svyazka/engine';
import { type Cell, makePaint, type Paint, table } from './format.js';

const TERRAIN = { trail: 'тропа', pass: 'перевал', fog: 'туман', storm: 'шторм' } as const;
const CYCLE = { initiating: 'замысел', planning: 'маршрут', executing: 'переход', monitoring: 'сверка', closing: 'разбор' } as const;
const PHASE = { done: 'разбор ✓', current: 'идём', planned: 'маршрут', idea: 'замысел' } as const;

/** Цвета клеток в палитре из 256 цветов: её понимают и старые терминалы. */
const COLOR: Record<string, number> = { '.': 22, ',': 65, ':': 243, '^': 252, '~': 24, '"': 107, '#': 138, '%': 109, '!': 131 };
/** Без цвета рельеф рисуется знаками. */
const GLYPH: Record<string, string> = { '.': ' ', ',': '.', ':': ':', '^': '^', '~': '~', '"': ',', '#': '#', '%': '%', '!': '!' };
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

const plain = makePaint(false);
const ruDate = (iso: string) => iso.split('-').reverse().join('.');

/**
 * Картинка карты. Одна строка терминала — две строки клеток: с цветом они
 * рисуются полублоками, без цвета берётся верхняя клетка пары.
 */
function picture(view: MapView, marks: Map<string, string>, p: Paint): string[] {
  const lines: string[] = [];
  for (let y = 0; y < view.rows; y += 2) {
    let line = '';
    for (let x = 0; x < view.cols; x += 1) {
      // В терминале знак крупнее пикселя карты: берём по одной клетке на единицу раскладки.
      const top = view.cells[y * view.detail]?.[x * view.detail] ?? '.';
      const bottom = view.cells[(y + 1) * view.detail]?.[x * view.detail] ?? top;
      const mark = marks.get(`${x}:${y >> 1}`);
      if (!p.enabled) line += mark ?? GLYPH[top] ?? ' ';
      else if (mark) line += `\u001b[1;38;5;220;48;5;234m${mark}\u001b[0m`;
      else line += `\u001b[38;5;${COLOR[top] ?? 22};48;5;${COLOR[bottom] ?? 22}m▀\u001b[0m`;
    }
    lines.push(p.enabled ? line : line.trimEnd());
  }
  return lines;
}

export function renderMap(game: Game, today: string, p: Paint = plain): string {
  const view = mapView(game, today);
  const plan = strategy(game, view);
  const split = attentionSplit(game, today);
  const weather = game.map.weather;

  // Значки на картинке: у лагерей — номер, у переходов — буква, отряд — ромб.
  const marks = new Map<string, string>();
  const put = (x: number, y: number, mark: string) => marks.set(`${Math.round(x)}:${Math.round(y) >> 1}`, mark);
  const pointMark = (i: number) => {
    const point = view.route[i];
    return point?.kind === 'base' ? 'Б' : point?.kind === 'summit' ? '▲' : String(point?.number ?? '?');
  };
  const letters = new Map(view.tasks.map((t, i) => [t.id, LETTERS[i % LETTERS.length] as string]));
  view.tasks.forEach((t) => put(t.x, t.y, letters.get(t.id) as string));
  view.route.forEach((point, i) => put(point.x, point.y, pointMark(i)));
  put(view.squad.x, view.squad.y, '◆');

  const camps: Cell[][] = plan.camps.map((c, i) => [
    { t: pointMark(i), c: p.yellow },
    { t: `${c.label} · ${c.name}`, c: c.isTarget ? p.bold : undefined },
    { t: c.isTarget ? `▸ ${CYCLE[game.map.cycle]}` : PHASE[c.phase], c: p.dim },
    [c.note, c.hazy ? 'в дымке' : null].filter(Boolean).join(' · '),
  ]);
  const from = view.route[view.squad.from];
  const target = plan.camps.find((c) => c.isTarget);
  const where =
    from?.id === target?.id ? `отряд у лагеря «${target?.name ?? ''}»` : `отряд между «${from?.name ?? ''}» и «${target?.name ?? ''}»`;
  const squadLine =
    view.squad.total === 0 ? `${where}, переходов к цели пока нет` : `${where}, пройдено переходов: ${view.squad.done} из ${view.squad.total}`;

  const terrainPaint = { trail: p.dim, pass: p.bold, fog: p.blue, storm: p.red } as const;
  const tasks: Cell[][] = view.tasks.map((t) => [
    { t: letters.get(t.id) as string, c: p.yellow },
    { t: TERRAIN[t.terrain], c: terrainPaint[t.terrain] },
    { t: t.id, c: p.bold },
    t.status === 'blocked' ? { t: 'стоит', c: p.red } : t.days === null ? '—' : `день ${Math.max(0, t.days) + 1}`,
    `ведёт ${t.leads.join(', ') || 'никто'} · отвечает ${t.accountable ?? 'никто'}`,
    {
      t: [...t.lint, ...(t.probes.length ? [`разведок ${t.probes.length}, с выводом ${t.probes.filter((x) => x.outcome !== null).length}`] : [])].join('; '),
      c: t.lint.length ? p.yellow : p.dim,
    },
  ]);

  const squad = plan.squad;
  const composition = [
    squad.headcount
      ? squad.headcount.need === 0
        ? `людей ${squad.people}, план состава выполнен, агентов ${squad.agents}`
        : `людей ${squad.people} → ${squad.headcount.target} к ${ruDate(squad.headcount.by)}, агентов ${squad.agents}`
      : `людей ${squad.people}, агентов ${squad.agents}`,
    squad.missingRoles === null
      ? 'роли по Белбину ни у кого не заполнены'
      : squad.missingRoles.length === 0
        ? 'все роли по Белбину в отряде есть'
        : `нет ролей: ${squad.missingRoles.join(', ')}`,
  ];

  const cracks = plan.cracks.map((c) => `${(c.code === 'spof' ? p.red : p.yellow)(c.title)}: ${c.text}`);
  const attention =
    split.turns === 0
      ? `за ${split.windowDays} дн. ходов не было`
      : `за ${split.windowDays} дн. потрачено ${split.spent}, из них на маршрут — ${split.route}`;

  return [
    p.dim(`карта · ${today} · цикл: ${CYCLE[game.map.cycle]} · погода: ${weather.stage}${weather.note ? ` (${weather.note})` : ''}`),
    ...(plan.vision ? [`вершина: ${plan.vision}`] : []),
    '',
    ...picture(view, marks, p),
    p.dim(
      p.enabled
        ? 'зелёное — лес, серое — скалы, светлое — снег, синее — вода; пятна — местность переходов'
        : '. лес  : скалы  ^ снег  ~ вода  , тропа  # перевал  % туман  ! шторм',
    ),
    '',
    p.dim('маршрут'),
    ...table(camps),
    `${p.yellow('◆')}  ${squadLine}`,
    ...(view.route.some((point) => point.hazy) ? [p.dim(`дальний маршрут в дымке: погода ${weather.stage}`)] : []),
    '',
    p.dim('переходы'),
    ...(tasks.length ? table(tasks) : [p.dim('открытых переходов нет')]),
    '',
    p.dim('состав'),
    ...composition,
    '',
    p.dim('трещины'),
    ...(cracks.length ? cracks : [p.dim('не видно')]),
    `${p.yellow('внимание командира')}: ${attention}`,
  ].join('\n');
}
