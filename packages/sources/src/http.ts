import type { SourceName } from '@svyazka/core';
import { CRED_VARS, type Creds } from './creds.js';

/**
 * Соединение с сервером Atlassian. Только чтение: данные запрашиваются одним
 * методом GET. Единственное исключение — вход и выход по сессии, это не запись
 * в данные. Логин и пароль не попадают ни в ошибки, ни в журнал.
 */

export type AuthMethod = 'token' | 'basic' | 'session';
export type AuthSetting = 'auto' | AuthMethod;

export type ErrorKind =
  | 'config'
  | 'no-creds'
  | 'network'
  | 'tls'
  | 'timeout'
  | 'redirect'
  | 'basic-disabled'
  | 'unauthorized'
  | 'captcha'
  | 'forbidden'
  | 'not-found'
  | 'bad-query'
  | 'server'
  | 'not-json';

/** Ошибка источника с текстом для человека. */
export class SourceError extends Error {
  constructor(
    public readonly kind: ErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}

const TITLE = { jira: 'Jira', confluence: 'Confluence' } as const;

export interface ConnectOptions {
  /** Подмена для тестов. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface Connection {
  source: SourceName;
  /** Адрес сервера без косой черты на конце. */
  base: string;
  /** Каким способом удалось войти. */
  auth: AuthMethod;
  /** Кто мы на сервере. */
  user: { login: string; name: string };
  /** Запрос данных. Других методов у соединения нет. */
  get<T = unknown>(path: string, query?: Record<string, string | number>): Promise<T>;
  /** Закрывает сессию, если вход был по сессии. */
  close(): Promise<void>;
}

const WHOAMI = { jira: '/rest/api/2/myself', confluence: '/rest/api/user/current' } as const;

interface Raw {
  status: number;
  headers: Headers;
  text: string;
}

/** Разбирает адрес из настроек: без логина в адресе и без хвостовой косой черты. */
export function baseUrl(source: SourceName, url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SourceError('config', `${TITLE[source]}: адрес «${url}» в config.yaml не разобрать. Нужен вид https://jira.example.com`);
  }
  if (parsed.username || parsed.password) {
    throw new SourceError('config', `${TITLE[source]}: логин и пароль в адрес не пишем. Их место — файл ключей.`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new SourceError('config', `${TITLE[source]}: адрес должен начинаться с https:// или http://`);
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

function networkError(source: SourceName, base: string, error: unknown): SourceError {
  const e = error as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = e?.cause?.code ?? '';
  const text = `${e?.message ?? ''} ${code} ${e?.cause?.message ?? ''}`;
  const who = `${TITLE[source]} (${base})`;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || /ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|timeout/i.test(text)) {
    return new SourceError('timeout', `${who}: сервер не ответил вовремя. Проверь, что ты в рабочей сети или в VPN.`);
  }
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|ALTNAME/i.test(text)) {
    return new SourceError(
      'tls',
      `${who}: сертификат сервера не прошёл проверку. Так бывает со своим корпоративным сертификатом. ` +
        'Укажи корневой сертификат компании переменной NODE_EXTRA_CA_CERTS=путь/к/ca.pem. Проверку сертификата игра не отключает.',
    );
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(text)) return new SourceError('network', `${who}: адрес не найден. Проверь его в config.yaml и подключение к рабочей сети или VPN.`);
  return new SourceError('network', `${who}: нет связи с сервером. Проверь рабочую сеть или VPN.`);
}

/** Превращает ответ сервера в объяснение для человека. */
function httpError(source: SourceName, base: string, method: AuthMethod | 'none', res: Raw): SourceError {
  const who = `${TITLE[source]} (${base})`;
  const vars = CRED_VARS[source];
  const denied = `${res.headers.get('x-authentication-denied-reason') ?? ''} ${res.headers.get('x-seraph-loginreason') ?? ''}`;
  if (/Basic Authentication has been disabled/i.test(res.text)) {
    return new SourceError(
      'basic-disabled',
      `${who}: вход в API по логину и паролю на сервере выключен. Попроси администратора включить его для этого пользователя: ` +
        'в администрировании сервера, раздел Authentication methods → Allow basic authentication on API calls (можно разрешить только одному пользователю).',
    );
  }
  if (/CAPTCHA/i.test(denied)) {
    return new SourceError(
      'captcha',
      `${who}: после неудачных попыток сервер требует проверку «я не робот». Войди этим пользователем через браузер, пройди проверку и повтори.`,
    );
  }
  if (res.status >= 300 && res.status < 400) {
    return new SourceError(
      'redirect',
      `${who}: сервер перенаправляет на другую страницу (${res.headers.get('location')?.split('?')[0] ?? 'адрес не указан'}). ` +
        'Обычно это единый вход (SSO) или неточный адрес в config.yaml. При SSO логин и пароль в API не работают: нужен токен или разрешение администратора.',
    );
  }
  if (res.status === 401) {
    if (method === 'token') return new SourceError('unauthorized', `${who}: токен ${vars.token} не подошёл.`);
    return new SourceError(
      'unauthorized',
      `${who}: логин или пароль не подошли (${vars.user}, ${vars.password}). Проверь их в файле ключей. Не повторяй много раз подряд: сервер включит проверку «я не робот».`,
    );
  }
  if (res.status === 403) return new SourceError('forbidden', `${who}: сервер отказал в доступе (403). У пользователя нет прав на эти данные.`);
  if (res.status === 404) return new SourceError('not-found', `${who}: сервер не знает такого адреса (404).`);
  if (res.status === 400) {
    let detail = '';
    try {
      const body = JSON.parse(res.text) as { errorMessages?: string[]; message?: string };
      detail = (body.errorMessages ?? []).join(' ') || body.message || '';
    } catch {
      /* не JSON */
    }
    return new SourceError('bad-query', `${who}: сервер не принял запрос. ${detail}`.trim().slice(0, 400));
  }
  if (res.status === 429) return new SourceError('server', `${who}: сервер просит подождать (429). Попробуй позже.`);
  if (res.status >= 500) return new SourceError('server', `${who}: на сервере сбой (${res.status}). Попробуй позже.`);
  return new SourceError('server', `${who}: неожиданный ответ сервера (${res.status}).`);
}

/**
 * Входит на сервер и возвращает соединение.
 *
 * Порядок для `auto`: токен, если он есть; иначе логин и пароль в каждом запросе
 * (basic); если сервер Jira отвечает, что basic выключен, — вход по сессии.
 * При неверном пароле второй попытки нет: лишние неудачные входы включают
 * на сервере проверку «я не робот».
 */
export async function connect(
  source: SourceName,
  config: { url: string; auth: AuthSetting },
  creds: Creds,
  { fetch: doFetch = fetch, timeoutMs = 30_000 }: ConnectOptions = {},
): Promise<Connection> {
  const base = baseUrl(source, config.url);
  const vars = CRED_VARS[source];
  const password = creds.user && creds.password ? { user: creds.user, password: creds.password } : null;

  const call = async (method: 'GET' | 'POST' | 'DELETE', path: string, headers: Record<string, string>, body?: string): Promise<Raw> => {
    try {
      const res = await doFetch(base + path, {
        method,
        headers: { accept: 'application/json', ...headers },
        ...(body === undefined ? {} : { body }),
        // Перенаправление на страницу входа — это ответ, который надо объяснить, а не молча пройти.
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { status: res.status, headers: res.headers, text: await res.text() };
    } catch (error) {
      throw networkError(source, base, error);
    }
  };

  const parse = <T>(res: Raw): T => {
    try {
      return JSON.parse(res.text) as T;
    } catch {
      throw new SourceError(
        'not-json',
        `${TITLE[source]} (${base}): сервер ответил не данными, а страницей. Обычно это страница входа (SSO) или неточный адрес в config.yaml.`,
      );
    }
  };

  const open = async (auth: AuthMethod): Promise<Connection> => {
    let headers: Record<string, string>;
    let close = async (): Promise<void> => {};
    if (auth === 'token') {
      if (!creds.token) throw new SourceError('no-creds', `${TITLE[source]}: нет токена ${vars.token} в файле ключей.`);
      headers = { authorization: `Bearer ${creds.token}` };
    } else {
      if (!password) throw new SourceError('no-creds', `${TITLE[source]}: нет логина и пароля. Впиши ${vars.user} и ${vars.password} в файл ключей: sv keys init`);
      if (auth === 'basic') {
        headers = { authorization: `Basic ${Buffer.from(`${password.user}:${password.password}`, 'utf8').toString('base64')}` };
      } else {
        if (source !== 'jira') throw new SourceError('config', 'Вход по сессии есть только у Jira. Для Confluence укажи auth: basic или token.');
        const login = await call('POST', '/rest/auth/1/session', { 'content-type': 'application/json' }, JSON.stringify({ username: password.user, password: password.password }));
        if (login.status !== 200) throw httpError(source, base, 'session', login);
        const session = parse<{ session?: { name?: string; value?: string } }>(login).session;
        const cookies = new Map<string, string>();
        for (const line of login.headers.getSetCookie?.() ?? []) {
          const pair = line.split(';')[0] ?? '';
          const eq = pair.indexOf('=');
          if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
        }
        if (session?.name && session.value) cookies.set(session.name, session.value);
        if (cookies.size === 0) throw new SourceError('server', `${TITLE[source]} (${base}): сервер принял логин, но не выдал сессию.`);
        headers = { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
        close = async () => {
          // Выход — вежливость перед сервером: если не удался, сессия истечёт сама.
          await call('DELETE', '/rest/auth/1/session', headers).catch(() => undefined);
        };
      }
    }

    const get = async <T>(path: string, query: Record<string, string | number> = {}): Promise<T> => {
      const search = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString();
      const res = await call('GET', search ? `${path}?${search}` : path, headers);
      if (res.status !== 200) throw httpError(source, base, auth, res);
      return parse<T>(res);
    };

    try {
      const me = await get<{ name?: string; key?: string; username?: string; displayName?: string; type?: string }>(WHOAMI[source]);
      const login = me.name ?? me.username ?? me.key ?? '';
      if (!login || me.type === 'anonymous') {
        throw new SourceError('unauthorized', `${TITLE[source]} (${base}): сервер не узнал пользователя и отвечает как гостю. Проверь логин и пароль в файле ключей.`);
      }
      return { source, base, auth, user: { login, name: me.displayName ?? login }, get, close };
    } catch (error) {
      await close();
      throw error;
    }
  };

  if (config.auth !== 'auto') return open(config.auth);
  if (creds.token) return open('token');
  try {
    return await open('basic');
  } catch (error) {
    // Запасной путь — только когда сервер прямо сказал, что basic выключен.
    if (source === 'jira' && error instanceof SourceError && error.kind === 'basic-disabled') {
      try {
        return await open('session');
      } catch (second) {
        if (second instanceof SourceError && second.kind !== 'network' && second.kind !== 'timeout') {
          throw new SourceError(second.kind, `${error.message} Вход по сессии тоже не прошёл: ${second.message}`);
        }
        throw second;
      }
    }
    throw error;
  }
}
