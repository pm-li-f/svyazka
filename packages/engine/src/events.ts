/**
 * События игры: что изменилось между двумя снимками состояния.
 *
 * По событиям интерфейс показывает заставки и эффекты. Правила, когда их не бывает,
 * живут здесь, а не в интерфейсе, и проверяются тестами:
 *   - эффект отмечает только то, что действительно закрылось;
 *   - трата внимания, число встреч и оценки людей событий не дают;
 *   - пока на карте шторм, эффекты молчат;
 *   - серий и сравнений между людьми нет.
 *
 * Модуль без зависимостей: его подключает и страница в браузере.
 */

/** Снимок того, по чему видны события. Собирается функцией `facts` из состояния игры. */
export interface Facts {
  date: string;
  turn: 'none' | 'open' | 'closed';
  budget: number | null;
  /** Сколько сигналов осталось без внимания при закрытии хода. */
  untouched: number;
  /** Сигналы по ключу «код:цель». `subject` — имя цели для человека. */
  signals: Record<string, { severity: string; code: string; target: string; subject: string }>;
  /** Открытые штормы: id перехода → название. */
  storms: Record<string, string>;
  /** Взятые лагеря: id → название. */
  camps: Record<string, string>;
  /** Люди отряда: id → имя. */
  people: Record<string, string>;
  /** Замечаний линтера RACI. */
  lint: number;
  quests: Record<string, { done: number; steps: number }>;
  /** Когда человек сам обновлял лист: id → дата. */
  sheets: Record<string, string>;
}

export type SplashEvent =
  | { kind: 'turn-start'; date: string; budget: number | null }
  | { kind: 'turn-end'; date: string; untouched: number }
  | { kind: 'storm'; id: string; title: string }
  | { kind: 'new-member'; id: string; name: string }
  | { kind: 'camp-taken'; id: string; name: string };

export type EffectEvent =
  | { kind: 'signal-cleared'; code: string; target: string; subject: string }
  | { kind: 'backup-assigned'; skill: string }
  | { kind: 'lint-green' }
  | { kind: 'quest-step'; id: string; name: string; done: number; steps: number }
  | { kind: 'sheet-updated'; id: string; name: string };

export type GameEvent = SplashEvent | EffectEvent;

const SPLASH = ['turn-start', 'turn-end', 'storm', 'new-member', 'camp-taken'] as const;
export const isSplash = (e: GameEvent): e is SplashEvent => (SPLASH as readonly string[]).includes(e.kind);

/** Редкие заставки. Начало и конец хода бывают каждый день и к редким не относятся. */
export const RARE: readonly SplashEvent['kind'][] = ['storm', 'new-member', 'camp-taken'];

/** Длительность заставки, мс: чем чаще событие, тем она короче. */
export const SPLASH_MS: Record<SplashEvent['kind'], number> = {
  'turn-start': 1600,
  'turn-end': 1800,
  storm: 3500,
  'new-member': 3500,
  'camp-taken': 6500,
};

/** Сигналы, снятие которых не отмечается: внимание — не достижение, погода — справка. */
const SILENT_CODES = new Set(['attention', 'weather']);

/** Что произошло между двумя снимками. Первый снимок и смена дня событий не дают. */
export function events(before: Facts | null, after: Facts): GameEvent[] {
  if (!before || before.date !== after.date) return [];
  const out: GameEvent[] = [];
  const added = <T>(a: Record<string, T>, b: Record<string, T>) => Object.keys(b).filter((k) => !(k in a));

  if (before.turn === 'none' && after.turn === 'open') out.push({ kind: 'turn-start', date: after.date, budget: after.budget });
  if (before.turn === 'open' && after.turn === 'closed') out.push({ kind: 'turn-end', date: after.date, untouched: after.untouched });
  for (const id of added(before.storms, after.storms)) out.push({ kind: 'storm', id, title: after.storms[id] as string });
  for (const id of added(before.people, after.people)) out.push({ kind: 'new-member', id, name: after.people[id] as string });
  for (const id of added(before.camps, after.camps)) out.push({ kind: 'camp-taken', id, name: after.camps[id] as string });

  const updated = new Set<string>();
  for (const [id, date] of Object.entries(after.sheets)) {
    const was = before.sheets[id];
    // Лист нового участника — не событие: о нём уже сказала заставка.
    if (id in before.people && (was === undefined || date > was)) {
      updated.add(id);
      out.push({ kind: 'sheet-updated', id, name: after.people[id] ?? id });
    }
  }
  for (const [id, quest] of Object.entries(after.quests)) {
    const was = before.quests[id];
    if (was && quest.done > was.done) out.push({ kind: 'quest-step', id, name: after.people[id] ?? id, done: quest.done, steps: quest.steps });
  }
  const green = before.lint > 0 && after.lint === 0;
  if (green) out.push({ kind: 'lint-green' });

  for (const [key, signal] of Object.entries(before.signals)) {
    if (key in after.signals || signal.severity === 'info' || SILENT_CODES.has(signal.code)) continue;
    // Человека убрали из отряда — его сигналы исчезли, но ничего не закрылось.
    if (signal.target in before.people && !(signal.target in after.people)) continue;
    if (signal.code === 'spof') out.push({ kind: 'backup-assigned', skill: signal.subject });
    else if (signal.code === 'stale-sheet' && updated.has(signal.target)) continue;
    else if (signal.code === 'raci' && green) continue;
    else out.push({ kind: 'signal-cleared', code: signal.code, target: signal.target, subject: signal.subject });
  }
  return out;
}

/** Настройки игрового слоя. У каждого игрока свои; в папку игры не пишутся. */
export interface GameSettings {
  /** Заставки: все, только редкие или выключены. */
  splash: 'all' | 'rare' | 'off';
  /** Эффекты: полные, сдержанные или выключены. */
  effects: 'full' | 'calm' | 'off';
  sound: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = { splash: 'rare', effects: 'calm', sound: false };

const WEIGHT: Record<SplashEvent['kind'], number> = { 'camp-taken': 0, 'new-member': 1, storm: 2, 'turn-end': 3, 'turn-start': 4 };

/**
 * Что из случившегося показать при этих настройках.
 * Заставок за раз не больше двух, сначала самая редкая. В шторм эффектов нет.
 */
export function plan(list: GameEvent[], settings: GameSettings, stormy: boolean): { splashes: SplashEvent[]; effects: EffectEvent[] } {
  const splashes =
    settings.splash === 'off'
      ? []
      : list
          .filter(isSplash)
          .filter((e) => settings.splash === 'all' || RARE.includes(e.kind))
          .sort((a, b) => WEIGHT[a.kind] - WEIGHT[b.kind])
          .slice(0, 2);
  const effects = settings.effects === 'off' || stormy ? [] : list.filter((e): e is EffectEvent => !isSplash(e));
  return { splashes, effects };
}
