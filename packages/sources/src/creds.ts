import { type Keys, keysFile, readSecrets, type SourceName } from '@svyazka/core';

/**
 * Вход в источники. Логин и пароль лежат там же, где ключи моделей: в файле ключей
 * в домашней папке или в переменных окружения. В папку игры и в вывод они не попадают.
 */

/** В каких переменных лежит вход в каждый источник. */
export const CRED_VARS = {
  jira: { user: 'JIRA_USER', password: 'JIRA_PASSWORD', token: 'JIRA_TOKEN' },
  confluence: { user: 'CONFLUENCE_USER', password: 'CONFLUENCE_PASSWORD', token: 'CONFLUENCE_TOKEN' },
} as const;

export interface Creds {
  user?: string;
  password?: string;
  /** Персональный токен, если его когда-нибудь выдадут: он надёжнее пароля. */
  token?: string;
}

const ALL = Object.values(CRED_VARS).flatMap((v) => Object.values(v));

/** Что найдено для каждого источника. Значения наружу не печатаются. */
export function readCreds(env: NodeJS.ProcessEnv = process.env, file: string = keysFile(env)): Record<SourceName, Creds> {
  const keys: Keys = readSecrets(ALL, env, file);
  const pick = (source: SourceName): Creds => {
    const vars = CRED_VARS[source];
    const out: Creds = {};
    const user = keys[vars.user]?.value;
    const password = keys[vars.password]?.value;
    const token = keys[vars.token]?.value;
    if (user) out.user = user;
    if (password) out.password = password;
    if (token) out.token = token;
    return out;
  };
  return { jira: pick('jira'), confluence: pick('confluence') };
}

/** Хватает ли найденного, чтобы попробовать войти. */
export const hasCreds = (c: Creds): boolean => Boolean(c.token || (c.user && c.password));

/** Чего не хватает — именами переменных, без значений. */
export function missingCreds(source: SourceName, c: Creds): string[] {
  if (hasCreds(c)) return [];
  const vars = CRED_VARS[source];
  return [...(c.user ? [] : [vars.user]), ...(c.password ? [] : [vars.password])];
}
