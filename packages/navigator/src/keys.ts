import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

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

export interface FoundKey {
  value: string;
  source: 'env' | 'file';
}
export type Keys = Partial<Record<string, FoundKey>>;

/** Файл ключей: `~/.svyazka/keys.env`. Переменная `SVYAZKA_KEYS` задаёт другой путь. */
export const keysFile = (env: NodeJS.ProcessEnv = process.env): string => env['SVYAZKA_KEYS'] || join(homedir(), '.svyazka', 'keys.env');

/** Разбирает строки вида `ИМЯ=значение`. Пустые строки и строки с `#` пропускаются. */
export function parseKeys(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
    if (/^[A-Z][A-Z0-9_]*$/.test(name) && value) out[name] = value;
  }
  return out;
}

/** Ключи из окружения и из файла. Переменная окружения важнее файла. */
export function readKeys(env: NodeJS.ProcessEnv = process.env, file: string = keysFile(env)): Keys {
  const keys: Keys = {};
  if (existsSync(file)) {
    for (const [name, value] of Object.entries(parseKeys(readFileSync(file, 'utf8')))) keys[name] = { value, source: 'file' };
  }
  for (const name of Object.values(KEY_VAR)) {
    const value = env[name]?.trim();
    if (value) keys[name] = { value, source: 'env' };
  }
  return keys;
}

const TEMPLATE = `# Ключи моделей для штурмана «Связки».
# Этот файл лежит только на твоей машине. Не клади его в репозиторий и в папку игры.
# Впиши ключ после знака «=», без кавычек и пробелов. Строки с пустым значением не учитываются.

# Claude: https://platform.claude.com → Settings → API keys
ANTHROPIC_API_KEY=

# Kimi: https://platform.kimi.ai → API Keys (международная площадка Moonshot)
MOONSHOT_API_KEY=
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
