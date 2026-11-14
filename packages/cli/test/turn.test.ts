import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadGame } from '@svyazka/core';
import { signals } from '@svyazka/engine';
import { act, chargeSheetRead, decide, oneOnOne, turnEnd, turnShow, turnStart } from '../src/turn.js';

const demo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples/demo');
const TODAY = '2026-11-14';

const temps: string[] = [];
function copyOfDemo(sub = ''): string {
  const base = mkdtempSync(join(tmpdir(), 'svyazka-turn-'));
  temps.push(base);
  const dir = sub ? join(base, sub) : base;
  if (sub) mkdirSync(dir, { recursive: true });
  cpSync(demo, dir, { recursive: true });
  return dir;
}
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
function initRepo(dir: string) {
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('день в терминале', () => {
  it('проходит от утренней отметки до коммита', () => {
    const dir = copyOfDemo();
    initRepo(dir);

    expect(() => turnShow(dir, TODAY)).toThrow('Ход на 2026-11-14 не начат. Начни его: sv turn start');

    expect(turnStart(dir, TODAY)).toContain('осталось 8 из 8');

    // лист стоит внимания один раз за ход на человека
    expect(chargeSheetRead(dir, TODAY, 'mark')).toContain('осталось 7 из 8');
    expect(chargeSheetRead(dir, TODAY, 'mark')).toBeNull();

    // 1on1 снимает сигнал об устаревшем контексте, потому что меняет данные
    expect(signals(loadGame(dir), TODAY).some((s) => s.code === 'stale-context')).toBe(true);
    expect(oneOnOne(dir, TODAY, 'timur', 'Разобрали шторм: перегружен, просит помощь.')).toContain('осталось 5 из 8');
    const after = loadGame(dir);
    expect(after.sheets['timur']?.last_1on1).toBe(TODAY);
    expect(after.journals['timur']?.entries[0]).toEqual({ at: TODAY, kind: '1on1', text: 'Разобрали шторм: перегружен, просит помощь.' });
    expect(after.journals['timur']?.entries).toHaveLength(2);
    expect(signals(after, TODAY).some((s) => s.code === 'stale-context')).toBe(false);

    expect(act(dir, TODAY, 'route-block', 'paying')).toContain('осталось 2 из 8');
    expect(decide(dir, TODAY, 'Дублёр по billing-db — Тимур, после перевала')).toContain('решение записано');

    const end = turnEnd(dir, TODAY);
    expect(end).toContain('до чего не дошёл');
    expect(end).toContain('Коммит: ход 2026-11-14.');
    expect(git(dir, 'log', '--format=%s', '-1').trim()).toBe('ход 2026-11-14');
    expect(git(dir, 'status', '--porcelain').trim()).toBe('');

    const turn = loadGame(dir).turns.find((t) => t.date === TODAY);
    expect(turn).toMatchObject({ attention: { budget: 8, spent: 6 }, closed: true, decisions: ['Дублёр по billing-db — Тимур, после перевала'] });
    expect(turn?.actions.map((a) => `${a.kind} ${a.target}`)).toEqual(['read-sheet mark', 'one-on-one timur', 'route-block paying']);

    expect(() => act(dir, TODAY, 'read-sheet', 'anya')).toThrow('Ход 2026-11-14 уже закрыт.');
    expect(chargeSheetRead(dir, TODAY, 'anya')).toBeNull();
  });

  it('перерасход показывает, а не запрещает', () => {
    const dir = copyOfDemo();
    turnStart(dir, TODAY, 2);
    expect(act(dir, TODAY, 'route-block')).toContain('бюджет 2 исчерпан, перерасход 1');
  });

  it('без открытого хода лист не стоит ничего', () => {
    const dir = copyOfDemo();
    expect(chargeSheetRead(dir, TODAY, 'mark')).toBeNull();
  });

  it('1on1 проверяет, с кем встреча', () => {
    const dir = copyOfDemo();
    turnStart(dir, TODAY);
    expect(() => oneOnOne(dir, TODAY, 'nobody')).toThrow(/Человек «nobody» не найден/);
    expect(() => oneOnOne(dir, TODAY, 'you')).toThrow('1on1 с самим собой не записываю.');
  });
});

describe('запись в файлы', () => {
  it('сохраняет заметки под шапкой и комментарии внутри неё', () => {
    const dir = copyOfDemo();
    const sheet = join(dir, 'pair/timur/sheet.md');
    writeFileSync(sheet, readFileSync(sheet, 'utf8').replace('drives:', '# важное\ndrives:') + '\nСвободная заметка под шапкой.\n');
    turnStart(dir, TODAY);
    oneOnOne(dir, TODAY, 'timur');
    const text = readFileSync(sheet, 'utf8');
    expect(text).toContain('last_1on1: 2026-11-14');
    expect(text).toContain('# важное');
    expect(text).toContain('Свободная заметка под шапкой.');
    expect(text).toContain('state: {energy: 3, load: 88, by: timur, at: 2026-10-25}');
  });

  it('создаёт журнал, если его не было', () => {
    const dir = copyOfDemo();
    turnStart(dir, TODAY);
    oneOnOne(dir, TODAY, 'lena', 'Первая запись');
    expect(loadGame(dir).journals['lena']?.entries).toEqual([{ at: TODAY, kind: '1on1', text: 'Первая запись' }]);
  });
});

describe('коммит хода', () => {
  it('пропускается, если папка игры не в git', () => {
    const dir = copyOfDemo();
    turnStart(dir, TODAY);
    expect(turnEnd(dir, TODAY)).toMatch(/Папка игры (не в git|лежит внутри другого репозитория): коммит пропущен/);
  });

  it('не трогает чужой репозиторий, если папка игры лежит внутри него', () => {
    const dir = copyOfDemo('nested/game');
    const outer = resolve(dir, '../..');
    initRepo(outer);
    turnStart(dir, TODAY);
    expect(turnEnd(dir, TODAY)).toContain('лежит внутри другого репозитория: коммит пропущен');
    expect(git(outer, 'log', '--format=%s').trim()).toBe('init');
  });

  it('флаг отключает коммит', () => {
    const dir = copyOfDemo();
    initRepo(dir);
    turnStart(dir, TODAY);
    expect(turnEnd(dir, TODAY, false)).not.toContain('Коммит');
    expect(git(dir, 'log', '--format=%s').trim()).toBe('init');
  });
});
