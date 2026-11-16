import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { GameLoadError, loadGame } from '@svyazka/core';
import { localToday } from '@svyazka/ops';
import { startServer } from './start.js';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    port: { type: 'string' },
    today: { type: 'string' },
  },
});

const dir = resolve(values.dir ?? process.env['SVYAZKA_DIR'] ?? '.');
const port = Number(values.port ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('--port ждёт номер порта');
  process.exit(2);
}
if (values.today && !/^\d{4}-\d{2}-\d{2}$/.test(values.today)) {
  console.error('--today ждёт дату в формате ГГГГ-ММ-ДД');
  process.exit(2);
}

try {
  loadGame(dir);
} catch (e) {
  console.error(e instanceof GameLoadError ? e.message : e);
  process.exit(1);
}

await startServer({ dir, port, today: () => values.today ?? localToday() });
console.log(`Связка: http://127.0.0.1:${port}`);
console.log(`папка игры: ${dir}`);
