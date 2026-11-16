import { loadGame, saveSnapshot, type SourceName } from '@svyazka/core';
import { type Creds, CRED_VARS, hasCreds, missingCreds, readCreds } from './creds.js';
import { type AuthMethod, connect, type ConnectOptions, SourceError } from './http.js';
import { serverVersion } from './jira.js';
import { type ConfluenceReport, type JiraReport, syncConfluence, syncJira } from './sync.js';

export interface RunOptions extends ConnectOptions {
  dir: string;
  today: string;
  /** Только эти источники. Без списка — все настроенные. */
  only?: SourceName[];
  /** Подмена для тестов: настоящий файл ключей тогда не читается. */
  creds?: Record<SourceName, Creds>;
}

export interface SyncResult {
  jira?: { report: JiraReport } | { error: string };
  confluence?: { report: ConfluenceReport } | { error: string };
}

const NAMES: SourceName[] = ['jira', 'confluence'];

/**
 * `sv sync`: читает настроенные источники и записывает снимки в папку игры.
 * Источник, который не ответил, не трогает прежний снимок: старые данные с датой
 * честнее пустого места.
 */
export async function runSync({ dir, today, only, creds = readCreds(), ...net }: RunOptions): Promise<SyncResult> {
  const game = loadGame(dir);
  const wanted = NAMES.filter((s) => (!only || only.includes(s)) && game.config.sources[s]);
  if (wanted.length === 0) {
    throw new SourceError('config', 'Источники не настроены: в config.yaml нет раздела sources с адресом Jira или Confluence. Как настроить — docs/kak-zapustit.md, шаг 11.');
  }
  const result: SyncResult = {};
  for (const source of wanted) {
    try {
      const config = game.config.sources[source];
      if (!config) continue;
      const found = creds[source];
      if (!hasCreds(found)) {
        throw new SourceError('no-creds', `${source === 'jira' ? 'Jira' : 'Confluence'}: в файле ключей нет ${missingCreds(source, found).join(' и ')}. Создать файл: sv keys init`);
      }
      const c = await connect(source, config, found, net);
      try {
        if (source === 'jira') {
          const { snapshot, report } = await syncJira(game, today, c);
          saveSnapshot(dir, 'jira', snapshot);
          result.jira = { report };
        } else {
          const { snapshot, report } = await syncConfluence(game, today, c);
          saveSnapshot(dir, 'confluence', snapshot);
          result.confluence = { report };
        }
      } finally {
        await c.close();
      }
    } catch (error) {
      if (!(error instanceof SourceError)) throw error;
      result[source] = { error: error.message };
    }
  }
  return result;
}

export interface CheckRow {
  source: SourceName;
  url: string | null;
  /** Каких переменных не хватает в файле ключей. */
  missing: string[];
  ok: boolean;
  user?: string;
  auth?: AuthMethod;
  version?: string | null;
  error?: string;
  warnings: string[];
}

/** `sv sources check`: пробует войти в каждый настроенный источник и говорит, что получилось. */
export async function checkSources({ dir, creds = readCreds(), ...net }: Omit<RunOptions, 'today'>): Promise<CheckRow[]> {
  const game = loadGame(dir);
  const rows: CheckRow[] = [];
  for (const source of NAMES) {
    const config = game.config.sources[source];
    const found = creds[source];
    const row: CheckRow = { source, url: config?.url ?? null, missing: config ? missingCreds(source, found) : [], ok: false, warnings: [] };
    rows.push(row);
    if (!config) continue;
    if (config.url.startsWith('http://')) row.warnings.push('адрес без https: логин и пароль идут по сети открытым текстом');
    if (row.missing.length) {
      row.error = `в файле ключей нет ${row.missing.join(' и ')}`;
      continue;
    }
    try {
      const c = await connect(source, config, found, net);
      try {
        row.ok = true;
        row.user = `${c.user.name} (${c.user.login})`;
        row.auth = c.auth;
        if (source === 'jira') row.version = await serverVersion(c);
        if (c.auth === 'session') row.warnings.push('логин и пароль в запросах сервер не принимает, вход идёт по сессии');
        if (c.auth !== 'token' && found.token === undefined) row.warnings.push(`вход по паролю; если когда-нибудь дадут токен, впиши его в ${CRED_VARS[source].token} — он надёжнее`);
      } finally {
        await c.close();
      }
    } catch (error) {
      if (!(error instanceof SourceError)) throw error;
      row.error = error.message;
    }
  }
  return rows;
}
