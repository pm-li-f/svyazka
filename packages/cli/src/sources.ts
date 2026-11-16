import { keysFile, loadGame } from '@svyazka/core';
import { sourcesView } from '@svyazka/engine';
import { checkSources, hasCreds, readCreds, runSync, type RunOptions, type SyncResult } from '@svyazka/sources';
import { type Cell, makePaint, type Paint, table } from './format.js';

const plain = makePaint(false);
const AUTH = { token: 'токен', basic: 'логин и пароль в запросе', session: 'сессия' } as const;
const age = (n: number | null) => (n === null ? 'данных ещё нет' : n === 0 ? 'сегодня' : `${n} дн. назад`);

/** `sv sources`: что настроено, найден ли вход, насколько свежи снимки. В сеть не ходит. */
export function sourcesStatus(dir: string, today: string, p: Paint = plain): string {
  const game = loadGame(dir);
  const view = sourcesView(game, today);
  const creds = readCreds();
  const state = (s: { configured: boolean; at: string | null; age: number | null; stale: boolean }, found: boolean): Cell[] => [
    s.configured ? { t: 'настроен', c: p.green } : { t: 'не настроен', c: p.dim },
    !s.configured ? '' : found ? { t: 'вход найден', c: p.green } : { t: 'входа нет в файле ключей', c: p.red },
    !s.configured ? '' : { t: s.at ? `снимок от ${s.at} · ${age(s.age)}` : age(null), c: s.stale || !s.at ? p.yellow : p.dim },
  ];
  const rows: Cell[][] = [
    [{ t: 'Jira', c: p.bold }, view.jira.url ?? '', ...state(view.jira, hasCreds(creds.jira))],
    [{ t: 'Confluence', c: p.bold }, view.confluence.url ?? '', ...state(view.confluence, hasCreds(creds.confluence))],
  ];
  const lines = [p.dim(`источники · ${today} · файл ключей ${keysFile()}`), ...table(rows)];

  lines.push('', p.dim(`связано с Jira: переходов ${view.jira.linked.tasks}, людей ${view.jira.linked.people} · артефактов Confluence: ${view.confluence.artifacts.length}`));
  if (view.jira.tasks.length) {
    lines.push(
      '',
      ...table([
        [p.dim('ПЕРЕХОД'), p.dim('В JIRA'), p.dim('В РАБОТЕ'), p.dim('СТОЯТ'), p.dim('ПРОСРОЧЕНО'), p.dim('ЖДУТ'), p.dim('КТО В РАБОТЕ')].map((t) => t as Cell),
        ...view.jira.tasks
          .filter((t) => !t.error)
          .map((t): Cell[] => [
            { t: t.task, c: p.bold },
            `${t.done} из ${t.total}${t.truncated ? '+' : ''}`,
            String(t.inProgress),
            t.stalled.length ? { t: String(t.stalled.length), c: p.yellow } : '·',
            t.overdue.length ? { t: String(t.overdue.length), c: p.yellow } : '·',
            t.blocked.length ? { t: String(t.blocked.length), c: p.yellow } : '·',
            t.working.map((w) => `${w.name} ${w.count}`).join(', ') || '—',
          ]),
      ]),
      ...view.jira.tasks.filter((t) => t.error).map((t) => p.yellow(`${t.task}: ${t.error}`)),
    );
  }
  if (view.jira.people.length) {
    lines.push(
      '',
      p.dim(`в работе у людей во всей Jira (порог ${view.jira.wipMax}; это число из трекера, не оценка)`),
      ...table(view.jira.people.map((x): Cell[] => [{ t: x.name, c: p.bold }, { t: `в работе ${x.inProgress}`, ...(x.over ? { c: p.yellow } : {}) }, `не закрыто ${x.open}`])),
    );
  }
  if (view.jira.unknown.length) lines.push('', p.yellow(`Исполнители, которых игра не узнала: ${view.jira.unknown.join(', ')}. Если это люди отряда, впиши логин в поле jira их файла.`));
  if (view.confluence.artifacts.length) {
    lines.push(
      '',
      ...table([
        [p.dim('АРТЕФАКТ'), p.dim('МЕНЯЛИ'), p.dim('СРОК'), p.dim('КТО')].map((t) => t as Cell),
        ...view.confluence.artifacts.map((a): Cell[] => [
          { t: a.title, c: p.bold },
          a.error ? { t: 'не прочитана', c: p.yellow } : a.days === null ? 'данных ещё нет' : { t: `${a.days} дн. назад`, ...(a.stale ? { c: p.yellow } : {}) },
          `${a.ttl} дн.`,
          a.by ?? '',
        ]),
      ]),
      ...view.confluence.artifacts.filter((a) => a.error).map((a) => p.yellow(`${a.title}: ${a.error}`)),
    );
  }
  if (!view.jira.configured && !view.confluence.configured) {
    lines.push('', p.dim('Чтобы подключить Jira и Confluence, добавь в config.yaml раздел sources. Пошагово — docs/kak-zapustit.md, шаг 11.'));
  } else {
    lines.push('', p.dim('Проверить вход: sv sources check · Снять данные: sv sync'));
  }
  return lines.join('\n');
}

