import { type CSSProperties, type FormEvent, useEffect, useRef, useState } from 'react';
import { api, type StateView } from '../api';
import { CYCLE, Panel, type Run, Scroll, STATUS } from '../ui';
import { type Anchor, dayOf, labelsFor, MAP_MIN_WIDTH, type Placed, pointText, SQUAD_LABEL, taskHead as head } from './mapLayout';

type View = StateView['terrain'];
type MapTask = View['tasks'][number];
type Terrain = MapTask['terrain'];

const TERRAINS: { id: Terrain; name: string; kind: string; rule: string }[] = [
  { id: 'trail', name: 'тропа', kind: 'простой', rule: 'Увидел — определил — сделал. Отдай агенту, проверь результат.' },
  { id: 'pass', name: 'перевал', kind: 'сложный', rule: 'Изучи — позови проводника — иди. Без эксперта не соваться.' },
  { id: 'fog', name: 'туман', kind: 'запутанный', rule: 'Разведка — наблюдение — решение. Три дешёвых прототипа лучше одного плана.' },
  { id: 'storm', name: 'шторм', kind: 'хаотичный', rule: 'Сначала действуй, потом разбирайся. Командир один.' },
];
const PHASE = { done: 'разбор ✓', current: 'идём', planned: 'маршрут', idea: 'замысел' } as const;

/** Три оттенка на каждый вид клетки: карта не выглядит залитой одним цветом. */
const SHADES: Record<string, [string, string, string]> = {
  '.': ['#1d2820', '#212e25', '#25332a'],
  ',': ['#2c3b2f', '#314235', '#364839'],
  ':': ['#4c4e46', '#55574e', '#5e6056'],
  '^': ['#b0ad9d', '#bdbaa9', '#c9c6b5'],
  '~': ['#182531', '#1b2a38', '#1f3040'],
  '"': ['#3e5036', '#44573b', '#4b6041'],
  '#': ['#6b695f', '#77756a', '#838174'],
  '%': ['#4b5651', '#566159', '#8a918c'],
  '!': ['#544d48', '#5e5650', '#6b625c'],
};
const HAZE = [32, 38, 43] as const;
const AMBER = '#e3b04b';
const INK = '#15181b';
const PAPER = '#d9dcd6';
const CORAL = '#f08a6b';

const speck = (x: number, y: number) => {
  let h = Math.imul(x + 1, 0x27d4eb2d) ^ Math.imul(y + 1, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) % 3;
};

function hazed(hex: string, amount: number): string {
  if (amount <= 0) return hex;
  const n = Number.parseInt(hex.slice(1), 16);
  const mix = (c: number, to: number) => Math.round(c + (to - c) * amount);
  return `rgb(${mix((n >> 16) & 255, HAZE[0])},${mix((n >> 8) & 255, HAZE[1])},${mix(n & 255, HAZE[2])})`;
}

