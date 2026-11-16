import { useEffect } from 'react';
import type { EffectEvent, GameSettings } from '@svyazka/engine/src/events';

export interface Toast {
  id: number;
  event: EffectEvent;
}

/** Сколько эффект держится на экране, мс. */
export const TOAST_MS = 4500;

/** Что сказать о закрытом: заголовок и строка. Только факт, без похвалы и без счёта. */
export function effectText(event: EffectEvent): [string, string] {
  switch (event.kind) {
    case 'signal-cleared':
      if (event.code === 'stale-context') return ['Сигнал снят', `${event.subject}: контекст снова свежий`];
      if (event.code === 'stale-sheet') return ['Сигнал снят', `${event.subject}: лист обновлён`];
      if (event.code === 'raci') return ['Сигнал снят', `${event.subject}: замечание по связке снято`];
      return ['Сигнал снят', event.subject];
    case 'backup-assigned':
      return ['Появился дублёр', `Навык «${event.skill}» больше не держится на одном человеке`];
    case 'lint-green':
      return ['Линтер RACI зелёный', 'У каждого перехода есть ведущий и ответственный'];
    case 'quest-step':
      return ['Шаг квеста', `${event.name}: ${event.done} из ${event.steps}`];
    case 'sheet-updated':
      return ['Лист обновлён', `${event.name}: свежее состояние из первых рук`];
  }
}

function Item({ toast, mode, onClose }: { toast: Toast; mode: GameSettings['effects']; onClose: (id: number) => void }) {
  const [title, text] = effectText(toast.event);
  useEffect(() => {
    const timer = window.setTimeout(() => onClose(toast.id), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast.id, onClose]);
  return (
    <li className={`toast ${mode}`}>
      {mode === 'full' && (
        <span className="sparks" aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} style={{ '--a': `${i * 36 + 12}deg`, '--d': `${34 + (i % 3) * 14}px` } as React.CSSProperties} />
          ))}
        </span>
      )}
      <span className="toast-mark" aria-hidden="true">
        ✓
      </span>
      <span className="toast-body">
        <b>{title}</b>
        <span className="sans">{text}</span>
      </span>
      <button type="button" className="btn link" onClick={() => onClose(toast.id)} aria-label={`Скрыть: ${title}`}>
        ×
      </button>
    </li>
  );
}

/** Эффекты: короткие отметки о том, что действительно закрылось. Не больше трёх на экране. */
export function Effects({ toasts, mode, onClose }: { toasts: Toast[]; mode: GameSettings['effects']; onClose: (id: number) => void }) {
  return (
    <ul className="toasts" aria-live="polite" aria-label="Что закрылось" data-block="effects">
      {toasts.map((t) => (
        <Item key={t.id} toast={t} mode={mode} onClose={onClose} />
      ))}
    </ul>
  );
}