/** `sv sources check`: пробует войти и говорит, что получилось. Пароль не печатается. */
export async function sourcesCheck(dir: string, p: Paint = plain): Promise<{ text: string; ok: boolean }> {
  const rows = await checkSources({ dir });
  const lines: string[] = [p.dim(`проверка входа · файл ключей ${keysFile()}`)];
  let ok = true;
  for (const r of rows) {
    const title = r.source === 'jira' ? 'Jira' : 'Confluence';
    if (!r.url) {
      lines.push('', `${p.bold(title)}  ${p.dim('не настроен')}`);
      continue;
    }
    lines.push('', `${p.bold(title)}  ${r.url}`);
    if (r.ok) {
      lines.push(`  ${p.green('вход прошёл')} · ${r.user} · способ: ${r.auth ? AUTH[r.auth] : ''}${r.version ? ` · версия ${r.version}` : ''}`);
    } else {
      ok = false;
      lines.push(`  ${p.red('не вошёл')}: ${r.error}`);
    }
    for (const w of r.warnings) lines.push(`  ${p.yellow('!')} ${w}`);
  }
  if (rows.every((r) => !r.url)) {
    ok = false;
    lines.push('', 'Источники не настроены: в config.yaml нет раздела sources. Пошагово — docs/kak-zapustit.md, шаг 11.');
  }
  return { text: lines.join('\n'), ok };
}

/** Итог сбора одним текстом: что прочитано и что стоит поправить. */
export function renderSync(result: SyncResult, p: Paint = plain): string {
  const lines: string[] = [];
  const j = result.jira;
  if (j && 'error' in j) lines.push(`${p.bold('Jira')}  ${p.red('не прочитана')}: ${j.error}`, p.dim('  Прежний снимок, если он был, оставлен как есть.'));
  else if (j) {
    const r = j.report;
    lines.push(
      `${p.bold('Jira')}  ${p.green('снимок записан')} · переходов ${r.tasks}, задач ${r.issues}, людей ${r.people} · вход: ${AUTH[r.auth]}${r.version ? ` · версия ${r.version}` : ''}`,
    );
    for (const problem of r.problems) lines.push(`  ${p.yellow('!')} ${problem}`);
    if (r.unknown.length) lines.push(`  ${p.yellow('!')} исполнители, которых игра не узнала: ${r.unknown.join(', ')}`);
    if (r.unlinked.length) lines.push(p.dim(`  без логина Jira: ${r.unlinked.join(', ')} — их нагрузка не читается; логин вписывается в поле jira файла человека`));
  }
  const c = result.confluence;
  if (c && 'error' in c) lines.push(`${p.bold('Confluence')}  ${p.red('не прочитан')}: ${c.error}`, p.dim('  Прежний снимок, если он был, оставлен как есть.'));
  else if (c) {
    lines.push(`${p.bold('Confluence')}  ${p.green('снимок записан')} · страниц ${c.report.pages} · вход: ${AUTH[c.report.auth]}`);
    for (const problem of c.report.problems) lines.push(`  ${p.yellow('!')} ${problem}`);
  }
  lines.push('', p.dim('Что из этого следует: sv signals'));
  return lines.join('\n');
}

export const syncFailed = (r: SyncResult): boolean => [r.jira, r.confluence].some((x) => x && 'error' in x);

export async function syncCmd(options: RunOptions, p: Paint = plain): Promise<{ text: string; ok: boolean }> {
  const result = await runSync(options);
  return { text: renderSync(result, p), ok: !syncFailed(result) };
}
