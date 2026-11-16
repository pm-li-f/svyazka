import { useState } from 'react';
import { api, type StateView } from './api';
import { Cmd, Panel, Scroll } from './ui';

const ago = (n: number | null) => (n === null ? 'данных ещё нет' : n === 0 ? 'сегодня' : `${n} дн. назад`);

/** Кнопка «снять данные»: сервер сам сходит в источник и запишет снимок, страница перечитает его. */
function SyncButton({ only, ready, label }: { only: 'jira' | 'confluence'; ready: boolean; label: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const sync = async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = (await api.sync(only))[only];
      if (!result) setNote({ ok: false, text: 'Источник не настроен.' });
      else if ('error' in result) setNote({ ok: false, text: result.error });
      else setNote({ ok: true, text: result.report.problems.length ? `Снимок записан. Замечаний: ${result.report.problems.length}.` : 'Снимок записан.' });
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sync">
      <button type="button" className="btn" onClick={() => void sync()} disabled={busy || !ready} title={ready ? undefined : 'В файле ключей нет логина и пароля: sv keys init'}>
        {busy ? 'читаю…' : label}
      </button>
      {!ready && <span className="hint">В файле ключей нет логина и пароля: выполни в терминале sv keys init.</span>}
      {note && (
        <span className={`sans ${note.ok ? 'green' : 'coral'}`} role={note.ok ? 'status' : 'alert'}>
          {note.text}
        </span>
      )}
    </div>
  );
}

/** Jira на экране «переходы»: что стоит за каждым переходом и у кого задачи в работе. */
export function JiraPanels({ state }: { state: StateView }) {
  const j = state.sources.jira;
  if (!j.configured && j.at === null) return null;
  const mark = (n: number) => (n > 0 ? <b className="amber">{n}</b> : <span className="faint">·</span>);
  const failed = j.tasks.filter((t) => t.error);
  return (
    <div className="split">
      <Panel
        title={
          <>
            <Cmd>sv sync</Cmd> · Jira · {j.at ? `снимок от ${j.at}, ${ago(j.age)}` : 'данных ещё нет'}
          </>
        }
        className="grow"
        block="jira"
      >
        {j.tasks.length > 0 && (
          <div className="scroll-x cap" tabIndex={0} role="group" aria-label="Переходы в Jira">
            <table className="grid">
              <thead>
                <tr>
                  <th>ПЕРЕХОД</th>
                  <th>В JIRA ЗАКРЫТО</th>
                  <th className="center">В РАБОТЕ</th>
                  <th className="center">СТОЯТ</th>
                  <th className="center">ПРОСРОЧЕНО</th>
                  <th className="center">ЖДУТ</th>
                  <th>КТО В РАБОТЕ</th>
                </tr>
              </thead>
              <tbody>
                {j.tasks
                  .filter((t) => !t.error)
                  .map((t) => (
                    <tr key={t.task}>
                      <td>
                        <b>{t.task}</b>
                      </td>
                      <td>
                        <span className="meter" aria-hidden="true">
                          <i style={{ width: `${t.total ? (t.done / t.total) * 100 : 0}%` }} />
                        </span>{' '}
                        {t.done} из {t.total}
                        {t.truncated ? '+' : ''}
                      </td>
                      <td className="center">{t.inProgress}</td>
                      <td className="center" title={t.stalled.map((i) => `${i.key}: ${i.days} дн.`).join(', ')}>
                        {mark(t.stalled.length)}
                      </td>
                      <td className="center" title={t.overdue.map((i) => `${i.key}: ${i.days} дн.`).join(', ')}>
                        {mark(t.overdue.length)}
                      </td>
                      <td className="center" title={t.blocked.map((i) => `${i.key} ждёт ${i.by.join(', ')}`).join('; ')}>
                        {mark(t.blocked.length)}
                      </td>
                      <td className="sans">{t.working.map((w) => `${w.name} ${w.count}`).join(', ') || <span className="faint">—</span>}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <ul className="lint">
          {failed.map((t) => (
            <li key={t.task}>
              <b className="amber">✗</b> {t.task}: {t.error}
            </li>
          ))}
          {j.unknown.length > 0 && (
            <li>
              <b className="amber">!</b> исполнители, которых игра не узнала: {j.unknown.join(', ')}
            </li>
          )}
          {j.stale && (
            <li>
              <b className="amber">!</b> снимку {j.age} дн.: сигналы по нему могли устареть
            </li>
          )}
          {j.linked.tasks === 0 && <li>Ни у одного перехода нет ссылки: добавь в файл перехода строку jira: КЛЮЧ-1.</li>}
        </ul>
        <div className="panel-foot">
          <SyncButton only="jira" ready={state.sources.creds.jira} label="снять данные из Jira" />
          <p className="hint">
            Игра только читает Jira. Сроки считаются на дату снимка. «Стоят» — в работе, но без движения больше {j.staleDays} дн.
          </p>
        </div>
      </Panel>

      <Panel title="в работе у людей · вся Jira" className="side" block="jira-load">
        <Scroll label="Задачи в работе у людей" size="s">
          <ul className="rows">
            {j.people.map((p) => (
              <li key={p.id} className="between">
                <b>{p.name}</b>
                <span>
                  <span className={p.over ? 'amber bold' : undefined}>в работе {p.inProgress}</span>
                  <span className="muted"> · не закрыто {p.open}</span>
                </span>
              </li>
            ))}
            {j.people.length === 0 && <li className="muted">Нет данных: у людей не вписан логин Jira или снимок ещё не снят.</li>}
          </ul>
        </Scroll>
        <p className="panel-foot">
          Порог — {j.wipMax} в работе. Это число задач из трекера, а не оценка человека. Порядок — как в отряде.
        </p>
      </Panel>
    </div>
  );
}

/** Артефакты из Confluence на экране «карта»: что давно не меняли. */
export function ArtifactsPanel({ state }: { state: StateView }) {
  const c = state.sources.confluence;
  if (!c.configured && c.artifacts.length === 0) return null;
  const stale = c.artifacts.filter((a) => a.stale || a.error).length;
  return (
    <Panel title={`артефакты · Confluence${stale ? ` · устарело ${stale}` : ''}`} block="artifacts">
      <Scroll label="Артефакты" size="s">
        <ul className="rows">
          {c.artifacts.map((a) => (
            <li key={a.id}>
              <div className="between">
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noreferrer noopener">
                    <b>{a.title}</b>
                  </a>
                ) : (
                  <b>{a.title}</b>
                )}
                <span className={a.stale || a.error ? 'coral' : 'muted'}>{a.error ? 'не прочитана' : a.days === null ? 'нет данных' : ago(a.days)}</span>
              </div>
              <p className="prose muted">
                {a.error ?? (a.days === null ? 'Снимок ещё не снят.' : `Срок годности ${a.ttl} дн.${a.by ? ` Менял: ${a.by}.` : ''}`)}
              </p>
            </li>
          ))}
          {c.artifacts.length === 0 && <li className="muted">Артефактов нет: перечисли страницы в team/artifacts.yaml.</li>}
        </ul>
      </Scroll>
      <div className="panel-foot">
        <SyncButton only="confluence" ready={state.sources.creds.confluence} label="проверить страницы" />
        <p className="hint">{c.at ? `Снимок от ${c.at}, ${ago(c.age)}.` : ''} Игра читает только сведения о странице: когда и кто её менял.</p>
      </div>
    </Panel>
  );
}
