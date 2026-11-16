import type { GameEvent } from '@svyazka/engine/src/events';

/**
 * Звук игрового слоя. Короткие сигналы синтезируются на лету: файлов со звуком в игре нет.
 * По умолчанию звук выключен.
 */
let context: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch {
    return null;
  }
}

/** Ноты: [частота в герцах, начало в секундах, длина в секундах]. */
type Note = [number, number, number];

const TUNES: Record<GameEvent['kind'], Note[]> = {
  'turn-start': [[392, 0, 0.12], [523, 0.12, 0.18]],
  'turn-end': [[523, 0, 0.12], [392, 0.12, 0.22]],
  storm: [[98, 0, 0.5], [92, 0.25, 0.6]],
  'new-member': [[440, 0, 0.1], [554, 0.1, 0.1], [659, 0.2, 0.2]],
  'camp-taken': [[392, 0, 0.14], [494, 0.14, 0.14], [587, 0.28, 0.14], [784, 0.42, 0.4]],
  'signal-cleared': [[660, 0, 0.07], [880, 0.07, 0.1]],
  'backup-assigned': [[523, 0, 0.08], [659, 0.08, 0.08], [784, 0.16, 0.14]],
  'lint-green': [[587, 0, 0.08], [880, 0.08, 0.14]],
  'quest-step': [[494, 0, 0.08], [740, 0.08, 0.12]],
  'sheet-updated': [[440, 0, 0.07], [660, 0.07, 0.1]],
};

export function chime(kind: GameEvent['kind']): void {
  const ctx = audio();
  if (!ctx) return;
  for (const [frequency, start, length] of TUNES[kind]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = frequency;
    const at = ctx.currentTime + start;
    // Тихо и с мягким затуханием: звук подтверждает, а не пугает.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.045, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + length + 0.02);
  }
}
