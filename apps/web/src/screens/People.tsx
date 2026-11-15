import type { StateView } from '../api';
import { Attention, Cmd, days, DecisionInput, Panel, type Run, StartTurn } from '../ui';

const SEVERITY = { crit: 'coral', warn: 'amber', lint: 'amber', info: 'blue' } as const;
const STATUS_COLOR = { steady: 'green', loaded: 'amber', stale: 'coral', running: 'muted' } as const;

export function People({ state, run }: { state: StateView; run: Run }) {
  const personIds = new Set(state.roster.filter((r) => r.kind === 'person').map((r) => r.id));
  const turn = state.turn;

  return (
    <div className="stack-lg">
      <div className="split">
        <div className="stack-lg grow">
          <Panel title={<Cmd>sv roster --with-agents</Cmd>} >
            <div className="scroll-x">
              <table className="grid roster">
                <thead>
                  <tr>
                    <th>NAME</th>
                    <th>ROLE</th>
                    <th>ТИП</th>
                    <th>РОЛЬ В ОТРЯДЕ</th>
                    <th>STATUS</th>
                    <th>LOAD</th>
                    <th>1ON1</th>
                    <th>ЛИСТ</th>
                    <th>OWNS</th>
                  </tr>
                </thead>
                <tbody>
                  {state.roster.map((r) =>
                    r.kind === 'agent' ? (
                      <tr key={r.id} className="muted">
                        <td>{r.name}</td>
                        <td>{r.role}</td>
                        <td>—</td>
                        <td>—</td>
                        <td>{r.status}</td>
                        <td>—</td>
                        <td>—</td>
                        <td className={r.staleUpdate ? 'coral' : undefined}>{days(r.daysSinceUpdate)}</td>
                        <td>R only · отвечает {r.accountable}</td>
                      </tr>
                    ) : (
                      <tr key={r.id} className={r.status === 'stale' ? 'hi' : undefined}>
                        <td>
                          <a href={`#/sheet/${r.id}`} className="name">
                            {r.isLead ? 'ты' : r.id}
                          </a>
                        </td>
                        <td>{r.role}</td>
                        <td>{r.mbti ?? '—'}</td>
                        <td>{r.belbin ?? '—'}</td>
                        <td className={STATUS_COLOR[r.status]}>{r.status}</td>
                        <td className={r.load === null ? 'muted' : r.status === 'loaded' ? 'amber' : undefined}>
                          {r.load === null ? '?' : `${r.load}%`}
                        </td>
                        <td className={r.stale1on1 ? 'coral' : undefined}>{days(r.daysSince1on1)}</td>
                        <td className={r.staleUpdate ? 'coral' : undefined}>{days(r.daysSinceUpdate)}</td>
                        <td className="muted">{r.owns.join(', ') || '—'}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
            <p className="panel-foot">
              1on1 — дней с последней встречи. Лист — когда человек сам обновлял свой лист. Срок годности контекста — {state.ttlDays}{' '}
              дней. Твой лист тоже протухает.
            </p>
          </Panel>

          <div className="grid3 widgets">
            <Panel title="слово агентам">
              <ul className="rows">
                {state.agents.map((a) => (
                  <li key={a.id}>
                    <div className="between">
                      <b>{a.name}</b>
                      <span className="muted">отвечает {a.accountable}</span>
                    </div>
                    <p className="prose">{a.report ? a.report.text : 'Отчётов пока нет.'}</p>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title="error budget · стресс">
              <div className="pad stack">
                {state.stress.map((s) => (
                  <div key={s.id} className="bar-row">
                    <span>{s.id === state.roster.find((r) => r.isLead)?.id ? 'ты' : s.id}</span>
                    <span className="bar" aria-hidden="true">
                      {s.left !== null && (
                        <span className={`fill ${s.left <= 15 ? 'bg-coral' : s.left <= 30 ? 'bg-amber' : ''}`} style={{ width: `${s.left}%` }} />
                      )}
                    </span>
                    <span className={s.left === null ? 'muted' : s.left <= 15 ? 'coral' : s.left <= 30 ? 'amber' : undefined}>
                      {s.left === null ? 'n/a' : `${s.left}%`}
                    </span>
                  </div>
                ))}
                <p className="hint">
                  Сколько осталось до полной загрузки, по свежим отметкам самих людей. Бюджет исчерпан — стоп новым задачам на человека.
                  Тебя это тоже касается.
                </p>
              </div>
            </Panel>

            <Panel title="ход">
              <div className="pad stack">
                {turn ? (
                  <>
                    <div>
                      <Attention turn={turn} />
                    </div>
                    <div className="muted">
                      действий {turn.actions.length} · решений {turn.decisions.length}
                      {turn.closed ? ' · ход закрыт' : ''}
                    </div>
                    <a href="#/turn" className="btn link">
                      к журналу хода
                    </a>
                  </>
                ) : (
                  <StartTurn state={state} run={run} />
                )}
              </div>
            </Panel>
          </div>
        </div>

        <Panel title={`сигналы · ${state.signals.length}`} className="side">
          {state.signals.length === 0 && <p className="pad muted">Сигналов нет.</p>}
          <ul className="rows">
            {state.signals.map((s, i) => (
              <li key={i}>
                <div>
                  <b className={SEVERITY[s.severity]}>{s.severity.toUpperCase()}</b> {s.code} · {s.target}
                </div>
                <p className="prose">{s.text}</p>
                {personIds.has(s.target) && s.code !== 'attention' && (
                  <a href={`#/sheet/${s.target}`} className="btn link">
                    открыть лист
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {turn && !turn.closed && <DecisionInput run={run} />}
    </div>
  );
}
