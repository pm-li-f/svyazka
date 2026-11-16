import type { ConfluenceSnapshot, Game, JiraSnapshot } from '@svyazka/core';
import { pageInfo, pageRef } from './confluence.js';
import { type AuthMethod, type Connection, SourceError } from './http.js';
import { linkedIssues, openLoad, serverVersion } from './jira.js';

/**
 * Сбор снимка: читает из источника то, на что в игре есть ссылки, и возвращает
 * снимок. В папку игры здесь ничего не пишется — это делает `runSync`.
 */

export interface JiraReport {
  user: string;
  auth: AuthMethod;
  version: string | null;
  /** Сколько переходов со ссылкой прочитано и сколько задач за ними. */
  tasks: number;
  issues: number;
  people: number;
  /** Исполнители из Jira, которых игра не узнала: у людей нет такого логина. */
  unknown: string[];
  /** Люди отряда без логина Jira. */
  unlinked: string[];
  /** Что не удалось прочитать, по переходам. */
  problems: string[];
}

export interface ConfluenceReport {
  user: string;
  auth: AuthMethod;
  pages: number;
  problems: string[];
}

/** Ошибки, после которых читать дальше бессмысленно: связь и вход. */
const fatal = (e: unknown): boolean =>
  !(e instanceof SourceError) || ['network', 'tls', 'timeout', 'redirect', 'unauthorized', 'captcha', 'basic-disabled', 'not-json', 'server', 'no-creds'].includes(e.kind);

export async function syncJira(game: Game, today: string, c: Connection): Promise<{ snapshot: JiraSnapshot; report: JiraReport }> {
  const config = game.config.sources.jira;
  if (!config) throw new SourceError('config', 'Jira не настроена: в config.yaml нет раздела sources.jira.');
  const snapshot: JiraSnapshot = { at: today, tasks: {}, people: {} };
  const problems: string[] = [];
  const version = await serverVersion(c);
  if (version) snapshot.server = version;

  for (const task of game.tasks) {
    if (!task.jira) continue;
    try {
      const found = await linkedIssues(c, task.jira, { blocksLink: config.blocks_link, limit: config.max_issues, today });
      snapshot.tasks[task.id] = found;
      if (found.total === 0) problems.push(`${task.id}: по ссылке ничего не найдено`);
      else if (found.total > found.issues.length) problems.push(`${task.id}: задач ${found.total}, прочитано ${found.issues.length} (порог max_issues)`);
    } catch (error) {
      if (fatal(error)) throw error;
      const message = (error as SourceError).message;
      snapshot.tasks[task.id] = { query: '', total: 0, issues: [], error: message };
      problems.push(`${task.id}: ${message}`);
    }
  }

  const actors = [...game.people, ...game.agents];
  const byLogin = new Map(actors.flatMap((a) => (a.jira ? [[a.jira, a.id] as const] : [])));
  for (const person of game.people) {
    if (!person.jira) continue;
    try {
      snapshot.people[person.id] = await openLoad(c, person.jira);
    } catch (error) {
      if (fatal(error)) throw error;
      problems.push(`${person.id}: ${(error as SourceError).message}`);
    }
  }

  const assignees = new Set(Object.values(snapshot.tasks).flatMap((t) => t.issues.flatMap((i) => (i.assignee ? [i.assignee] : []))));
  return {
    snapshot,
    report: {
      user: c.user.name,
      auth: c.auth,
      version,
      tasks: Object.keys(snapshot.tasks).length,
      issues: Object.values(snapshot.tasks).reduce((n, t) => n + t.issues.length, 0),
      people: Object.keys(snapshot.people).length,
      unknown: [...assignees].filter((login) => !byLogin.has(login)).sort(),
      unlinked: game.people.filter((p) => !p.jira).map((p) => p.id),
      problems,
    },
  };
}

export async function syncConfluence(game: Game, today: string, c: Connection): Promise<{ snapshot: ConfluenceSnapshot; report: ConfluenceReport }> {
  if (!game.config.sources.confluence) throw new SourceError('config', 'Confluence не настроен: в config.yaml нет раздела sources.confluence.');
  const snapshot: ConfluenceSnapshot = { at: today, pages: {} };
  const problems: string[] = [];
  for (const artifact of game.artifacts) {
    try {
      snapshot.pages[artifact.id] = await pageInfo(c, pageRef(artifact.confluence, c.base));
    } catch (error) {
      if (fatal(error)) throw error;
      const e = error as SourceError;
      const message = e.kind === 'not-found' || e.kind === 'forbidden' ? 'страница не найдена, или у пользователя нет к ней доступа' : e.message;
      snapshot.pages[artifact.id] = { error: message };
      problems.push(`${artifact.id}: ${message}`);
    }
  }
  return { snapshot, report: { user: c.user.name, auth: c.auth, pages: Object.values(snapshot.pages).filter((p) => !('error' in p)).length, problems } };
}
