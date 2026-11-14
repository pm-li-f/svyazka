import { resolve } from 'node:path';
import { GameLoadError, loadGame } from './load.js';

const dir = resolve(process.argv[2] ?? '.');

try {
  const g = loadGame(dir);
  console.log(`ok  ${dir}`);
  console.log(
    `    людей ${g.people.length} · агентов ${g.agents.length} · переходов ${g.tasks.length} · ` +
      `лагерей ${g.map.camps.length} · листов ${Object.keys(g.sheets).length} · ходов ${g.turns.length}`,
  );
} catch (e) {
  if (e instanceof GameLoadError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
