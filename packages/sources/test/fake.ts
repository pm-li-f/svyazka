import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Подставной сервер Atlassian для тестов: Jira (REST API v2) и Confluence (REST API)
 * на одном адресе. Отвечает так, как описано в документации Jira Data Center и
 * Confluence Data Center, в том объёме, который нужен игре. Настоящих серверов
 * он не заменяет: поведение входа на живой Jira 11 проверяется только на ней.
 */

export interface FakeIssue {
  key: string;
  summary: string;
  type?: string;
  status: string;
  category: 'new' | 'indeterminate' | 'done';
  assignee?: string | null;
  updated: string;
  due?: string | null;
  epic?: string;
  parent?: string;
  blockedBy?: string[];
}

export interface FakePage {
  id: string;
  title: string;
  space: string;
  updated: string;
  by: string;
  version?: number;
}

export interface FakeOptions {
  user?: string;
  password?: string;
  token?: string;
  /** Принимает ли сервер логин и пароль в запросах к API. В Jira 11 с начала — нет. */
  basic?: boolean;
  /** Работает ли вход по сессии. */
  session?: boolean;
  /** Сервер требует проверку «я не робот». */
  captcha?: boolean;
  /** Единый вход: всё, что без входа, уходит на страницу SSO. */
  sso?: boolean;
  /** Есть ли поле «Epic Link» (Jira Software). */
  epicLink?: boolean;
  issues?: FakeIssue[];
  pages?: FakePage[];
  version?: string;
}

export interface Fake {
  url: string;
  /** Все запросы, которые пришли: метод и путь без параметров. */
  log: { method: string; path: string }[];
  options: FakeOptions;
  close(): Promise<void>;
}

const NAMES: Record<string, string> = {};

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json;charset=UTF-8', ...headers });
  res.end(JSON.stringify(body));
}

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** Разбирает тот JQL, который пишет игра, и простое `project = X`. */
function matcher(jql: string, o: FakeOptions): ((i: FakeIssue) => boolean) | string {
  const text = jql.replace(/\s+ORDER BY .*$/i, '').trim();
  const person = /^assignee = "((?:[^"\\]|\\.)*)" AND resolution = Unresolved$/.exec(text);
  if (person) {
    const login = (person[1] as string).replace(/\\(.)/g, '$1');
    return (i) => i.assignee === login && i.category !== 'done';
  }
  const project = /^project = ([A-Z][A-Z0-9_]*)$/.exec(text);
  if (project) return (i) => i.key.startsWith(`${project[1]}-`);
  const tests: ((i: FakeIssue) => boolean)[] = [];
  for (const clause of text.split(/\s+OR\s+/)) {
    const m = /^(issuekey|"Epic Link"|parent) (?:= ([A-Z][A-Z0-9_]*-\d+)|in \(([^)]+)\))$/.exec(clause.trim());
    if (!m) return `Error in the JQL Query: '${clause}' is not valid.`;
    const keys = m[2] ? [m[2]] : (m[3] as string).split(',').map((k) => k.trim());
    if (m[1] === '"Epic Link"') {
      if (o.epicLink === false) return "Field 'Epic Link' does not exist or you do not have permission to view it.";
      tests.push((i) => i.epic !== undefined && keys.includes(i.epic));
    } else if (m[1] === 'parent') tests.push((i) => i.parent !== undefined && keys.includes(i.parent));
    else tests.push((i) => keys.includes(i.key));
  }
  return (i) => tests.some((t) => t(i));
}

const status = (i: FakeIssue) => ({ name: i.status, statusCategory: { key: i.category } });

function issueJson(i: FakeIssue, all: FakeIssue[], fields: string[]) {
  const full: Record<string, unknown> = {
    summary: i.summary,
    issuetype: { name: i.type ?? 'Story' },
    status: status(i),
    assignee: i.assignee ? { name: i.assignee, key: i.assignee, displayName: NAMES[i.assignee] ?? i.assignee } : null,
    updated: `${i.updated}T10:15:00.000+0300`,
    duedate: i.due ?? null,
    issuelinks: (i.blockedBy ?? []).map((key) => {
      const other = all.find((x) => x.key === key);
      return { type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, inwardIssue: { key, fields: { status: other ? status(other) : { name: 'Open', statusCategory: { key: 'new' } } } } };
    }),
  };
  return { key: i.key, fields: Object.fromEntries(Object.entries(full).filter(([k]) => fields.length === 0 || fields.includes(k))) };
}

