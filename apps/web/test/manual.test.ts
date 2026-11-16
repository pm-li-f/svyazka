import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BLOCK_IDS, SCREENS, SOURCE_BLOCKS, SPLASHES } from '../../../docs/manual/screens';
import { STORY } from '../../../docs/manual/story';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.tsx') ? [join(dir, e.name)] : []));
const code = files(src)
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

/** Блок есть в интерфейсе, если его имя стоит в `data-block`, в `block=` у панели или в `name=` у блока листа. */
const exists = (id: string) =>
  code.includes(`data-block="${id}"`) || code.includes(`block="${id}"`) || (id.startsWith('sheet-') && code.includes(`name="${id.slice('sheet-'.length)}"`));

// Руководство обновляется только по просьбе владельца, поэтому в обычной проверке этой сверки нет.
// Перед обновлением: SVYAZKA_MANUAL=1 npm test.
describe.skipIf(!process.env['SVYAZKA_MANUAL'])('руководство игрока не отстаёт от интерфейса', () => {
  it('каждый блок, описанный в руководстве, есть на экране', () => {
    expect(BLOCK_IDS.filter((id) => !exists(id))).toEqual([]);
  });

  it('пример хода снимает только существующие блоки', () => {
    expect([...new Set(STORY.flatMap((s) => s.shots))].filter((id) => !exists(id))).toEqual([]);
  });

  it('кнопки заставок и блоки источников, на которые опирается руководство, есть в интерфейсе', () => {
    expect(SPLASHES.map((s) => s.button).filter((b) => !code.includes(`['${b}', `))).toEqual([]);
    for (const b of SOURCE_BLOCKS) for (const text of [b.what, b.source, b.why]) expect(text.trim().length, b.id).toBeGreaterThan(15);
  });

  it('у каждого экрана есть блоки и действия, у каждого блока — все три описания', () => {
    expect(SCREENS.map((s) => s.id)).toEqual(['people', 'map', 'tasks', 'sheet', 'turn', 'settings']);
    for (const screen of SCREENS) {
      expect(screen.blocks.length, screen.id).toBeGreaterThan(0);
      expect(screen.actions.length, screen.id).toBeGreaterThan(0);
      for (const b of screen.blocks) {
        expect(b.title.trim(), `${screen.id}/${b.id}`).not.toBe('');
        for (const text of [b.what, b.source, b.why]) expect(text.trim().length, `${screen.id}/${b.id}`).toBeGreaterThan(15);
      }
    }
  });
});
