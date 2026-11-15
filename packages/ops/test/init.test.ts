import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadGame } from '@svyazka/core';
import { signals } from '@svyazka/engine';
import { initGame, InitError, turnEnd, turnStart, type InitOptions } from '../src/index.js';

const TODAY = '2026-11-15';
const temps: string[] = [];
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), 'svyazka-init-'));
  temps.push(d);
  return join(d, 'game');
};
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const opts = (over: Partial<InitOptions> = {}): InitOptions => ({
  today: TODAY,
  lead: { id: 'you', name: 'Павел', role: 'cpto' },
  people: [
    { id: 'anya', name: 'Аня', role: 'tech-lead' },
    { id: 'mark', name: 'Марк: бэкенд #1', role: '' },
  ],
  camp: 'Бета-релиз',
  git: false,
  ...over,
});

describe('sv init', () => {
  it('создаёт папку, которая сразу читается', () => {
    const dir = fresh();
    const { created } = initGame(dir, opts());
    const g = loadGame(dir);
    expect(g.people.map((p) => `${p.id}:${p.name}:${p.role}:${p.is_lead}`)).toEqual([
      'anya:Аня:tech-lead:false',
      'mark:Марк: бэкенд #1:участник:false',
      'you:Павел:cpto:true',
    ]);
    expect(g.map.camps.find((c) => c.id === g.map.target)?.name).toBe('Бета-релиз');
    expect(g.map.weather).toMatchObject({ stage: 'forming', at: TODAY });
    expect(Object.keys(g.sheets).sort()).toEqual(['anya', 'mark', 'you']);
    expect(created).toContain('README.md');
    expect(existsSync(join(dir, '.git'))).toBe(false);
  });

  it('честно показывает, что контекста о людях ещё нет', () => {
    const dir = fresh();
    initGame(dir, opts());
    const list = signals(loadGame(dir), TODAY);
    expect(list.filter((s) => s.code === 'stale-context').map((s) => s.target)).toEqual(['anya', 'mark']);
    expect(list.find((s) => s.target === 'anya')?.text).toBe('Аня: 1on1 не было ни разу.');
  });

  it('в новой папке сразу можно прожить ход с коммитом', () => {
    const dir = fresh();
    const res = initGame(dir, opts({ git: true }));
    // на машине без настроенного имени в git коммит не пройдёт — тогда об этом честно сказано
    if (res.git?.startsWith('Папка создана, но git не сработал')) return;
    expect(res.git).toBe('Репозиторий создан, первый коммит сделан.');
    turnStart(dir, TODAY, 5);
    expect(turnEnd(dir, TODAY).commit).toBe(`Коммит: ход ${TODAY}.`);
    const log = execFileSync('git', ['log', '--format=%s'], { cwd: dir }).toString().trim().split('\n');
    expect(log).toEqual([`ход ${TODAY}`, 'начало экспедиции']);
  });

  it('не затирает непустую папку', () => {
    const dir = fresh();
    initGame(dir, opts());
    writeFileSync(join(dir, 'notes.txt'), 'моё');
    expect(() => initGame(dir, opts())).toThrow(InitError);
    expect(readFileSync(join(dir, 'notes.txt'), 'utf8')).toBe('моё');
  });

  it('проверяет идентификаторы', () => {
    expect(() => initGame(fresh(), opts({ people: [{ id: 'Аня', name: 'Аня', role: '' }] }))).toThrow(/Идентификатор «Аня» не подходит/);
    expect(() => initGame(fresh(), opts({ people: [{ id: 'you', name: 'Двойник', role: '' }] }))).toThrow('Идентификатор «you» указан дважды.');
    expect(() => initGame(fresh(), opts({ people: [{ id: 'x', name: '  ', role: '' }] }))).toThrow('У «x» не указано имя.');
  });
});
