import { useCallback, useEffect, useRef, useState } from 'react';
import { events, type Facts, type GameEvent, isSplash, plan, type SplashEvent } from '@svyazka/engine/src/events';
import { api, type StateView } from './api';
import { Effects, type Toast } from './game/Effects';
import { useReducedMotion, useSettings } from './game/settings';
import { chime } from './game/sound';
import { Splash } from './game/Splash';
import { MapScreen } from './screens/Map';
import { People } from './screens/People';
import { Settings } from './screens/Settings';
import { Sheet } from './screens/Sheet';
import { Tasks } from './screens/Tasks';
import { TurnScreen } from './screens/Turn';
import { Attention, CYCLE, type Run, StartTurn } from './ui';

type Route = { name: 'people' } | { name: 'map' } | { name: 'tasks' } | { name: 'turn' } | { name: 'settings' } | { name: 'sheet'; id: string | null };

function parseHash(): Route {
  const [, name, id] = window.location.hash.split('/');
  if (name === 'map') return { name: 'map' };
  if (name === 'tasks') return { name: 'tasks' };
  if (name === 'turn') return { name: 'turn' };
  if (name === 'settings') return { name: 'settings' };
  if (name === 'sheet') return { name: 'sheet', id: id ?? null };
  return { name: 'people' };
}

export function App() {
  const [state, setState] = useState<StateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(parseHash);
  /** Растёт при каждом обновлении состояния: по нему лист перечитывает свои данные. */
  const [version, setVersion] = useState(0);

  // Игровой слой: заставки и эффекты по событиям между двумя состояниями.
  const [settings, updateSettings] = useSettings();
  const reduced = useReducedMotion();
  const live = useRef(settings);
  live.current = settings;
  const known = useRef<Facts | null>(null);
  const nextId = useRef(1);
  const [splashes, setSplashes] = useState<SplashEvent[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  /** Показать события. `force` — предпросмотр из настроек: показывает, как бы они ни стояли. */
  const show = useCallback((list: GameEvent[], stormy: boolean, force = false) => {
    const now = live.current;
    const shown = force ? { splashes: list.filter(isSplash), effects: list.filter((e) => !isSplash(e)) } : plan(list, now, stormy);
    if (shown.splashes.length) setSplashes((queue) => [...queue, ...shown.splashes]);
    if (shown.effects.length) setToasts((old) => [...old, ...shown.effects.map((event) => ({ id: nextId.current++, event }) as Toast)].slice(-3));
    const first = shown.splashes[0] ?? shown.effects[0];
    if (first && now.sound) chime(first.kind);
  }, []);
  const closeToast = useCallback((id: number) => setToasts((old) => old.filter((t) => t.id !== id)), []);
  const nextSplash = useCallback(() => setSplashes((queue) => queue.slice(1)), []);

  const reload = useCallback(async () => {
    try {
      const next = await api.state();
      show(events(known.current, next.facts), Object.keys(next.facts.storms).length > 0);
      known.current = next.facts;
      setState(next);
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [show]);

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
      <header className="top" data-block="top">
        <div className="brand">
          <span className="wordmark">связка</span>
          <span className="tagline">экспедиция продуктовой команды</span>
        </div>
        <nav className="navs" aria-label="Экраны">
          {nav('people', '#/people', 'отряд')}
          {nav('map', '#/map', 'карта')}
          {nav('tasks', '#/tasks', 'переходы')}
          {nav('sheet', `#/sheet/${sheetId ?? ''}`, 'лист')}
          {nav('turn', '#/turn', 'ход')}
          {nav('settings', '#/settings', 'настройки')}
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

      <div className="strip" data-block="strip">
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
        {route.name === 'map' && <MapScreen state={state} run={run} />}
        {route.name === 'tasks' && <Tasks state={state} />}
        {route.name === 'turn' && <TurnScreen state={state} run={run} />}
        {route.name === 'settings' && (
          <Settings state={state} settings={settings} update={updateSettings} reduced={reduced} preview={(event) => show([event], false, true)} />
        )}
        {route.name === 'sheet' && sheetId && <Sheet key={sheetId} state={state} id={sheetId} version={version} run={run} />}
      </main>

      <Effects toasts={toasts} mode={settings.effects === 'off' ? 'calm' : settings.effects} onClose={closeToast} />
      {splashes[0] && <Splash key={`${splashes[0].kind}-${splashes.length}`} event={splashes[0]} state={state} reduced={reduced} onDone={nextSplash} />}
    </div>
  );
}
