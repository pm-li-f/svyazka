import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type FoundKey, type Keys, keysFile, parseKeys, readSecrets } from '@svyazka/core';

/**
 * Ключи поставщиков моделей. Живут вне репозитория и вне папки игры:
 * в переменных окружения или в файле ключей в домашней папке.
 * Значение ключа не печатается нигде: ни в выводе, ни в ошибках.
 */

/** В какой переменной лежит ключ каждого поставщика. */
export const KEY_VAR = {
  anthropic: 'ANTHROPIC_API_KEY',
  moonshotai: 'MOONSHOT_API_KEY',
  alibaba: 'DASHSCOPE_API_KEY',
} as const;
export type ProviderId = keyof typeof KEY_VAR;

export { keysFile, parseKeys, type FoundKey, type Keys };

/** Ключи из окружения и из файла. Переменная окружения важнее файла. */
export const readKeys = (env: NodeJS.ProcessEnv = process.env, file: string = keysFile(env)): Keys => readSecrets(Object.values(KEY_VAR), env, file);

const TEMPLATE = `# Ключи «Связки»: модели штурмана и вход в Jira и Confluence.
# Этот файл лежит только на твоей машине. Не клади его в репозиторий и в папку игры.
# Впиши ключ после знака «=», без кавычек и пробелов. Строки с пустым значением не учитываются.

# Claude: https://platform.claude.com → Settings → API keys
ANTHROPIC_API_KEY=

# Kimi: https://platform.kimi.ai → API Keys (международная площадка Moonshot)
MOONSHOT_API_KEY=

# Jira и Confluence: пользователь с правами только на чтение.
# Адреса серверов пишутся не сюда, а в config.yaml папки игры, в раздел sources.
JIRA_USER=
JIRA_PASSWORD=
CONFLUENCE_USER=
CONFLUENCE_PASSWORD=
`;

/** Создаёт файл ключей с шаблоном, если его ещё нет. Существующий файл не трогает. */
export function initKeysFile(file: string = keysFile()): { path: string; created: boolean } {
  if (existsSync(file)) return { path: file, created: false };
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, TEMPLATE, { mode: 0o600 });
  // На Windows права задаются иначе; там файл и так лежит в профиле пользователя.
  if (process.platform !== 'win32') chmodSync(file, 0o600);
  return { path: file, created: true };
}

/** Файл ключей могут читать другие пользователи машины. На Windows не проверяется. */
export function keysFileIsOpen(file: string = keysFile()): boolean {
  if (process.platform === 'win32' || !existsSync(file)) return false;
  return (statSync(file).mode & 0o077) !== 0;
}
