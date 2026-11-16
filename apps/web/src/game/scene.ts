import type { SplashEvent } from '@svyazka/engine/src/events';
import type { StateView } from '../api';

/**
 * Кадр заставки. Собирается из текущего состояния игры:
 *   горы   — из рельефа карты: чем больше скал и снега в столбце, тем выше хребет;
 *   небо   — из времени суток на машине игрока;
 *   погода — из стадии команды: дымка, тучи с дождём или ясно;
 *   отряд  — по фигурке на человека и по маленькому спутнику на агента, все в одной связке.
 * Сцена пиксельная: рисуется на маленьком холсте и растягивается без сглаживания.
 */
export const SCENE_W = 240;
export const SCENE_H = 120;

export interface Scene {
  kind: SplashEvent['kind'];
  ridge: number[];
  snow: boolean[];
  hour: number;
  weather: StateView['map']['weather']['stage'];
  people: number;
  agents: number;
}

export function sceneOf(state: StateView, kind: SplashEvent['kind'], hour: number): Scene {
  const { cells, cols, rows, detail } = state.terrain;
  const ridge: number[] = [];
  const snow: boolean[] = [];
  for (let x = 0; x < SCENE_W; x += 1) {
    const gx = Math.floor((x / SCENE_W) * cols * detail);
    let rock = 0;
    let white = 0;
    for (let gy = 0; gy < rows * detail; gy += 1) {
      const code = cells[gy]?.[gx];
      if (code === ':' || code === '#') rock += 1;
      if (code === '^') white += 1;
    }
    ridge.push((rock + white * 1.6) / (rows * detail));
    snow.push(white > 0);
  }
  // Сглаживание: хребет, а не забор.
  const smooth = ridge.map((_, i) => {
    let sum = 0;
    for (let k = -4; k <= 4; k += 1) sum += ridge[Math.min(SCENE_W - 1, Math.max(0, i + k))] as number;
    return sum / 9;
  });
  const top = Math.max(0.001, ...smooth);
  return {
    kind,
    ridge: smooth.map((v) => v / top),
    snow,
    hour,
    weather: state.map.weather.stage,
    people: Math.min(12, state.roster.filter((r) => r.kind === 'person').length),
    agents: Math.min(6, state.roster.filter((r) => r.kind === 'agent').length),
  };
}

