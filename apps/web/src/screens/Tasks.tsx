import type { StateView } from '../api';
import { Cmd, Panel, STATUS, TERRAIN } from '../ui';

const CRAFT = { 1: 'учится', 2: 'сам', 3: 'учит' } as const;
const TERRAIN_COLOR = { trail: 'muted', pass: 'soft', fog: 'blue', storm: 'coral' } as const;

export function Tasks({ state }: { state: StateView }) {
  const { raci, skills } = state;
  const short = (a: { id: string; kind: string }) => (a.kind === 'agent' ? `a/${a.id.slice(0, 5)}` : a.id === raci.actors[0]?.id ? 'ты' : a.id);

  return (
    <div className="stack-lg">
      <div className="split">
        <Panel title={<Cmd>sv raci</Cmd>} className="grow" block="raci">
          <div className="scroll-x cap" tabIndex={0} role="group" aria-label="Матрица RACI">
            <table className="grid raci">
              <thead>
                <tr>
                  <th>ПЕРЕХОД</th>
                  <th>МЕСТНОСТЬ</th>
                  {raci.actors.map((a) => (
                    <th key={a.id} className="center" title={a.name}>
                      {short(a)}
                    </th>
                  ))}
                  <th>СТАТУС</th>
                </tr>
              </thead>
              <tbody>
                {raci.tasks.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <b>{t.id}</b>
                    </td>
                    <td className={TERRAIN_COLOR[t.terrain]}>{TERRAIN[t.terrain]}</td>
                    {raci.actors.map((a) => {
                      const roles = t.cells[a.id] ?? [];
                      const bad = t.agentAccountable && roles.includes('A');
                      return (
                        <td key={a.id} className="center">
                          {roles.length === 0 ? (
                            <span className="faint">·</span>
                          ) : bad ? (
                            <span className="cell bad" title="Отвечает агент">
                              {roles.join(' ')}
                            </span>
                          ) : (
                            roles.map((r) => (
                              <span key={r} className={`cell ${r}`}>
                                {r}
                              </span>
                            ))
                          )}
                        </td>
                      );
                    })}
                    <td className={t.status === 'blocked' ? 'coral' : undefined}>
                      {STATUS[t.status]}
                      {t.note ? ` · ${t.note}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="lint" data-block="raci-lint">
            {raci.lint.length === 0 && (
              <li>
                <b className="green">✓</b> нарушений нет
              </li>
            )}
            {raci.lint.map((f, i) => (
              <li key={i}>
                {f.code === 'no-responsible' && (
                  <>
                    <b className="coral">✗</b> {f.task}: никто не ведёт
                  </>
                )}
                {f.code === 'no-accountable' && (
                  <>
                    <b className="amber">✗</b> {f.task}: нет ответственного
                  </>
                )}
                {f.code === 'agent-accountable' && (
                  <>
                    <b className="amber">✗</b> {f.task}: отвечает агент
                  </>
                )}
                {f.code === 'accountable-overload' && (
                  <>
                    <b className="amber">!</b> {f.actor} отвечает сразу в {f.tasks.length} переходах
                  </>
                )}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="кто есть кто в связке" className="side" block="raci-legend">
          <div className="pad stack">
            <div className="legend">
              <span className="cell R">R</span>
              <span className="prose">ведёт участок. Может быть агент.</span>
            </div>
            <div className="legend">
              <span className="cell A">A</span>
              <span className="prose">отвечает. Один, и это человек.</span>
            </div>
            <div className="legend">
              <span className="cell C">C</span>
              <span className="prose">на связи: спросить до решения.</span>
            </div>
            <div className="legend">
              <span className="cell I">I</span>
              <span className="prose">в лагере знает: сообщить после.</span>
            </div>
            <p className="hint">Связка без A — это просто несколько людей на одном склоне.</p>
          </div>
        </Panel>
      </div>

      <div className="split">
        <Panel
          title={
            <>
              <Cmd>sv skills</Cmd> · видит отряд
            </>
          }
          className="grow"
          block="skills"
        >
          <div className="scroll-x cap" tabIndex={0} role="group" aria-label="Матрица ремесла">
            <table className="grid skills">
              <thead>
                <tr>
                  <th>РЕМЕСЛО</th>
                  {skills.people.map((p, i) => (
                    <th key={p.id} className="center">
                      {i === 0 ? 'ты' : p.id}
                    </th>
                  ))}
                  <th>МОГУТ САМИ</th>
                </tr>
              </thead>
              <tbody>
                {skills.rows.map((r) => (
                  <tr key={r.skill}>
                    <td className="sans">{r.label}</td>
                    {skills.people.map((p) => {
                      const level = r.levels[p.id] ?? null;
                      return (
                        <td key={p.id} className="center">
                          {level === null ? <span className="faint">·</span> : <span className={`lvl l${level}`}>{CRAFT[level]}</span>}
                        </td>
                      );
                    })}
                    <td className={r.single || r.none ? 'coral bold' : 'soft'}>
                      {r.none ? '0 · не держит никто' : r.single ? '1 · держит один' : r.holders}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="panel-foot">
            Три ступени: учится, делает сам, учит других. Шкала отвечает на вопрос «к кому идти», а не «кто лучше». Мышление и люди по
            именам отряд не видит.
          </p>
        </Panel>

        <Panel title="тактика по местности" className="side" block="tactics">
          <ul className="rows">
            <li>
              <b className="soft">тропа · простой</b>
              <p className="prose muted">Увидел — определил — сделал. Отдай агенту, проверь результат.</p>
            </li>
            <li>
              <b>перевал · сложный</b>
              <p className="prose muted">Изучи — позови проводника — иди. Без эксперта не соваться.</p>
            </li>
            <li>
              <b className="blue">туман · запутанный</b>
              <p className="prose muted">Разведка — наблюдение — решение. Три дешёвых прототипа лучше одного плана.</p>
            </li>
            <li>
              <b className="coral">шторм · хаотичный</b>
              <p className="prose muted">Сначала действуй, потом разбирайся. Командир один.</p>
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
