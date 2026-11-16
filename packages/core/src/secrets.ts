import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Секреты — ключи моделей, логин и пароль к источникам — живут вне репозитория и вне
 * папки игры: в переменных окружения или в файле ключей в домашней папке.
 * Значение не печатается нигде: ни в выводе, ни в ошибках.
 */

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

/** Секреты из файла и из окружения. Из окружения берутся только названные имена; оно важнее файла. */
export function readSecrets(names: readonly string[], env: NodeJS.ProcessEnv = process.env, file: string = keysFile(env)): Keys {
  const keys: Keys = {};
  if (existsSync(file)) {
    for (const [name, value] of Object.entries(parseKeys(readFileSync(file, 'utf8')))) keys[name] = { value, source: 'file' };
  }
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) keys[name] = { value, source: 'env' };
  }
  return keys;
}
