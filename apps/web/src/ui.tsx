import { type FormEvent, type ReactNode, useState } from 'react';
import { api, type Layer, type StateView } from './api';

export const TERRAIN = {
  trail: 'тропа · простой',
  pass: 'перевал · сложный',
  fog: 'туман · запутанный',
  storm: 'шторм · хаотичный',
} as const;

/** Цикл PMBOK light: этап и его название в игре. */
export const CYCLE = [
  ['initiating', 'замысел'],
  ['planning', 'маршрут'],
  ['executing', 'переход'],
  ['monitoring', 'сверка'],
  ['closing', 'разбор'],
] as const;

export const STATUS = { planned: 'в плане', active: 'идёт', blocked: 'стоит', done: 'готово' } as const;

export const LAYER_NAME: Record<Layer, string> = { team: 'видит отряд', pair: 'человек и ты', me: 'только ты' };

/** Запускает действие: показывает ошибку человеку и перечитывает состояние. */
export type Run = (action: () => Promise<unknown>) => Promise<boolean>;

/** `block` — устойчивое имя блока: по нему его находят тесты и сборка руководства. */
export function Panel({ title, children, className, block }: { title: ReactNode; children: ReactNode; className?: string; block?: string }) {
  return (
    <section className={`panel ${className ?? ''}`} data-block={block}>
      <h2 className="panel-title">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Длинный список в окне с прокруткой: то, что стоит ниже, не уезжает за край экрана.
 * Окно получает фокус с клавиатуры, чтобы его можно было листать стрелками.
 */
export function Scroll({ label, size, children }: { label: string; size?: 's'; children: ReactNode }) {
  return (
    <div className={`scroll-y ${size ?? ''}`} tabIndex={0} role="group" aria-label={label}>
      {children}
    </div>
  );
}

export const Cmd = ({ children }: { children: ReactNode }) => (
  <>
    <span className="green">$</span> {children}
  </>
);

export const days = (n: number | null) => (n === null ? '—' : `${n}d`);

export const Dots = ({ n, of, className }: { n: number; of: number; className?: string }) => (
  <span className={`dots ${className ?? ''}`} aria-label={`${n} из ${of}`}>
    {'●'.repeat(n)}
    {'○'.repeat(Math.max(0, of - n))}
  </span>
);

export function Attention({ turn }: { turn: NonNullable<StateView['turn']> }) {
  const { budget, spent } = turn.attention;
  const left = budget - spent;
  return (
    <span>
      внимание{' '}
      <span aria-hidden="true">
        <span className="amber">{'▮'.repeat(Math.max(0, left))}</span>
        {'▯'.repeat(Math.min(spent, budget))}
      </span>{' '}
      {left >= 0 ? `${left}/${budget}` : <span className="coral">перерасход {-left}</span>}
    </span>
  );
}

/** Утренняя отметка: сколько сил на сегодня. Пустое поле — обычное значение. */
export function StartTurn({ state, run, compact }: { state: StateView; run: Run; compact?: boolean }) {
  const { usual, limit } = state.budget;
  const [value, setValue] = useState(usual === null ? '' : String(usual));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api.startTurn(value.trim() === '' ? undefined : Number(value)));
  };
  return (
    <form className={compact ? 'inline-form' : 'stack'} onSubmit={submit}>
      <label htmlFor={compact ? 'budget-top' : 'budget'} className={compact ? 'muted' : undefined}>
        {compact ? 'сил на сегодня' : 'Сколько сил на сегодня?'}
      </label>
      <div className="inline-form">
        <input
          id={compact ? 'budget-top' : 'budget'}
          type="number"
          min={0}
          max={limit}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="num"
        />
        <button type="submit" className="btn primary">
          начать ход
        </button>
      </div>
      {!compact && (
        <p className="hint">{usual === null ? `От 0 до ${limit}.` : `Обычно ${usual}, не больше ${limit}. Ноль тоже ответ.`}</p>
      )}
    </form>
  );
}

/** Строка в журнал решений. */
export function DecisionInput({ run }: { run: Run }) {
  const [text, setText] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (await run(() => api.decide(text))) setText('');
  };
  return (
    <form className="cmdline" data-block="decision" onSubmit={submit}>
      <span className="green" aria-hidden="true">
        &gt;
      </span>
      <label htmlFor="decision" className="sr-only">
        Решение: что решил и почему
      </label>
      <input
        id="decision"
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="решение: что решил и почему"
        autoComplete="off"
      />
      <button type="submit" className="btn">
        записать
      </button>
    </form>
  );
}
