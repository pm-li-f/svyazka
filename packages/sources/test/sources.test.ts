import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkSources, connect, linkJql, pageRef, quote, readCreds, runSync, SourceError } from '../src/index.js';
import { EXAMPLE_ISSUES, EXAMPLE_PAGES, type Fake, type FakeOptions, startFake } from './fake.js';

const example = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples/jira-pomnit-vse');
const TODAY = '2026-11-14';
const PASSWORD = 'correct horse';
const good = { user: 'svyazka-ro', password: PASSWORD };

let fake: Fake | undefined;
let temp: string | undefined;

async function server(options: FakeOptions = {}): Promise<Fake> {
  fake = await startFake({ issues: EXAMPLE_ISSUES, pages: EXAMPLE_PAGES, ...options });
  return fake;
}

/** Копия примера, в которой адреса источников ведут на подставной сервер. */
function gameAt(url: string): string {
  temp = mkdtempSync(join(tmpdir(), 'svyazka-src-'));
  cpSync(example, temp, { recursive: true });
  for (const file of ['config.yaml', 'team/artifacts.yaml']) {
    writeFileSync(join(temp, file), readFileSync(join(temp, file), 'utf8').replace(/https:\/\/(jira|wiki)\.example\.test/g, url));
  }
  return temp;
}

const failure = async (run: Promise<unknown>): Promise<SourceError> => {
  try {
    await run;
  } catch (e) {
    if (e instanceof SourceError) return e;
    throw e;
  }
  throw new Error('ожидалась ошибка источника');
};

afterEach(async () => {
  await fake?.close();
  fake = undefined;
  if (temp) rmSync(temp, { recursive: true, force: true });
  temp = undefined;
});

describe('вход', () => {
  it('логин и пароль в запросе, когда сервер их принимает', async () => {
    const f = await server();
    const c = await connect('jira', { url: f.url, auth: 'auto' }, good);
    expect(c.auth).toBe('basic');
    expect(c.user).toEqual({ login: 'svyazka-ro', name: 'Связка, только чтение' });
  });

  it('Jira 11: basic выключен — вход идёт по сессии, в конце сессия закрывается', async () => {
    const f = await server({ basic: false });
    const c = await connect('jira', { url: f.url + '/', auth: 'auto' }, good);
    expect(c.auth).toBe('session');
    expect(await c.get<{ version: string }>('/rest/api/2/serverInfo')).toMatchObject({ version: '11.0.1' });
    await c.close();
    expect(f.log.map((l) => `${l.method} ${l.path}`)).toEqual([
      'GET /rest/api/2/myself',
      'POST /rest/auth/1/session',
      'GET /rest/api/2/myself',
      'GET /rest/api/2/serverInfo',
      'DELETE /rest/auth/1/session',
    ]);
    // После выхода та же сессия уже не работает.
    expect((await failure(c.get('/rest/api/2/myself'))).kind).toBe('unauthorized');
  });

  it('basic выключен и сессии нет — объясняет, что просить у администратора', async () => {
    const f = await server({ basic: false, session: false });
    const e = await failure(connect('jira', { url: f.url, auth: 'auto' }, good));
    expect(e.message).toContain('Allow basic authentication on API calls');
    expect(e.message).toContain('Вход по сессии тоже не прошёл');
  });

  it('неверный пароль: одна попытка, без запасного входа', async () => {
    const f = await server();
    const e = await failure(connect('jira', { url: f.url, auth: 'auto' }, { user: 'svyazka-ro', password: 'wrong' }));
    expect(e.kind).toBe('unauthorized');
    expect(f.log).toHaveLength(1);
  });

  it('токен важнее пароля, если он есть', async () => {
    const f = await server({ token: 'pat-123', basic: false });
    const c = await connect('jira', { url: f.url, auth: 'auto' }, { ...good, token: 'pat-123' });
    expect(c.auth).toBe('token');
  });

  it('проверка «я не робот», единый вход и гость объясняются по-разному', async () => {
    let f = await server({ captcha: true });
    expect((await failure(connect('jira', { url: f.url, auth: 'auto' }, good))).kind).toBe('captcha');
    await f.close();

    f = await server({ sso: true });
    const sso = await failure(connect('jira', { url: f.url, auth: 'token' }, { token: 'x' }));
    expect(sso.kind).toBe('unauthorized');
    await f.close();

    f = await server();
    expect((await failure(connect('confluence', { url: f.url, auth: 'auto' }, {}))).kind).toBe('no-creds');
  });

  it('перенаправление на страницу входа не проходится молча', async () => {
    const f = await server({ sso: true, basic: false, session: false });
    // Запрос без всякого входа: так отвечает сервер за единым входом.
    const redirect: typeof fetch = (input, init) => fetch(input, { ...init, headers: { accept: 'application/json' } });
    const e = await failure(connect('jira', { url: f.url, auth: 'basic' }, good, { fetch: redirect }));
    expect(e.kind).toBe('redirect');
    expect(e.message).toContain('https://sso.example.test/login');
    // Параметры адреса в сообщение не попадают.
    expect(e.message).not.toContain('secret');
  });

  it('пароль не попадает ни в одно сообщение об ошибке', async () => {
    const cases: [FakeOptions, { user: string; password: string }][] = [
      [{}, { user: 'svyazka-ro', password: 'wrong-' + PASSWORD }],
      [{ basic: false, session: false }, good],
      [{ captcha: true }, good],
    ];
    for (const [options, creds] of cases) {
      const f = await server(options);
      const e = await failure(connect('jira', { url: f.url, auth: 'auto' }, creds));
      expect(e.message).not.toContain(creds.password);
      expect(e.message).not.toContain(Buffer.from(`${creds.user}:${creds.password}`).toString('base64'));
      await f.close();
    }
    const down = await failure(connect('jira', { url: 'http://127.0.0.1:9', auth: 'auto' }, good, { timeoutMs: 2000 }));
    expect(down.kind).toBe('network');
    expect(down.message).not.toContain(PASSWORD);
  });

  it('адрес с логином внутри и не тот протокол отклоняются до всякой сети', async () => {
    expect((await failure(connect('jira', { url: 'https://user:pass@jira.example.test', auth: 'auto' }, good))).kind).toBe('config');
    expect((await failure(connect('jira', { url: 'ftp://jira.example.test', auth: 'auto' }, good))).kind).toBe('config');
  });
});

