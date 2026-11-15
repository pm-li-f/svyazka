import { useState } from 'react';
import { api, type StateView } from '../api';
import { Attention, Cmd, DecisionInput, Panel, type Run, StartTurn } from '../ui';

export function TurnScreen({ state, run }: { state: StateView; run: Run }) {
  const [confirming, setConfirming] = useState(false);
  const [commit, setCommit] = useState<string | null>(null);
  const turn = state.turn;
  const label = (id: string) => state.labels[id] ?? id;

  const end = () =>
    run(async () => {
      const res = await api.endTurn();
      setCommit(res.commit);
      setConfirming(false);
    });

  return (
    <div className="split">
      <Panel title={<Cmd>sv turn</Cmd>} className="grow">
        {!turn ? (
          <div className="pad">
            <StartTurn state={state} run={run} />
          </div>
        ) : (
          <>
            <div className="pad between">
              <Attention turn={turn} />
              {turn.closed ? (
                <span className="muted">ход закрыт</span>
              ) : confirming ? (
                <span className="inline-form">
                  <span className="muted">Закрыть ход? Действия больше не запишутся.</span>
                  <button type="button" className="btn primary" onClick={() => void end()}>
                    закрыть
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirming(false)}>
                    отмена
                  </button>
                </span>
              ) : (
                <button type="button" className="btn" onClick={() => setConfirming(true)}>
                  закрыть ход
                </button>
              )}
            </div>

            <h3 className="sub">действия</h3>
            {turn.actions.length === 0 ? (
              <p className="pad muted">Пока ничего. Открой лист или запиши 1on1.</p>
            ) : (
              <table className="grid">
                <tbody>
                  {turn.actions.map((a, i) => (
                    <tr key={i}>
                      <td>{label(a.kind)}</td>
                      <td>{a.target ?? ''}</td>
                      <td>−{a.cost}</td>
                      <td className="sans soft">{a.note ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h3 className="sub">решения</h3>
            {turn.decisions.length === 0 && <p className="pad muted">Решений пока нет.</p>}
            <ul className="rows">
              {turn.decisions.map((d, i) => (
                <li key={i}>
                  <p className="prose">{d}</p>
                </li>
              ))}
            </ul>
            {!turn.closed && (
              <div className="pad">
                <DecisionInput run={run} />
              </div>
            )}

            {turn.closed && (
              <>
                <h3 className="sub">до чего не дошёл</h3>
                {turn.untouched.length === 0 && <p className="pad muted">Всё разобрано.</p>}
                <ul className="rows">
                  {turn.untouched.map((u, i) => (
                    <li key={i}>
                      <p className="prose soft">{u}</p>
                    </li>
                  ))}
                </ul>
                {commit && <p className="panel-foot">{commit}</p>}
              </>
            )}
          </>
        )}
      </Panel>

      <Panel title="цена внимания" className="side">
        <div className="pad stack">
          {Object.entries(state.actionCosts).map(([kind, cost]) => (
            <div key={kind} className="between">
              <span className="sans">{label(kind)}</span>
              <span>−{cost}</span>
            </div>
          ))}
          <p className="hint">
            Открытый лист списывается сам, один раз за ход на человека. Перерасход не запрещён, а показывается. Сигнал снимается только
            изменением данных, а не отметкой.
          </p>
          <p className="hint">
            {state.budget.usual === null
              ? `Потолок — ${state.budget.limit}.`
              : `Обычно у тебя ${state.budget.usual}, сегодня не больше ${state.budget.limit}.`}
          </p>
        </div>
      </Panel>
    </div>
  );
}
