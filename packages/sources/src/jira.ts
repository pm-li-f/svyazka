import type { JiraIssue, JiraLink } from '@svyazka/core';
import { type Connection, SourceError } from './http.js';

/** Jira Data Center, REST API v2. Только поиск и чтение. */

const FIELDS = 'summary,status,issuetype,assignee,updated,duedate,issuelinks';
const PAGE = 100;

interface RawStatus {
  name?: string;
  statusCategory?: { key?: string };
}
interface RawIssue {
  key: string;
  fields?: {
    summary?: string;
    issuetype?: { name?: string };
    status?: RawStatus;
    assignee?: { name?: string; key?: string } | null;
    updated?: string;
    duedate?: string | null;
    issuelinks?: { type?: { name?: string; inward?: string }; inwardIssue?: { key?: string; fields?: { status?: RawStatus } } }[];
  };
}

/** Строка JQL в кавычках. */
export const quote = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * Запрос, который находит всё, что стоит за ссылкой перехода: саму задачу или эпик,
 * задачи эпика и подзадачи. Свой JQL берётся как есть.
 */
export function linkJql(link: JiraLink, withEpics = true): string {
  if (typeof link === 'object' && !Array.isArray(link)) return link.jql;
  const keys = Array.isArray(link) ? link : [link];
  const cond = (field: string) => (keys.length === 1 ? `${field} = ${keys[0]}` : `${field} in (${keys.join(', ')})`);
  return [cond('issuekey'), ...(withEpics ? [cond('"Epic Link"')] : []), cond('parent')].join(' OR ') + ' ORDER BY key ASC';
}

/** Ключи, на которые ссылка указывает прямо. У своего JQL таких нет. */
export const linkKeys = (link: JiraLink): string[] => (typeof link === 'string' ? [link] : Array.isArray(link) ? link : []);

const category = (status?: RawStatus): JiraIssue['category'] => {
  const key = status?.statusCategory?.key;
  return key === 'done' ? 'done' : key === 'indeterminate' ? 'indeterminate' : 'new';
};

/** Дата без времени — так, как её показывает сервер. */
const day = (stamp: string | null | undefined): string | null => (stamp && /^\d{4}-\d{2}-\d{2}/.test(stamp) ? stamp.slice(0, 10) : null);

export function toIssue(raw: RawIssue, blocksLink: string, today: string): JiraIssue {
  const f = raw.fields ?? {};
  const blockedBy = (f.issuelinks ?? [])
    .filter((l) => l.inwardIssue?.key && (l.type?.name === blocksLink || /blocked by/i.test(l.type?.inward ?? '')))
    .filter((l) => category(l.inwardIssue?.fields?.status) !== 'done')
    .map((l) => l.inwardIssue?.key as string)
    .filter((key) => /^[A-Z][A-Z0-9_]*-\d+$/.test(key));
  return {
    key: raw.key,
    summary: f.summary ?? '',
    type: f.issuetype?.name ?? '',
    status: f.status?.name ?? '',
    category: category(f.status),
    assignee: f.assignee?.name ?? f.assignee?.key ?? null,
    updated: day(f.updated) ?? today,
    due: day(f.duedate),
    blocked_by: [...new Set(blockedBy)].sort(),
  };
}

/** Поиск по JQL с листанием страниц. Возвращает не больше `limit` задач и общее число найденных. */
export async function search(c: Connection, jql: string, fields: string, limit: number): Promise<{ issues: RawIssue[]; total: number }> {
  const issues: RawIssue[] = [];
  let total = 0;
  while (issues.length < limit) {
    const page = await c.get<{ total?: number; issues?: RawIssue[] }>('/rest/api/2/search', {
      jql,
      fields,
      startAt: issues.length,
      maxResults: Math.min(PAGE, limit - issues.length),
    });
    const got = page.issues ?? [];
    total = page.total ?? issues.length + got.length;
    issues.push(...got);
    if (got.length === 0 || issues.length >= total) break;
  }
  return { issues, total };
}

/** Задачи, которые стоят за ссылкой перехода. */
export async function linkedIssues(
  c: Connection,
  link: JiraLink,
  { blocksLink, limit, today }: { blocksLink: string; limit: number; today: string },
): Promise<{ query: string; total: number; issues: JiraIssue[] }> {
  let query = linkJql(link);
  let found: Awaited<ReturnType<typeof search>>;
  try {
    found = await search(c, query, FIELDS, limit);
  } catch (error) {
    // Поля «Epic Link» нет, если на сервере только Jira Core: ищем без него.
    if (!(error instanceof SourceError) || error.kind !== 'bad-query' || !/Epic Link/i.test(error.message) || linkKeys(link).length === 0) throw error;
    query = linkJql(link, false);
    found = await search(c, query, FIELDS, limit);
  }
  return { query, total: found.total, issues: found.issues.map((raw) => toIssue(raw, blocksLink, today)) };
}

/** Незакрытые задачи человека во всей Jira: сколько в работе и сколько всего. */
export async function openLoad(c: Connection, login: string): Promise<{ in_progress: number; open: number }> {
  const { issues, total } = await search(c, `assignee = ${quote(login)} AND resolution = Unresolved`, 'status', 500);
  const open = issues.filter((i) => category(i.fields?.status) !== 'done');
  return {
    in_progress: open.filter((i) => category(i.fields?.status) === 'indeterminate').length,
    // Если задач больше, чем прочитано, общее число берём у сервера.
    open: Math.max(open.length, total - (issues.length - open.length)),
  };
}

export async function serverVersion(c: Connection): Promise<string | null> {
  try {
    return (await c.get<{ version?: string }>('/rest/api/2/serverInfo')).version ?? null;
  } catch (error) {
    if (error instanceof SourceError && (error.kind === 'forbidden' || error.kind === 'not-found')) return null;
    throw error;
  }
}
