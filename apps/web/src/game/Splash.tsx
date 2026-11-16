import { useEffect, useRef } from 'react';
import { SPLASH_MS, type SplashEvent } from '@svyazka/engine/src/events';
import type { StateView } from '../api';
import { drawScene, SCENE_H, SCENE_W, sceneOf } from './scene';

const ruDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

/** Две строки под кадром: что случилось и с чем именно. */
export function caption(event: SplashEvent): [string, string] {
  switch (event.kind) {
    case 'turn-start':
      return [`ход · ${ruDay(event.date)}`, event.budget === null ? '' : `сил на сегодня: ${event.budget}`];
    case 'turn-end':
      return ['ход закрыт', event.untouched === 0 ? 'всё разобрано' : `до чего не дошёл: ${event.untouched}`];
    case 'storm':
      return ['шторм', event.title];
    case 'new-member':
      return ['в связке новый участник', event.name];
    case 'camp-taken':
      return ['лагерь взят', event.name];
  }
}

/** Сколько заставка держится на экране. С «уменьшить движение» это один неподвижный кадр. */
export const splashMs = (kind: SplashEvent['kind'], reduced: boolean) => (reduced ? Math.min(1600, SPLASH_MS[kind]) : SPLASH_MS[kind]);

/**
 * Заставка поверх экрана. Кадр собирается из текущего состояния игры.
 * Пропускается любой клавишей или щелчком.
 */
export function Splash({ event, state, reduced, onDone }: { event: SplashEvent; state: StateView; reduced: boolean; onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [title, detail] = caption(event);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const scene = sceneOf(state, event.kind, new Date().getHours());
    const total = splashMs(event.kind, reduced);
    const started = performance.now();
    let frame = 0;
    let timer = 0;
    if (reduced) {
      // Без движения: итоговый кадр и подпись.
      drawScene(ctx, scene, 1);
      timer = window.setTimeout(onDone, total);
    } else {
      const tick = (now: number) => {
        const t = Math.min(1, (now - started) / total);
        drawScene(ctx, scene, t);
        if (t < 1) frame = requestAnimationFrame(tick);
        else onDone();
      };
      frame = requestAnimationFrame(tick);
    }
    // Клавиша пропускает заставку и не доходит до кнопок под ней.
    const skip = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onDone();
    };
    window.addEventListener('keydown', skip, true);
    box.current?.focus();
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      window.removeEventListener('keydown', skip, true);
    };
    // Состояние берётся на момент начала заставки: обновление страницы под ней не перезапускает кадр.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, reduced, onDone]);

  return (
    <div className={`splash ${event.kind}`} ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${title}. ${detail}`} onClick={onDone} data-block="splash">
      <canvas ref={canvas} width={SCENE_W} height={SCENE_H} aria-hidden="true" />
      <p className="splash-title">{title}</p>
      {detail && <p className="splash-detail">{detail}</p>}
      <p className="splash-skip">любая клавиша — пропустить</p>
    </div>
  );
}
