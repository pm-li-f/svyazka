import { resolve } from 'node:path';
import { GameLoadError, loadGame } from './load.js';

/** Проверяет одну или несколько папок игры: `validate папка [папка…]`. Без параметров — текущую. */
const dirs = process.argv.length > 2 ? process.argv.slice(2) : ['.'];
let failed = false;

for (const dir of dirs.map((d) => resolve(d))) {
  try {
    const g = loadGame(dir);
    console.log(`ok  ${dir}`);
    console.log(
      `    людей ${g.people.length} · агентов ${g.agents.length} · переходов ${g.tasks.length} · ` +
        `лагерей ${g.map.camps.length} · листов ${Object.keys(g.sheets).length} · ходов ${g.turns.length}`,
    );
  } catch (e) {
    if (!(e instanceof GameLoadError)) throw e;
    console.error(e.message);
    failed = true;
  }
}

if (failed) process.exit(1);
