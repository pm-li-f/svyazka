import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, events, plan, type GameEvent } from '@svyazka/engine/src/events';
import { oneOnOne, turnStart } from '@svyazka/ops';
import { buildState } from '../server/state';
import { effectText } from '../src/game/Effects';
import { caption, splashMs } from '../src/game/Splash';

const examples = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples');
let temp: string | undefined;

function copy(name: string): string {
  temp = mkdtempSync(join(tmpdir(), 'svyazka-game-'));
  cpSync(join(examples, name), temp, { recursive: true });
  return temp;
}
const patch = (file: string, from: string | RegExp, to: string) => {
  const text = readFileSync(file, 'utf8');
  const next = text.replace(from, to);
  expect(next, `в ${file} нечего менять`).not.toBe(text);
  writeFileSync(file, next);
};
const kinds = (list: GameEvent[]) => list.map((e) => e.kind).sort();

afterEach(() => {
  if (temp) rmSync(temp, { recursive: true, force: true });
  temp = undefined;
});

describe('события между двумя состояниями экрана', () => {
  it('состояние несёт факты, и первое открытие страницы ничего не показывает', () => {
    const s = buildState(copy('demo'), '2026-11-14');
    expect(s.facts.turn).toBe('none');
    expect(Object.values(s.facts.storms)).toEqual(['Очередь задач деградирует']);
    expect(events(null, s.facts)).toEqual([]);
  });

  it('в шторм встреча снимает сигнал, но эффекта нет; после шторма он есть', () => {
    const dir = copy('demo');
    const before = buildState(dir, '2026-11-14').facts;
    turnStart(dir, '2026-11-14', 8);
    oneOnOne(dir, '2026-11-14', 'timur', 'Поговорили');
    const after = buildState(dir, '2026-11-14').facts;
    const list = events(before, after);
    expect(kinds(list)).toEqual(['signal-cleared', 'turn-start']);
    const stormy = Object.keys(after.storms).length > 0;
    expect(stormy).toBe(true);
    // По умолчанию: ежедневная заставка не показывается, эффекты в шторм молчат.
    expect(plan(list, DEFAULT_SETTINGS, stormy)).toEqual({ splashes: [], effects: [] });
    expect(plan(list, { ...DEFAULT_SETTINGS, splash: 'all' }, stormy).splashes.map((e) => e.kind)).toEqual(['turn-start']);
    expect(plan(list, DEFAULT_SETTINGS, false).effects.map((e) => e.kind)).toEqual(['signal-cleared']);
  });

  it('правка файлов в редакторе даёт те же события, что и кнопки', () => {
    const dir = copy('kak-po-maslu');
    const before = buildState(dir, '2026-11-13').facts;
    patch(join(dir, 'team/map.yaml'), 'name: Первые платящие, phase: current', 'name: Первые платящие, phase: done');
    writeFileSync(join(dir, 'team/people/yulia.md'), '---\nid: yulia\nname: Юля\nrole: backend\nis_lead: false\njoined: 2026-11-13\n---\n');
    const after = buildState(dir, '2026-11-13').facts;
    const shown = plan(events(before, after), DEFAULT_SETTINGS, false);
    expect(shown.splashes.map((e) => e.kind)).toEqual(['camp-taken', 'new-member']);
    expect(shown.splashes.map((e) => caption(e))).toEqual([
      ['лагерь взят', 'Первые платящие'],
      ['в связке новый участник', 'Юля'],
    ]);
  });
});

describe('подписи', () => {
  it('у каждой заставки и каждого эффекта есть заголовок и строка', () => {
    const all: GameEvent[] = [
      { kind: 'turn-start', date: '2026-11-14', budget: 8 },
      { kind: 'turn-end', date: '2026-11-14', untouched: 0 },
      { kind: 'storm', id: 't', title: 'Очередь' },
      { kind: 'new-member', id: 'p', name: 'Юля' },
      { kind: 'camp-taken', id: 'c', name: 'Бета' },
    ];
    for (const e of all) if (e.kind !== 'signal-cleared' && e.kind !== 'backup-assigned' && e.kind !== 'lint-green' && e.kind !== 'quest-step' && e.kind !== 'sheet-updated') expect(caption(e).join('').length).toBeGreaterThan(5);
    expect(caption({ kind: 'turn-start', date: '2026-11-14', budget: 8 })).toEqual(['ход · 14 ноября', 'сил на сегодня: 8']);
    expect(caption({ kind: 'turn-end', date: '2026-11-14', untouched: 0 })[1]).toBe('всё разобрано');
    expect(effectText({ kind: 'backup-assigned', skill: 'Базы данных' })).toEqual(['Появился дублёр', 'Навык «Базы данных» больше не держится на одном человеке']);
    expect(effectText({ kind: 'quest-step', id: 'm', name: 'Марк', done: 2, steps: 3 })[1]).toBe('Марк: 2 из 3');
  });

  it('с «уменьшить движение» заставка короткая и не длиннее обычной', () => {
    expect(splashMs('camp-taken', false)).toBe(6500);
    expect(splashMs('camp-taken', true)).toBe(1600);
    expect(splashMs('turn-start', true)).toBeLessThanOrEqual(splashMs('turn-start', false));
  });
});