describe('сбор снимка', () => {
  it('с подставного сервера получается тот же снимок, что лежит в примере', async () => {
    const f = await server();
    const dir = gameAt(f.url);
    rmSync(join(dir, 'team/sources'), { recursive: true });
    const result = await runSync({ dir, today: TODAY, creds: { jira: good, confluence: good } });
    expect(result.jira).toEqual({
      report: { user: 'Связка, только чтение', auth: 'basic', version: '11.0.1', tasks: 5, issues: 17, people: 5, unknown: ['d.contractor'], unlinked: [], problems: ['second-rope: по ссылке ничего не найдено'] },
    });
    expect(result.confluence).toMatchObject({ report: { pages: 4, problems: ['risk-register: страница не найдена, или у пользователя нет к ней доступа'] } });
    const written = (name: string, host: string) => readFileSync(join(dir, 'team/sources', `${name}.yaml`), 'utf8').replaceAll(f.url, `https://${host}.example.test`);
    // На Windows git может отдать файлы примера с переводом строки CRLF: сравниваем без него.
    const committed = (name: string) => readFileSync(join(example, 'team/sources', `${name}.yaml`), 'utf8').replace(/\r\n/g, '\n');
    expect(written('jira', 'jira')).toBe(committed('jira'));
    expect(written('confluence', 'wiki')).toBe(committed('confluence'));
  });

  it('только читает: кроме входа по сессии, на сервер уходит один GET', async () => {
    for (const options of [{}, { basic: false }]) {
      const f = await server(options);
      await runSync({ dir: gameAt(f.url), today: TODAY, creds: { jira: good, confluence: { ...good } }, only: ['jira'] });
      const other = f.log.filter((l) => l.method !== 'GET' && l.path !== '/rest/auth/1/session');
      expect(other).toEqual([]);
      expect(f.log.some((l) => l.path === '/rest/api/2/search')).toBe(true);
      await f.close();
      rmSync(temp as string, { recursive: true, force: true });
    }
  });

  it('источник, который не ответил, не стирает прежний снимок', async () => {
    const f = await server();
    const dir = gameAt(f.url);
    const before = readFileSync(join(dir, 'team/sources/jira.yaml'), 'utf8');
    const result = await runSync({ dir, today: '2026-11-20', creds: { jira: { user: 'svyazka-ro', password: 'wrong' }, confluence: good } });
    expect(result.jira).toMatchObject({ error: expect.stringContaining('логин или пароль не подошли') });
    expect(readFileSync(join(dir, 'team/sources/jira.yaml'), 'utf8')).toBe(before);
    // Второй источник при этом обновился.
    expect(readFileSync(join(dir, 'team/sources/confluence.yaml'), 'utf8')).toContain('at: 2026-11-20');
  });

  it('без поля «Epic Link» ищет без него', async () => {
    const f = await server({ epicLink: false });
    const dir = gameAt(f.url);
    await runSync({ dir, today: TODAY, creds: { jira: good, confluence: good }, only: ['jira'] });
    const text = readFileSync(join(dir, 'team/sources/jira.yaml'), 'utf8');
    expect(text).toContain('query: issuekey = PAY-10 OR parent = PAY-10 ORDER BY key ASC');
    expect(text).not.toContain('Epic Link');
  });

  it('длинный список читается страницами и обрезается по порогу', async () => {
    const many = Array.from({ length: 230 }, (_, n) => ({ key: `BIG-${n + 2}`, summary: `Задача ${n}`, status: 'To Do', category: 'new' as const, updated: '2026-11-01', epic: 'BIG-1' }));
    const f = await server({ issues: many });
    const dir = gameAt(f.url);
    const task = join(dir, 'team/tasks/billing-migration.md');
    writeFileSync(task, readFileSync(task, 'utf8').replace('jira: PAY-10', 'jira: BIG-1'));
    writeFileSync(join(dir, 'config.yaml'), readFileSync(join(dir, 'config.yaml'), 'utf8').replace('    wip_max: 3', '    wip_max: 3\n    max_issues: 150'));
    const result = await runSync({ dir, today: TODAY, creds: { jira: good, confluence: good }, only: ['jira'] });
    expect(result.jira).toMatchObject({ report: { problems: expect.arrayContaining(['billing-migration: задач 230, прочитано 150 (порог max_issues)']) } });
    expect(f.log.filter((l) => l.path === '/rest/api/2/search').length).toBeGreaterThan(6);
  });

  it('без настройки и без ключей говорит, чего не хватает', async () => {
    const demo = resolve(example, '../demo');
    const e = await failure(runSync({ dir: demo, today: TODAY, creds: { jira: good, confluence: good } }));
    expect(e.message).toContain('Источники не настроены');
    const f = await server();
    const result = await runSync({ dir: gameAt(f.url), today: TODAY, creds: { jira: {}, confluence: { user: 'x' } } });
    expect(result.jira).toEqual({ error: 'Jira: в файле ключей нет JIRA_USER и JIRA_PASSWORD. Создать файл: sv keys init' });
    expect(result.confluence).toEqual({ error: 'Confluence: в файле ключей нет CONFLUENCE_PASSWORD. Создать файл: sv keys init' });
    expect(f.log).toEqual([]);
  });
});