export async function startFake(options: FakeOptions = {}): Promise<Fake> {
  const o: FakeOptions = { user: 'svyazka-ro', password: 'correct horse', basic: true, session: true, epicLink: true, issues: [], pages: [], version: '11.0.1', ...options };
  const log: Fake['log'] = [];
  const sessions = new Set<string>();

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://fake');
      const path = url.pathname;
      log.push({ method: req.method ?? '', path });
      const route = `${req.method} ${path}`;

      // ---- вход и выход по сессии
      if (route === 'POST /rest/auth/1/session') {
        if (o.captcha) return json(res, 403, { errorMessages: ['Login denied'] }, { 'x-authentication-denied-reason': 'CAPTCHA_CHALLENGE; login-url=http://fake/login.jsp' });
        if (!o.session) return json(res, 404, { message: 'null for uri' });
        let data: { username?: string; password?: string } = {};
        try {
          data = JSON.parse(await body(req)) as typeof data;
        } catch {
          /* ниже */
        }
        if (data.username !== o.user || data.password !== o.password) return json(res, 401, { errorMessages: ['Login failed'] }, { 'x-seraph-loginreason': 'AUTHENTICATED_FAILED' });
        const id = `S${sessions.size + 1}X${Math.abs(path.length * 7919 + sessions.size)}`;
        sessions.add(id);
        return json(res, 200, { session: { name: 'JSESSIONID', value: id }, loginInfo: { loginCount: 1 } }, { 'set-cookie': [`JSESSIONID=${id}; Path=/; HttpOnly`, 'atlassian.xsrf.token=x1; Path=/'] });
      }
      if (route === 'DELETE /rest/auth/1/session') {
        const id = /JSESSIONID=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
        if (id) sessions.delete(id);
        res.writeHead(204).end();
        return;
      }
      if (req.method !== 'GET') return json(res, 405, { message: 'Сервер для тестов принимает только чтение.' });

      // ---- кто пришёл
      const auth = req.headers.authorization ?? '';
      const cookie = /JSESSIONID=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
      let known = false;
      if (auth.startsWith('Bearer ')) {
        if (!o.token || auth.slice(7) !== o.token) return json(res, 401, { message: 'Client must be authenticated to access this resource.' });
        known = true;
      } else if (auth.startsWith('Basic ')) {
        if (o.captcha) return json(res, 403, {}, { 'x-authentication-denied-reason': 'CAPTCHA_CHALLENGE; login-url=http://fake/login.jsp' });
        if (!o.basic) return json(res, 403, { message: 'Basic Authentication has been disabled on this instance.' });
        if (Buffer.from(auth.slice(6), 'base64').toString('utf8') !== `${o.user}:${o.password}`) {
          return json(res, 401, { errorMessages: ['Login failed'] }, { 'x-seraph-loginreason': 'AUTHENTICATED_FAILED' });
        }
        known = true;
      } else if (cookie && sessions.has(cookie)) known = true;
      if (!known) {
        if (o.sso) {
          res.writeHead(302, { location: 'https://sso.example.test/login?return=secret' }).end();
          return;
        }
        if (path === '/rest/api/user/current') return json(res, 200, { type: 'anonymous', username: 'anonymous', displayName: 'Anonymous' });
        return json(res, 401, { message: 'Client must be authenticated to access this resource.' });
      }

      // ---- Jira
      if (path === '/rest/api/2/myself') return json(res, 200, { name: o.user, key: 'JIRAUSER10100', displayName: 'Связка, только чтение', active: true });
      if (path === '/rest/api/2/serverInfo') return json(res, 200, { baseUrl: 'http://fake', version: o.version, deploymentType: 'Server' });
      if (path === '/rest/api/2/search') {
        const test = matcher(url.searchParams.get('jql') ?? '', o);
        if (typeof test === 'string') return json(res, 400, { errorMessages: [test], errors: {} });
        const all = o.issues ?? [];
        const found = all.filter(test).sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
        const startAt = Number(url.searchParams.get('startAt') ?? 0);
        const maxResults = Math.min(Number(url.searchParams.get('maxResults') ?? 50), 100);
        const fields = (url.searchParams.get('fields') ?? '').split(',').filter(Boolean);
        return json(res, 200, { startAt, maxResults, total: found.length, issues: found.slice(startAt, startAt + maxResults).map((i) => issueJson(i, all, fields)) });
      }

      // ---- Confluence
      const pageJson = (p: FakePage) => ({
        id: p.id,
        type: 'page',
        title: p.title,
        space: { key: p.space, name: p.space },
        version: { number: p.version ?? 3, when: `${p.updated}T09:30:00.000+03:00`, by: { type: 'known', username: 'someone', displayName: p.by } },
        _links: { webui: `/pages/viewpage.action?pageId=${p.id}`, base: 'http://fake' },
      });
      if (path === '/rest/api/user/current') return json(res, 200, { type: 'known', username: o.user, displayName: 'Связка, только чтение' });
      const byId = /^\/rest\/api\/content\/(\d+)$/.exec(path);
      if (byId) {
        const page = (o.pages ?? []).find((p) => p.id === byId[1]);
        return page ? json(res, 200, pageJson(page)) : json(res, 404, { statusCode: 404, message: `No content found with id: ContentId{id=${byId[1]}}` });
      }
      if (path === '/rest/api/content') {
        const found = (o.pages ?? []).filter((p) => p.space === url.searchParams.get('spaceKey') && p.title === url.searchParams.get('title'));
        return json(res, 200, { results: found.map(pageJson), start: 0, limit: 1, size: found.length });
      }
      return json(res, 404, { message: 'null for uri: ' + path });
    })().catch((error: unknown) => json(res, 500, { message: String(error) }));
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, log, options: o, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** Данные примера `examples/jira-pomnit-vse`: по ним собран его снимок. */
export const EXAMPLE_ISSUES: FakeIssue[] = [
  { key: 'PAY-10', type: 'Epic', summary: 'Миграция биллинга на новую схему', status: 'In Progress', category: 'indeterminate', assignee: 'a.sokolova', updated: '2026-11-13' },
  { key: 'PAY-11', summary: 'Схема новых таблиц', status: 'Done', category: 'done', assignee: 'm.levin', updated: '2026-10-24', epic: 'PAY-10' },
  { key: 'PAY-12', summary: 'Двойная запись платежей', status: 'Done', category: 'done', assignee: 'm.levin', updated: '2026-10-30', epic: 'PAY-10' },
  { key: 'PAY-13', summary: 'Сверка старой и новой схемы', status: 'Done', category: 'done', assignee: 'm.levin', updated: '2026-11-05', epic: 'PAY-10' },
  { key: 'PAY-14', summary: 'Перенос истории подписок', status: 'In Progress', category: 'indeterminate', assignee: 'm.levin', updated: '2026-11-02', epic: 'PAY-10' },
  { key: 'PAY-15', summary: 'Переключение чтения на новую схему', status: 'In Progress', category: 'indeterminate', assignee: 'm.levin', updated: '2026-11-13', epic: 'PAY-10' },
  { key: 'PAY-16', summary: 'Отчёты для бухгалтерии', status: 'In Review', category: 'indeterminate', assignee: 'e.orlova', updated: '2026-11-12', epic: 'PAY-10' },
  { key: 'PAY-17', summary: 'План отката', status: 'To Do', category: 'new', assignee: null, updated: '2026-10-28', due: '2026-11-10', epic: 'PAY-10' },
  { key: 'PAY-18', summary: 'Отключить старую схему', status: 'To Do', category: 'new', assignee: 'm.levin', updated: '2026-11-06', epic: 'PAY-10', blockedBy: ['OPS-7'] },
  { key: 'PAY-19', summary: 'Проверка внешним подрядчиком', status: 'To Do', category: 'new', assignee: 'd.contractor', updated: '2026-11-11', epic: 'PAY-10' },
  { key: 'OPS-7', type: 'Bug', summary: 'Очередь задач деградирует под нагрузкой', status: 'In Progress', category: 'indeterminate', assignee: 't.aliev', updated: '2026-11-14' },
  { key: 'DOC-1', type: 'Task', summary: 'Черновик правил ревью', status: 'Done', category: 'done', assignee: 'e.orlova', updated: '2026-11-06' },
  { key: 'DOC-2', type: 'Task', summary: 'Собрать возражения', status: 'Done', category: 'done', assignee: 'e.orlova', updated: '2026-11-10' },
  { key: 'DOC-3', type: 'Task', summary: 'Опубликовать правила', status: 'Done', category: 'done', assignee: 'a.sokolova', updated: '2026-11-12' },
  { key: 'ONB-1', type: 'Epic', summary: 'Онбординг v2', status: 'In Progress', category: 'indeterminate', assignee: 'e.orlova', updated: '2026-11-12' },
  { key: 'ONB-2', summary: 'Прототип короткого пути', status: 'In Progress', category: 'indeterminate', assignee: 'e.orlova', updated: '2026-11-13', epic: 'ONB-1' },
  { key: 'ONB-3', summary: 'Замер конверсии', status: 'To Do', category: 'new', assignee: 'e.orlova', updated: '2026-11-09', epic: 'ONB-1' },
  { key: 'LEG-1', type: 'Task', summary: 'Старый экспорт для партнёра', status: 'In Progress', category: 'indeterminate', assignee: 'm.levin', updated: '2026-11-08' },
  { key: 'LEG-2', type: 'Bug', summary: 'Расхождение округления', status: 'In Progress', category: 'indeterminate', assignee: 'm.levin', updated: '2026-11-11' },
];

export const EXAMPLE_PAGES: FakePage[] = [
  { id: '1001', title: 'Устав и видение', space: 'PROD', updated: '2026-08-20', by: 'Ты', version: 7 },
  { id: '1002', title: 'Цели на квартал', space: 'PROD', updated: '2026-09-28', by: 'Ты', version: 4 },
  { id: '1003', title: 'Роадмап', space: 'PROD', updated: '2026-11-10', by: 'Аня', version: 21 },
  { id: '1004', title: 'Postmortems', space: 'ENG', updated: '2026-11-13', by: 'Тимур', version: 12 },
];