/** Рисует рельеф, маршрут и значки. Подписи лежат поверх обычным текстом. */
function draw(canvas: HTMLCanvasElement, view: View, width: number) {
  const ratio = window.devicePixelRatio || 1;
  const w = Math.round(width * ratio);
  const h = Math.round((width * view.rows * ratio) / view.cols);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // cw и ch — размер единицы раскладки: в ней заданы точки и значки. Клетка рельефа в detail раз мельче.
  const cw = w / view.cols;
  const ch = h / view.rows;
  const px = (x: number) => Math.round((x * cw) / view.detail);
  const py = (y: number) => Math.round((y * ch) / view.detail);

  for (let y = 0; y < view.rows * view.detail; y += 1) {
    const row = view.cells[y] ?? '';
    for (let x = 0; x < view.cols * view.detail; x += 1) {
      const code = row[x] ?? '.';
      const shades = SHADES[code] ?? (SHADES['.'] as [string, string, string]);
      // Туман — шахматная рябь: светлая клетка через одну.
      const shade = code === '%' ? ((x + y) % 2 === 0 ? 2 : speck(x, y) % 2) : speck(x, y);
      const far = view.sight === null ? 0 : Math.hypot(x / view.detail - view.squad.x, y / view.detail - view.squad.y) - view.sight;
      const haze = Math.min(1, Math.max(0, far / 7)) * 0.45;
      ctx.fillStyle = hazed(shades[shade] as string, haze);
      ctx.fillRect(px(x), py(y), px(x + 1) - px(x), py(y + 1) - py(y));
      // Шторм — косые струи поверх тёмной земли.
      if (code === '!' && (x + Math.floor(y / 3)) % 4 === 0 && y % 3 === 0) {
        ctx.fillStyle = hazed(CORAL, haze);
        ctx.fillRect(px(x + 0.25), py(y + 0.1), Math.max(1, px(0.5)), py(y + 1.9) - py(y + 0.1));
      }
    }
  }

  const square = (x: number, y: number, size: number, fill: string, border: number) => {
    const s = size * cw;
    if (border > 0) {
      ctx.fillStyle = INK;
      ctx.fillRect(Math.round(x * cw - s / 2 - border), Math.round(y * ch - s / 2 - border), Math.round(s + border * 2), Math.round(s + border * 2));
    }
    ctx.fillStyle = fill;
    ctx.fillRect(Math.round(x * cw - s / 2), Math.round(y * ch - s / 2), Math.round(s), Math.round(s));
  };

  // Маршрут: пройденное — янтарём, предстоящее — светлым пунктиром.
  for (let i = 1; i < view.route.length; i += 1) {
    const a = view.route[i - 1] as View['route'][number];
    const b = view.route[i] as View['route'][number];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.round(len / 1.5));
    const walked = i - 1 < view.squad.from ? len : i - 1 === view.squad.from ? Math.hypot(view.squad.x - a.x, view.squad.y - a.y) : 0;
    for (let s = 1; s < steps; s += 1) {
      const t = s / steps;
      const passed = t * len <= walked;
      ctx.globalAlpha = passed ? 1 : 0.7;
      square(a.x + (b.x - a.x) * t + 0.5, a.y + (b.y - a.y) * t + 0.5, passed ? 0.5 : 0.36, passed ? AMBER : PAPER, 0);
    }
  }
  ctx.globalAlpha = 1;
  for (const p of view.route) square(p.x + 0.5, p.y + 0.5, 1.15, p.phase === 'done' ? AMBER : PAPER, 2 * ratio);
  square(view.squad.x + 0.5, view.squad.y + 0.5, 1.5, AMBER, 2 * ratio);
  square(view.squad.x + 0.5, view.squad.y + 0.5, 0.5, INK, 0);
}

const SHIFT: Record<Anchor, string> = {
  left: 'translate(calc(-100% - 14px), -50%)',
  right: 'translate(14px, -50%)',
  above: 'translate(-50%, calc(-100% - 14px))',
  below: 'translate(-50%, 14px)',
  center: 'translate(-50%, -50%)',
};

const at = (view: View, p: Placed): CSSProperties => ({
  left: `${((p.x + 0.5) / view.cols) * 100}%`,
  top: `${((p.y + 0.5) / view.rows) * 100}%`,
  transform: SHIFT[p.anchor],
});

const ruDate = (iso: string) => iso.split('-').reverse().join('.');
const people = (names: string[]) => (names.length === 0 ? 'никто' : names.join(', '));