describe('проверка входа', () => {
  it('говорит, кто мы на сервере, каким способом вошли и о чём стоит знать', async () => {
    const f = await server({ basic: false });
    const rows = await checkSources({ dir: gameAt(f.url), creds: { jira: good, confluence: {} } });
    expect(rows[0]).toMatchObject({ source: 'jira', ok: true, auth: 'session', version: '11.0.1', user: 'Связка, только чтение (svyazka-ro)' });
    expect(rows[0]?.warnings.join(' ')).toContain('адрес без https');
    expect(rows[0]?.warnings.join(' ')).toContain('вход идёт по сессии');
    expect(rows[1]).toMatchObject({ source: 'confluence', ok: false, missing: ['CONFLUENCE_USER', 'CONFLUENCE_PASSWORD'] });
  });
});

describe('разбор ссылок и ключей', () => {
  it('JQL по ссылке перехода', () => {
    expect(linkJql('PAY-10')).toBe('issuekey = PAY-10 OR "Epic Link" = PAY-10 OR parent = PAY-10 ORDER BY key ASC');
    expect(linkJql(['PAY-10', 'OPS-7'])).toBe('issuekey in (PAY-10, OPS-7) OR "Epic Link" in (PAY-10, OPS-7) OR parent in (PAY-10, OPS-7) ORDER BY key ASC');
    expect(linkJql({ jql: 'project = DOC' })).toBe('project = DOC');
    expect(quote('o"hara\\x')).toBe('"o\\"hara\\\\x"');
  });

  it('страница Confluence: номер и три вида ссылок', () => {
    const base = 'https://wiki.example.test/confluence';
    expect(pageRef('1001', base)).toEqual({ id: '1001' });
    expect(pageRef(`${base}/pages/viewpage.action?pageId=1002`, base)).toEqual({ id: '1002' });
    expect(pageRef(`${base}/spaces/PROD/pages/1003/Roadmap`, base)).toEqual({ id: '1003' });
    expect(pageRef(`${base}/display/PROD/%D0%A6%D0%B5%D0%BB%D0%B8+Q4`, base)).toEqual({ space: 'PROD', title: 'Цели Q4' });
    expect(() => pageRef('https://other.example.test/pages/viewpage.action?pageId=1', base)).toThrow(/ведёт на/);
    expect(() => pageRef(`${base}/x/AbCd`, base)).toThrow(/pageId/);
  });

  it('вход читается из файла ключей и окружения, чужие имена не берутся', () => {
    temp = mkdtempSync(join(tmpdir(), 'svyazka-keys-'));
    const file = join(temp, 'keys.env');
    writeFileSync(file, 'JIRA_USER=reader\nJIRA_PASSWORD="p w"\nCONFLUENCE_USER=\nANTHROPIC_API_KEY=sk-x\n');
    expect(readCreds({ CONFLUENCE_TOKEN: 'tok', PATH: '/bin' }, file)).toEqual({ jira: { user: 'reader', password: 'p w' }, confluence: { token: 'tok' } });
    expect(existsSync(file)).toBe(true);
  });
});
