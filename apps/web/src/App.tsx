import { useCallback, useEffect, useState } from 'react';
import { api, type StateView } from './api';
import { People } from './screens/People';
import { Sheet } from './screens/Sheet';
import { Tasks } from './screens/Tasks';
import { TurnScreen } from './screens/Turn';
import { Attention, type Run, StartTurn } from './ui';

type Route = { name: 'people' } | { name: 'tasks' } | { name: 'turn' } | { name: 'sheet'; id: string | null };

function parseHash(): Route {
  const [, name, id] = window.location.hash.split('/');
  if (name === 'tasks') return { name: 'tasks' };
  if (name === 'turn') return { name: 'turn' };
  if (name === 'sheet') return { name: 'sheet', id: id ?? null };
  return { name: 'people' };
}

const CYCLE = [
  ['initiating', 'замысел'],
  ['planning', 'маршрут'],
  ['executing', 'переход'],
  ['monitoring', 'сверка'],
  ['closing', 'разбор'],
] as const;

export function App() {
  const [state, setState] = useState<StateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(parseHash);
  /** Растёт при каждом обновлении состояния: по нему лист перечитывает свои данные. */
  const [version, setVersion] = useState(0);

  const reload = useCallback(async () => {
    try {
      setState(await api.state());
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
    const events = new EventSource('/api/events');
    events.onmessage = () => void reload();
    return () => events.close();
  }, [reload]);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const run: Run = useCallback(
    async (action) => {
      try {
        await action();
        setError(null);
        await reload();
        return true;
      } catch (e) {
        setError((e as Error).message);
        return false;
      }
    },
    [reload],
  );

  if (!state) {
    return (
      <div className="app">
        <p className="loading" role={error ? 'alert' : 'status'}>
          {error ?? 'Читаю папку игры…'}
        </p>
      </div>
    );
  }

  const firstPerson = state.roster.find((r) => r.kind === 'person' && !r.isLead)?.id ?? state.roster[0]?.id ?? null;
  const sheetId = route.name === 'sheet' ? (route.id ?? firstPerson) : firstPerson;
  const phase = CYCLE.findIndex(([id]) => id === state.map.cycle);
  const nav = (name: Route['name'], href: string, label: string) => (
    <a href={href} className={`nav ${route.name === name ? 'on' : ''}`} aria-current={route.name === name ? 'page' : undefined}>
      {label}
    </a>
  );

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="wordmark">связка</span>
          <span className="tagline">экспедиция продуктовой команды</span>
        </div>
        <nav className="navs" aria-label="Экраны">
          {nav('people', '#/people', '1 отряд')}
          <span className="nav off" title="Карта появится на шаге 5">
            2 карта
          </span>
          {nav('tasks', '#/tasks', '3 переходы')}
          {nav('sheet', `#/sheet/${sheetId ?? ''}`, 'лист')}
          {nav('turn', '#/turn', 'ход')}
        </nav>
        <div className="top-right">
          <span>ход: {state.today}</span>
          {state.turn ? (
            <>
              <Attention turn={state.turn} />
              {state.turn.closed && <span className="muted">закрыт</span>}
            </>
          ) : (
            <StartTurn state={state} run={run} compact />
          )}
        </div>
      </header>

      <div className="strip">
        <span>цикл:</span>
        {CYCLE.map(([id, label], i) => (
          <span key={id} className={i === phase ? 'now' : undefined}>
            {i === phase ? `▸ ${label}` : i < phase ? `${label} ✓` : label}
          </span>
        ))}
        <span className="strip-right">
          цель: лагерь «{state.targetCamp ?? state.map.target}» · погода: <span className="amber">{state.map.weather.stage}</span>
        </span>
      </div>

      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn" onClick={() => setError(null)}>
            закрыть
          </button>
        </div>
      )}

      <main className="screen">
        {route.name === 'people' && <People state={state} run={run} />}
        {route.name === 'tasks' && <Tasks state={state} />}
        {route.name === 'turn' && <TurnScreen state={state} run={run} />}
        {route.name === 'sheet' && sheetId && <Sheet key={sheetId} state={state} id={sheetId} version={version} run={run} />}
      </main>
    </div>
  );
}