export function MapScreen({ state, run }: { state: StateView; run: Run }) {
  const { terrain: view, strategy, attention } = state;
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const box = frame.current;
    const el = canvas.current;
    if (!box || !el) return;
    const paint = () => draw(el, view, box.clientWidth);
    paint();
    const watch = new ResizeObserver(paint);
    watch.observe(box);
    return () => watch.disconnect();
  }, [view]);

  const labels = labelsFor(view);

  const cycleName = CYCLE.find(([id]) => id === state.map.cycle)?.[1] ?? state.map.cycle;
  const weather = state.map.weather.stage;
  const summary = [
    `Карта экспедиции на ${ruDate(state.today)}.`,
    `Отряд между лагерями «${view.route[view.squad.from]?.name ?? ''}» и «${state.targetCamp ?? ''}».`,
    `Открытых переходов: ${view.tasks.length}.`,
  ].join(' ');

  return (
    <div className="split">
      <div className="grow stack-lg">
        <div className="scroll-x">
          <div className="map" data-block="map" ref={frame} style={{ minWidth: MAP_MIN_WIDTH, aspectRatio: `${view.cols} / ${view.rows}` }}>
            <canvas ref={canvas} role="img" aria-label={summary} />
            {view.route.map((p) => (
              <span
                key={p.id}
                className={`map-point ${p.phase === 'done' ? 'done' : ''} ${p.id === state.map.target ? 'target' : ''} ${p.hazy ? 'hazy' : ''}`}
                style={at(view, labels.points[p.id] as Placed)}
                title={p.hazy ? `В дымке: погода ${weather}` : undefined}
              >
                {pointText(p)}
              </span>
            ))}
            <span className="map-point squad" style={at(view, labels.squad)}>
              {SQUAD_LABEL}
            </span>
            {view.tasks.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`map-task ${t.terrain} ${selected === t.id ? 'on' : ''}`}
                style={at(view, labels.tasks[t.id] as Placed)}
                aria-pressed={selected === t.id}
                onClick={() => setSelected(selected === t.id ? null : t.id)}
              >
                <span className="map-task-head">{head(t)}</span>
                <b>{t.id}</b>
                {t.lint[0] && <span className="map-task-lint">{t.lint[0]}</span>}
              </button>
            ))}
            <p className="map-caption">
              Рельеф собран из состояния на {ruDate(state.today)}: переходов — {view.tasks.length}
              {view.sight === null ? ', видно весь маршрут.' : `, ${view.route.some((p) => p.hazy) ? 'дальний маршрут' : 'даль'} в дымке — погода ${weather}.`}
            </p>
          </div>
        </div>

        <div className="grid4" data-block="map-terrain">
          {TERRAINS.map((kind) => {
            const tasks = view.tasks.filter((t) => t.terrain === kind.id);
            return (
              <section key={kind.id} className="stack">
                <h3 className={`terrain-title ${kind.id}`}>
                  {kind.name} · {kind.kind}
                </h3>
                <p className="hint">{kind.rule}</p>
                {tasks.length === 0 && <p className="hint">Сейчас таких переходов нет.</p>}
                {tasks.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`task-card ${t.terrain} ${selected === t.id ? 'on' : ''}`}
                    aria-pressed={selected === t.id}
                    onClick={() => setSelected(selected === t.id ? null : t.id)}
                  >
                    <span className="between">
                      <b>{t.id}</b>
                      <span className={t.status === 'blocked' ? 'coral' : 'muted'}>{t.status === 'active' ? dayOf(t.days) : STATUS[t.status]}</span>
                    </span>
                    <span className="sans soft">{t.title}</span>
                    <span className="sans muted">
                      ведёт {people(t.leads)} · отвечает {t.accountable ?? 'никто'}
                      {t.consulted.length > 0 && ` · на связи ${t.consulted.join(', ')}`}
                    </span>
                    {t.lint.map((l) => (
                      <span key={l} className="sans amber">
                        Lint: {l}.
                      </span>
                    ))}
                    {t.note && <span className="sans muted">{t.note}</span>}
                    {t.probes.length > 0 && (
                      <span className="probes">
                        <span className="muted">
                          разведки: {t.probes.length}, с выводом — {t.probes.filter((x) => x.outcome !== null).length}
                        </span>
                        {t.probes.map((probe) => (
                          <span key={probe.text} className="sans">
                            <span className={probe.outcome === null ? 'muted' : 'soft'}>{probe.text}</span>
                            {probe.outcome !== null && <span className="blue"> → {probe.outcome}</span>}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                ))}
              </section>
            );
          })}
        </div>
      </div>

      <div className="side stack-lg">
        <Panel title="дальний маршрут" block="map-route">
          {strategy.vision && <p className="pad sans soft">Вершина: {strategy.vision}.</p>}
          <ul className="rows">
            {strategy.camps
              .filter((c) => c.label !== 'база')
              .map((c) => {
                const open = TERRAINS.filter((t) => c.open[t.id] > 0).map((t) => `${t.name} ${c.open[t.id]}`);
                return (
                  <li key={c.id} className={c.isTarget ? 'hi' : undefined}>
                    <span className="between">
                      <b className={c.isTarget ? 'amber' : undefined}>
                        {c.label} · {c.name}
                      </b>
                      <span className="muted">{c.isTarget ? `▸ ${cycleName}` : PHASE[c.phase]}</span>
                    </span>
                    {c.note && <span className="sans soft">{c.note}</span>}
                    {open.length > 0 && <span className="sans muted">Открыто: {open.join(', ')}.</span>}
                    {c.hazy && <span className="sans muted">В дымке: видна в ясную погоду.</span>}
                  </li>
                );
              })}
          </ul>
        </Panel>

        <Panel title="состав" block="map-squad">
          <div className="pad stack">
            <p className="headcount">
              <b>{strategy.squad.people}</b>
              {strategy.squad.headcount && strategy.squad.headcount.need > 0 && (
                <>
                  <span aria-hidden="true"> → </span>
                  <span className="sr-only"> по плану </span>
                  <b>{strategy.squad.headcount.target}</b>
                  <span className="muted small"> к {ruDate(strategy.squad.headcount.by)}</span>
                </>
              )}
            </p>
            <p className="sans muted">
              Людей в отряде: {strategy.squad.people}, агентов: {strategy.squad.agents}.
              {strategy.squad.headcount?.need === 0 && ' План состава выполнен.'}
            </p>
            {strategy.squad.missingRoles === null ? (
              <p className="sans muted">Роли по Белбину ни у кого не заполнены.</p>
            ) : strategy.squad.missingRoles.length === 0 ? (
              <p className="sans soft">Все роли по Белбину в отряде есть.</p>
            ) : (
              <p className="sans soft">В отряде нет ролей: {strategy.squad.missingRoles.join(', ')}.</p>
            )}
            {strategy.squad.headcount && strategy.squad.headcount.need > 0 && (
              <p className="hint">
                До плана не хватает {strategy.squad.headcount.need}. Каждый новый участник возвращает погоду к forming: набирать по одному, между
                штормами.
              </p>
            )}
          </div>
        </Panel>

        <Panel title={`трещины · риски · ${strategy.cracks.length}`} block="map-cracks">
          {strategy.cracks.length === 0 && <p className="pad muted">Трещин не видно.</p>}
          <Scroll label="Трещины и риски" size="s">
          <ul className="rows">
            {strategy.cracks.map((c) => (
              <li key={`${c.code}:${c.target}`}>
                <b className={c.code === 'spof' ? 'coral' : 'amber'}>{c.title}</b>
                <span className="sans soft">{c.text}</span>
              </li>
            ))}
          </ul>
          </Scroll>
          <div className="pad stack attention-split" data-block="map-attention">
              <b className="amber">внимание командира</b>
              <span className="sans soft">
                {attention.turns === 0
                  ? `За ${attention.windowDays} дн. ходов не было.`
                  : `За ${attention.windowDays} дн. потрачено ${attention.spent}, из них на маршрут — ${attention.route}.`}
              </span>
              {attention.turns > 0 && attention.route === 0 && <span className="sans coral">На стратегию внимание не уходило.</span>}
          </div>
          <RouteWork state={state} run={run} />
        </Panel>
      </div>
    </div>
  );

}

/** Запись в ход: поработал над маршрутом. Единственное действие, которое тратит внимание на стратегию. */
function RouteWork({ state, run }: { state: StateView; run: Run }) {
  const [note, setNote] = useState('');
  const turn = state.turn;
  const cost = state.actionCosts['route-block'];
  if (cost === undefined) return null;
  if (!turn || turn.closed) {
    return <p className="panel-foot">{turn ? 'Ход закрыт.' : 'Начни ход, чтобы записать работу над маршрутом.'}</p>;
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api.act('route-block', state.map.target, note.trim() || undefined))) setNote('');
  };
  return (
    <form className="pad stack route-work" onSubmit={submit}>
      <label htmlFor="route-note" className="muted">
        работа над маршрутом
      </label>
      <div className="inline-form">
        <input id="route-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="что сделал" autoComplete="off" />
        <button type="submit" className="btn">
          записать · −{cost}
        </button>
      </div>
    </form>
  );
}
