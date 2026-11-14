import { resolve } from 'node:path';
import { GameLoadError, loadGame } from '@svyazka/core';
import { signals } from './signals.js';

const args = process.argv.slice(2);
const todayAt = args.indexOf('--today');
const today = todayAt >= 0 ? args[todayAt + 1] : new Date().toISOString().slice(0, 10);
const dir = resolve(args.find((a, i) => !a.startsWith('--') && i !== todayAt + 1) ?? '.');

if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
  console.error('--today ждёт дату в формате ГГГГ-ММ-ДД');
  process.exit(2);
}

try {
  const list = signals(loadGame(dir), today);
  console.log(`сигналы на ${today} · ${list.length}`);
  for (const s of list) console.log(`${s.severity.toUpperCase().padEnd(4)} ${s.code.padEnd(13)} ${s.text}`);
} catch (e) {
  if (e instanceof GameLoadError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
