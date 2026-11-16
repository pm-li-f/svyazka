import { type FormEvent, type ReactNode, useState } from 'react';
import { type Answer, api, type StateView } from './api';

type Models = StateView['navigator'];

/** Состояние одного обращения к штурману: выбранная модель, ожидание, ответ или ошибка. */
export function useNavigator(nav: Models) {
  const firstReady = nav.models.find((m) => m.name === nav.default && m.ready) ?? nav.models.find((m) => m.ready);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const model = nav.models.find((m) => m.name === picked && m.ready)?.name ?? firstReady?.name ?? null;

  const send = async (action: (model: string) => Promise<Answer>): Promise<boolean> => {
    if (!model || busy) return false;
    setBusy(true);
    setError(null);
    try {
      setAnswer(await action(model));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const clear = () => {
    setAnswer(null);
    setError(null);
  };
  return { model, setModel: setPicked, busy, answer, error, send, clear, shown: busy || answer !== null || error !== null };
}

/** Переключатель модели. Модель без ключа выбрать нельзя: подсказка говорит, какого ключа нет. */
export function ModelPicker({ nav, model, onPick }: { nav: Models; model: string | null; onPick: (name: string) => void }) {
  return (
    <span className="view-as" role="group" aria-label="Какая модель отвечает">
      {nav.models.map((m) => (
        <button
          key={m.name}
          type="button"
          className={`btn seg ${m.name === model ? 'on' : ''}`}
          aria-pressed={m.name === model}
          disabled={!m.ready}
          title={m.ready ? `${m.provider}/${m.model} · уходят слои: ${m.layers.join(', ') || 'никакие'} · источники: ${m.sources.join(', ') || 'закрыты'}` : `Нет ключа ${m.keyVar}: sv keys init`}
          onClick={() => onPick(m.name)}
        >
          {m.name}
        </button>
      ))}
    </span>
  );
}

/** Ответ штурмана: кто отвечал, какие слои ему ушли и что он смотрел. */
export function NavigatorAnswer({
  nav,
  busy,
  answer,
  error,
  idle,
  quiet,
}: {
  nav: Models;
  busy: boolean;
  answer: Answer | null;
  error: string | null;
  idle?: ReactNode;
  /** Не напоминать про ключи: об этом уже сказано рядом. */
  quiet?: boolean;
}) {
  const noKeys = !quiet && nav.models.every((m) => !m.ready);
  return (
    <div className="navigator-out" aria-live="polite">
      {noKeys && (
        <p className="hint">
          Ключей моделей нет. Выполни в терминале <span className="mono">sv keys init</span>, впиши ключи в файл, который она назовёт, и обнови
          страницу.
        </p>
      )}
      {busy && <p className="muted">штурман думает…</p>}
      {error && !busy && (
        <p className="sans coral" role="alert">
          {error}
        </p>
      )}
      {answer && !busy && !error && (
        <>
          <p className="navigator-text">{answer.text}</p>
          <p className="hint">
            {answer.model.name} · {answer.model.provider}/{answer.model.model} · ушли слои: {answer.model.layers.join(', ') || 'никакие'} · источники:{' '}
            {answer.model.sources.join(', ') || 'закрыты'} ·
            смотрел: {answer.tools.join(', ') || 'ничего'}
          </p>
        </>
      )}
      {!busy && !error && !answer && !noKeys && idle}
    </div>
  );
}

/**
 * Строка штурмана: вопрос по данным игры. Штурман только читает и ничего не меняет.
 * `compact` — одна строка для нижней панели экрана: ответ раскрывается над ней и закрывается крестиком.
 */
export function NavigatorLine({ state, compact }: { state: StateView; compact?: boolean }) {
  const nav = state.navigator;
  const n = useNavigator(nav);
  const [question, setQuestion] = useState('');
  const noKeys = nav.models.every((m) => !m.ready);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (question.trim()) void n.send((model) => api.ask(question, model));
  };
  const form = (
    <form className="cmdline" onSubmit={submit}>
      <span className="amber" aria-hidden="true">
        {compact ? 'штурман ?' : '?'}
      </span>
      <label htmlFor="navigator-q" className="sr-only">
        Вопрос штурману
      </label>
      <input
        id="navigator-q"
        type="text"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder={noKeys ? 'ключей моделей нет: выполни в терминале sv keys init и обнови страницу' : 'вопрос по данным игры: с кем поговорить первым?'}
        autoComplete="off"
        disabled={!n.model}
      />
      {compact && <ModelPicker nav={nav} model={n.model} onPick={n.setModel} />}
      <button type="submit" className="btn" disabled={!n.model || n.busy || !question.trim()}>
        спросить
      </button>
    </form>
  );

  if (compact) {
    return (
      <section className="stack" data-block="navigator">
        {n.shown && (
          <div className="panel navigator-pop">
            <NavigatorAnswer nav={nav} busy={n.busy} answer={n.answer} error={n.error} quiet />
            {!n.busy && (
              <button type="button" className="btn link close" onClick={n.clear} aria-label="Скрыть ответ штурмана">
                скрыть
              </button>
            )}
          </div>
        )}
        {form}
      </section>
    );
  }

  return (
    <section className="panel" data-block="navigator">
      <h2 className="panel-title between">
        <span>штурман</span>
        <ModelPicker nav={nav} model={n.model} onPick={n.setModel} />
      </h2>
      <div className="pad stack">
        <NavigatorAnswer
          nav={nav}
          busy={n.busy}
          answer={n.answer}
          error={n.error}
          idle={<p className="hint">Спроси по данным игры: «с кем поговорить первым?», «что мешает дойти до лагеря?», «где я обещал и не сделал?»</p>}
        />
        {form}
      </div>
    </section>
  );
}

/** Заметки к 1on1 на листе человека. */
export function NavigatorPrep({ state, id }: { state: StateView; id: string }) {
  const nav = state.navigator;
  const n = useNavigator(nav);
  return (
    <div className="stack prep" data-block="sheet-prep">
      <div className="between">
        <button type="button" className="btn" disabled={!n.model || n.busy} onClick={() => void n.send((model) => api.prep(id, model))}>
          заметки к встрече от штурмана
        </button>
        <ModelPicker nav={nav} model={n.model} onPick={n.setModel} />
      </div>
      <NavigatorAnswer nav={nav} busy={n.busy} answer={n.answer} error={n.error} />
    </div>
  );
}