type Rgb = [number, number, number];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: Rgb, alpha = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${alpha})`;

/** Небо: верх и низ для времени суток. Палитра приглушённая, без открыточных закатов. */
function sky(hour: number): { top: Rgb; bottom: Rgb; night: boolean } {
  if (hour < 5 || hour >= 22) return { top: [11, 15, 26], bottom: [24, 32, 48], night: true };
  if (hour < 8) return { top: [44, 48, 74], bottom: [170, 122, 104], night: false };
  if (hour < 17) return { top: [74, 104, 124], bottom: [150, 172, 172], night: false };
  return { top: [38, 40, 68], bottom: [176, 112, 84], night: false };
}

const hash = (n: number) => {
  let h = Math.imul(n + 1, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 0x100000000;
};

const FIGURES: Rgb[] = [
  [227, 176, 75],
  [127, 178, 229],
  [140, 203, 138],
  [240, 138, 107],
  [217, 220, 214],
  [176, 150, 210],
];

/** Рисует кадр. `t` — доля заставки от 0 до 1. */
export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene, t: number): void {
  const W = SCENE_W;
  const H = SCENE_H;
  const ground = H - 22;
  const px = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  const ease = (v: number) => v * v * (3 - 2 * v);
  const stormy = scene.kind === 'storm' || scene.weather === 'storming';
  const gloom = scene.kind === 'storm' ? ease(Math.min(1, t * 1.6)) : scene.weather === 'storming' ? 0.55 : 0;
  const dusk = scene.kind === 'turn-end' ? ease(t) * 0.45 : 0;
  const glow = scene.kind === 'camp-taken' ? ease(Math.max(0, t - 0.45) / 0.55) * 0.35 : 0;

  // небо
  const s = sky(scene.hour);
  const dark: Rgb = [18, 20, 26];
  const light: Rgb = [214, 200, 160];
  for (let y = 0; y < ground; y += 3) {
    let c = mix(s.top, s.bottom, y / ground);
    c = mix(c, dark, Math.max(gloom * 0.7, dusk));
    c = mix(c, light, glow);
    px(0, y, W, 3, css(c));
  }
  if (s.night || dusk > 0.3) {
    for (let i = 0; i < 26; i += 1) px(Math.floor(hash(i) * W), Math.floor(hash(i + 99) * ground * 0.6), 1, 1, css([217, 220, 214], 0.75 * (1 - gloom)));
  }
  // светило: солнце днём, луна ночью; на рассвете хода оно приподнимается
  const lift = scene.kind === 'turn-start' ? ease(t) * 10 : scene.kind === 'turn-end' ? -ease(t) * 8 : 0;
  const sunX = 30 + ((scene.hour % 12) / 12) * (W - 60);
  const sunY = 26 - lift;
  if (gloom < 0.8) px(sunX, sunY, 8, 8, css(s.night ? [200, 205, 215] : [232, 196, 120], 1 - gloom));

  // дальний хребет и ближний, из рельефа карты
  for (let x = 0; x < W; x += 1) {
    const far = ground - 14 - (scene.ridge[(x + 37) % W] as number) * 30;
    px(x, far, 1, ground - far, css(mix([52, 62, 70], dark, gloom * 0.5 + dusk)));
    const h = 8 + (scene.ridge[x] as number) * 52;
    const y = ground - h;
    px(x, y, 1, h, css(mix([84, 87, 78], dark, gloom * 0.45 + dusk * 0.8)));
    if (scene.snow[x] && h > 30) px(x, y, 1, Math.max(2, h * 0.18), css(mix([201, 198, 181], dark, gloom * 0.4 + dusk * 0.6)));
  }

  // погода
  if (scene.weather === 'forming' && scene.kind !== 'storm') {
    for (let band = 0; band < 3; band += 1) px(-20 + ((t * 30 + band * 70) % (W + 40)), ground - 34 + band * 9, 90, 3, css([190, 198, 196], 0.22));
  }
  if (scene.weather === 'norming') {
    px(40 + t * 8, 18, 22, 4, css([200, 206, 204], 0.5));
    px(150 + t * 5, 30, 30, 4, css([200, 206, 204], 0.4));
  }
  if (stormy) {
    const cover = scene.kind === 'storm' ? ease(Math.min(1, t * 1.4)) : 1;
    for (let i = 0; i < 9; i += 1) {
      const w = 34 + hash(i + 7) * 30;
      px(W - cover * (W + 40) + i * 30 + hash(i) * 12, 4 + hash(i + 3) * 16, w, 7, css([46, 50, 58], 0.92));
    }
    const drops = scene.kind === 'storm' ? Math.floor(90 * cover) : 40;
    for (let i = 0; i < drops; i += 1) {
      const x = (hash(i) * W + t * 60) % W;
      const y = (hash(i + 500) * ground + t * 260) % ground;
      px(x, y, 1, 3, css([150, 172, 194], 0.6));
    }
    // Молния — одна ломаная линия на долю секунды. Экран не вспыхивает: мигание утомляет и опасно при светочувствительности.
    if (scene.kind === 'storm' && t > 0.55 && t < 0.63) {
      let bx = W * 0.62;
      for (let by = 14; by < ground - 30; by += 6) {
        const step = (hash(by) - 0.5) * 10;
        px(Math.min(bx, bx + step), by, Math.abs(step) + 1, 1, css([240, 138, 107]));
        bx += step;
        px(bx, by, 1, 6, css([240, 138, 107]));
      }
    }
  }

  // земля и тропа
  px(0, ground, W, H - ground, css(mix([29, 40, 32], dark, dusk * 0.6 + gloom * 0.3)));
  for (let x = 4; x < W; x += 7) px(x, ground + 9, 3, 1, css([217, 220, 214], 0.35));

  // лагерь: палатка и флаг справа
  const campX = W - 46;
  if (scene.kind === 'camp-taken' || scene.kind === 'turn-end') {
    px(campX, ground - 9, 16, 9, css([58, 64, 60]));
    px(campX + 3, ground - 12, 10, 3, css([58, 64, 60]));
    px(campX + 6, ground - 6, 4, 6, css([21, 24, 27]));
  }
  if (scene.kind === 'camp-taken') {
    const raised = ease(Math.min(1, Math.max(0, (t - 0.35) / 0.4)));
    px(campX + 22, ground - 30, 1, 30, css([217, 220, 214]));
    px(campX + 23, ground - 8 - raised * 21, 9, 6, css([227, 176, 75]));
    // искры над флагом, когда он поднят
    if (t > 0.75) {
      for (let i = 0; i < 14; i += 1) {
        const k = (t - 0.75) / 0.25;
        const a = hash(i) * Math.PI * 2;
        px(campX + 27 + Math.cos(a) * k * 22, ground - 32 + Math.sin(a) * k * 14 - k * 6, 2, 2, css(i % 2 ? [227, 176, 75] : [140, 203, 138], 1 - k));
      }
    }
  }
  if (scene.kind === 'turn-end') {
    const flick = Math.floor(t * 18) % 2;
    px(campX - 14, ground - 3, 6, 3, css([120, 70, 40]));
    px(campX - 13, ground - 7 - flick, 4, 4 + flick, css([240, 138, 107]));
    px(campX - 12, ground - 9 - flick, 2, 3, css([227, 176, 75]));
  }

  // отряд в связке
  const count = scene.people;
  const gap = 9;
  const walk = scene.kind === 'turn-start' ? ease(t) * 26 : scene.kind === 'camp-taken' ? ease(Math.min(1, t / 0.4)) * 40 : 0;
  const base = scene.kind === 'turn-end' ? campX - 30 - count * gap : scene.kind === 'camp-taken' ? campX - 62 - count * gap + walk : 46 + walk;
  const xs: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const newcomer = scene.kind === 'new-member' && i === 0;
    const x = newcomer ? -10 + ease(Math.min(1, t / 0.7)) * (base + 10) : base + i * gap + (scene.kind === 'new-member' ? gap : 0);
    const moving = walk > 0 && t < 0.95 ? Math.floor(t * 14 + i) % 2 : newcomer && t < 0.7 ? Math.floor(t * 18) % 2 : 0;
    const huddle = scene.kind === 'storm' ? Math.min(2, Math.floor(gloom * 3)) : 0;
    const y = ground + 3 - moving + huddle;
    const color = FIGURES[i % FIGURES.length] as Rgb;
    xs.push(x);
    if (newcomer) px(x - 1, y - 9, 5, 12, css([227, 176, 75], 0.35 + 0.35 * Math.sin(t * 20)));
    px(x, y - 5 + huddle, 3, 6 - huddle, css(mix(color, dark, gloom * 0.35 + dusk * 0.4)));
    px(x, y - 8 + huddle, 3, 3, css(mix([217, 200, 180], dark, gloom * 0.35 + dusk * 0.4)));
  }
  // верёвка: новичок ввязывается, когда дошёл
  const roped = scene.kind === 'new-member' ? (t > 0.7 ? xs : xs.slice(1)) : xs;
  for (let i = 1; i < roped.length; i += 1) {
    const a = roped[i - 1] as number;
    const b = roped[i] as number;
    for (let x = a + 3; x < b; x += 2) px(x, ground - 1, 1, 1, css([227, 176, 75], 0.9));
  }
  // агенты: маленькие спутники над отрядом
  for (let i = 0; i < scene.agents; i += 1) {
    const x = (xs[xs.length - 1] ?? base) + 10 + i * 7;
    px(x, ground - 12 + Math.sin(t * 9 + i) * 1.5, 3, 3, css(mix([154, 163, 160], dark, gloom * 0.3)));
  }
}
