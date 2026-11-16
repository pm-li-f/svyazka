import { NavigatorPrep } from '../Navigator';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { api, type Layer, type SheetView, type StateView } from '../api';
import { Cmd, Dots, LAYER_NAME, type Run, Scroll, TERRAIN } from '../ui';

const CRAFT = { 1: 'учусь', 2: 'делаю сам', 3: 'учу других' } as const;
const VIEW_AS: [Layer, string][] = [
  ['team', 'как видит отряд'],
  ['pair', 'как видит сам человек'],
  ['me', 'всё, что видишь ты'],
];

function Block({ name, title, layer, who, children }: { name: string; title: string; layer: Layer; who: string; children: ReactNode }) {
  return (
    <div className="block" data-block={`sheet-${name}`}>
      <div className="between">
        <h3 className="block-title">{title}</h3>
        <span className={`vis ${layer}`}>{layer === 'pair' ? `${who} и ты` : LAYER_NAME[layer]}</span>
      </div>
      {children}
    </div>
  );
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="field">
    <span className="field-label">{label}</span>
    <span className="field-value">{children}</span>
  </div>
);

export function Sheet({ state, id, version, run }: { state: StateView; id: string; version: number; run: Run }) {
  const [layer, setLayer] = useState<Layer>('me');
  const [sheet, setSheet] = useState<SheetView | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .sheet(id, layer)
      .then((s) => alive && setSheet(s))
      .catch(() => alive && setSheet(null));
    return () => {
      alive = false;
    };
  }, [id, layer, version]);

  // Открытый лист стоит внимания один раз за ход. Просмотр чужими глазами не считается.
  useEffect(() => {
    if (layer !== 'me') return;
    void api.openSheet(id).then((r) => {
      if (r.charged > 0) void run(() => Promise.resolve());
    });
  }, [id, layer, run]);

  const people = state.roster.filter((r) => r.kind === 'person');
  if (!sheet || sheet.person.id !== id) return <p className="loading">Открываю лист…</p>;

  const { person, pair, me } = sheet;
  const turnOpen = state.turn !== null && !state.turn.closed;
  const cost = state.actionCosts['one-on-one'];
  const submit1on1 = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api.oneOnOne(id, note))) setNote('');
  };

  return (
    <div className="stack-lg">
      <div className="sheet-bar" data-block="sheet-bar">
        <span className="muted">
          <Cmd>sv sheet</Cmd>
        </span>
        <nav className="navs" aria-label="Чей лист">
          {people.map((p) => (
            <a key={p.id} href={`#/sheet/${p.id}`} className={`nav small ${p.id === id ? 'on' : ''}`} aria-current={p.id === id ? 'page' : undefined}>
              {p.isLead ? 'ты' : p.id}
            </a>
          ))}
        </nav>
        <div className="view-as" role="group" aria-label="Чьими глазами смотреть">
          {VIEW_AS.map(([l, text]) => (
            <button key={l} type="button" className={`btn seg ${l === layer ? 'on' : ''}`} aria-pressed={l === layer} onClick={() => setLayer(l)}>
              {text}
            </button>
          ))}
        </div>
      </div>

      <div className="grid3 sheet-cols">
        <section className="panel">
          <Block name="who" title="кто" layer="team" who={person.name}>
            <div className="fields2">
              <Field label="имя">{person.name}</Field>
              {person.joined && <Field label="в отряде с">{person.joined}</Field>}
            </div>
            <Field label="роль">{person.role}</Field>
            {person.mbti && (
              <>
                <span className="field-label">тип (MBTI)</span>
                <div className="mbti" aria-label={person.mbti}>
                  {[...person.mbti].map((c, i) => (
                    <span key={i}>{c}</span>
                  ))}
                </div>
                <p className="hint">Тип — язык, чтобы договориться. Не приговор.</p>
              </>
            )}
            {person.belbin && <Field label="роль в отряде (Белбин)">{person.belbin}</Field>}
            {person.belbinShadow && <p className="hint">Тень роли: {person.belbinShadow}.</p>}
            {person.owns.length > 0 && <Field label="владеет">{person.owns.join(', ')}</Field>}
          </Block>

          {sheet.tasks.length > 0 && (
            <Block name="tasks" title="в переходах" layer="team" who={person.name}>
              {sheet.tasks.map((t) => (
                <div key={t.id} className="between">
                  <span>
                    {t.id} · {TERRAIN[t.terrain].split(' · ')[0]}
                  </span>
                  <b>{t.roles.join(' ')}</b>
                </div>
              ))}
            </Block>
          )}

          {pair && (pair.drives.length > 0 || pair.dampers.length > 0) && (
            <Block name="drives" title="что движет" layer="pair" who={person.name}>
              <div className="chips">
                {pair.drives.map((d) => (
                  <span key={d} className="chip">
                    {d}
                  </span>
                ))}
              </div>
              {pair.dampers.length > 0 && <p className="hint">Что гасит: {pair.dampers.join(', ')}.</p>}
            </Block>
          )}

          {pair?.state && (
            <Block name="state" title={`состояние · заполняет ${person.isLead ? 'сам' : person.name}`} layer="pair" who={person.name}>
              <div className="fields2">
                <Field label="запас сил">
                  <Dots n={pair.state.energy} of={5} className={pair.state.energy <= 2 ? 'coral' : undefined} />
                </Field>
                <Field label="нагрузка">
                  <span className={pair.state.load >= 85 ? 'amber' : undefined}>{pair.state.load}%</span>
                </Field>
              </div>
              {pair.state.note && <p className="prose">«{pair.state.note}»</p>}
              <p className={`hint ${pair.state.fresh ? '' : 'coral'}`}>
                Обновлено {pair.state.daysAgo} дн. назад{pair.state.fresh ? '' : ' — устарело, верить осторожно'}. Это состояние, а не оценка:
                баллов тут нет.
              </p>
            </Block>
          )}
        </section>

        <section className="panel">
          <Block name="craft" title="ремесло · согласованный уровень" layer="team" who={person.name}>
            {sheet.craft.map((c) => (
              <div key={c.skill} className="line">
                <span className="sans">{c.label}</span>
                <span className="soft">
                  {CRAFT[c.level]}{' '}
                  <span aria-hidden="true">
                    {'▮'.repeat(c.level)}
                    <span className="muted">{'▯'.repeat(3 - c.level)}</span>
                  </span>
                </span>
              </div>
            ))}
            <p className="hint">Одна отметка, согласованная на 1on1. Отвечает на вопрос «к кому идти», а не «кто лучше».</p>
          </Block>

          {pair && pair.thinking.length > 0 && (
            <Block name="thinking" title="мышление и люди" layer="pair" who={person.name}>
              <div className="think head">
                <span />
                <span className="blue">сам</span>
                <span>ты</span>
              </div>
              {pair.thinking.map((t) => (
                <div key={t.key} className={`think ${t.gap ? 'hi' : ''}`}>
                  <span className="sans">
                    {t.label} {t.gap && <span className="amber mono">← разрыв</span>}
                  </span>
                  <Dots n={t.self} of={5} className="blue" />
                  <Dots n={t.lead} of={5} />
                </div>
              ))}
              <p className="hint">Разрыв между «сам» и «ты» — не ошибка в данных. Это тема для 1on1.</p>
            </Block>
          )}

          {pair?.quest && (
            <Block name="quest" title="личный квест" layer="pair" who={person.name}>
              <p className="prose strong">{pair.quest.text}</p>
              <span className="quest" role="img" aria-label={`сделано ${pair.quest.done} из ${pair.quest.steps}`}>
                {Array.from({ length: pair.quest.steps }, (_, i) => (
                  <span key={i} className={i < (pair.quest?.done ?? 0) ? 'done' : undefined} />
                ))}
              </span>
              <p className="hint">Квест выбирает {person.name}. Ты только предлагаешь.</p>
            </Block>
          )}
        </section>

        {(pair || me) && (
        <section className="panel">
          {layer === 'me' && !person.isLead && (
            <Block name="oneonone" title="1on1" layer="pair" who={person.name}>
              {pair && (
                <p className={`hint ${pair.stale1on1 ? 'coral' : ''}`}>
                  {pair.daysSince1on1 === null
                    ? 'Встреч ещё не было.'
                    : pair.daysSince1on1 === 0
                      ? 'Последняя встреча — сегодня.'
                      : `Последняя встреча — ${pair.daysSince1on1} дн. назад.`}
                </p>
              )}
              {turnOpen ? (
                <form className="stack" onSubmit={submit1on1}>
                  <label htmlFor="note" className="field-label">
                    заметка в журнал, необязательно
                  </label>
                  <textarea id="note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
                  <button type="submit" className="btn primary">
                    записать 1on1{cost ? ` · −${cost}` : ''}
                  </button>
                </form>
              ) : (
                <p className="hint">Чтобы записать встречу, начни ход.</p>
              )}
              <NavigatorPrep state={state} id={id} />
            </Block>
          )}

          {pair && pair.journal.length > 0 && (
            <Block name="journal" title="журнал встреч" layer="pair" who={person.name}>
              <Scroll label="Журнал встреч" size="s">
              {pair.journal.map((e, i) => (
                <div key={i} className="entry">
                  <span className="field-label">
                    {e.at} · {e.kind}
                  </span>
                  <p className={`prose ${i === 0 ? '' : i === 1 ? 'soft' : 'muted'}`}>{e.text}</p>
                </div>
              ))}
              </Scroll>
              <p className="hint">Записи тускнеют. Старым верь осторожно.</p>
            </Block>
          )}

          {pair?.review360 && (
            <Block name="review360" title="360 · темы, без баллов" layer="pair" who={person.name}>
              {pair.review360.themes.map((t) => (
                <p key={t} className="prose">
                  «{t}»
                </p>
              ))}
              <p className="hint">Собрано {pair.review360.at}.</p>
            </Block>
          )}

          {me && me.bonds.length > 0 && (
            <Block name="bonds" title="связи" layer="me" who={person.name}>
              {me.bonds.map((b) => (
                <div key={b.with} className="between">
                  <span className="sans">
                    {b.name}
                    {b.note ? ` — ${b.note}` : ''}
                  </span>
                  <Dots n={b.strength} of={3} className={b.strength === 1 ? 'coral' : undefined} />
                </div>
              ))}
            </Block>
          )}

          {me && me.margin.length > 0 && (
            <Block name="margin" title="заметки на полях" layer="me" who={person.name}>
              <Scroll label="Заметки на полях" size="s">
              {me.margin.map((m, i) => (
                <p key={i} className="hand">
                  {m.text}
                </p>
              ))}
              </Scroll>
            </Block>
          )}
        </section>
        )}
      </div>

      <p className="prose muted">
        Всё, что есть на листе, {person.name} видит и может оспорить, кроме твоих заметок на полях и связей. Переключатель сверху
        показывает лист чужими глазами: так проверяется, что лишнее не утекает.
      </p>
    </div>
  );
}
