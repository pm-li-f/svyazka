import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadGame } from '@svyazka/core';
import { daysBetween, freshness, raciLint, signals, skillCoverage } from '../src/index.js';

const demo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples/demo');
const TODAY = '2026-11-13';
const game = () => loadGame(demo);

describe('даты', () => {
  it('считает дни между датами, включая переход через месяц и год', () => {
    expect(daysBetween('2026-10-21', '2026-11-13')).toBe(23);
    expect(daysBetween('2026-11-13', '2026-11-13')).toBe(0);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
  });
});

describe('давность', () => {
  const byId = () => Object.fromEntries(freshness(game(), TODAY).map((f) => [f.person, f]));

  it('совпадает с экраном отряда из макета', () => {
    const f = byId();
    expect(f['anya']).toMatchObject({ daysSince1on1: 4, daysSinceSheet: 3, stale1on1: false, staleSheet: false });
    expect(f['mark']).toMatchObject({ daysSince1on1: 6, daysSinceSheet: 6 });
    expect(f['lena']).toMatchObject({ daysSince1on1: 2, daysSinceSheet: 1 });
    expect(f['timur']).toMatchObject({ daysSince1on1: 23, daysSinceSheet: 19, stale1on1: true, staleSheet: true });
  });

  it('у руководителя нет 1on1, но его лист тоже протухает', () => {
    const f = byId();
    expect(f['you']).toMatchObject({ daysSince1on1: null, stale1on1: false, daysSinceSheet: 12, staleSheet: false });
    const later = Object.fromEntries(freshness(game(), '2026-11-20').map((x) => [x.person, x]));
    expect(later['you']?.staleSheet).toBe(true);
  });

  it('устаревшему состоянию не верит', () => {
    const f = byId();
    expect(f['mark']?.stateFresh).toBe(true);
    expect(f['timur']?.stateFresh).toBe(false);
  });

  it('человек без единого 1on1 считается устаревшим', () => {
    const g = game();
    delete g.sheets['lena']?.last_1on1;
    const lena = freshness(g, TODAY).find((f) => f.person === 'lena');
    expect(lena).toMatchObject({ daysSince1on1: null, stale1on1: true });
  });
});

describe('линтер RACI', () => {
  it('находит три нарушения из макета', () => {
    expect(raciLint(game())).toEqual([
      { code: 'agent-accountable', task: 'deps-update', actor: 'reviewer' },
      { code: 'no-responsible', task: 'second-rope' },
      { code: 'accountable-overload', actor: 'anya', tasks: ['billing-migration', 'queue-incident', 'review-policy'] },
    ]);
  });

  it('не трогает завершённые переходы и замечает отсутствие ответственного', () => {
    const g = game();
    for (const t of g.tasks) {
      if (t.id === 'queue-incident') t.status = 'done';
      if (t.id === 'onboarding-v2') t.raci.A = null;
    }
    const found = raciLint(g);
    expect(found).toContainEqual({ code: 'no-accountable', task: 'onboarding-v2' });
    expect(found.some((f) => f.code === 'accountable-overload')).toBe(false);
  });
});

describe('покрытие навыков', () => {
  it('совпадает с матрицей из макета', () => {
    const c = Object.fromEntries(skillCoverage(game()).map((s) => [s.skill, s]));
    expect(c['databases']).toMatchObject({ holders: ['mark'], teachers: ['mark'], single: true });
    expect(c['hardware']).toMatchObject({ holders: ['timur'], single: true });
    expect(c['interfaces']?.holders).toEqual(['anya', 'lena']);
    expect(c['infrastructure']?.holders).toEqual(['anya', 'timur']);
    expect(c['architecture']?.holders).toHaveLength(4);
    expect(c['agents']?.holders).toHaveLength(4);
    expect(c['verification']?.holders).toHaveLength(5);
    expect(c['data-metrics']?.holders).toHaveLength(3);
    expect(skillCoverage(game()).filter((s) => s.single).map((s) => s.skill)).toEqual(['databases', 'hardware']);
  });
});

describe('сигналы', () => {
  it('собирает сигналы хода и сортирует по важности', () => {
    const list = signals(game(), TODAY);
    expect(list.map((s) => `${s.severity} ${s.code} ${s.target}`)).toEqual([
      'crit spof databases',
      'warn spof hardware',
      'warn stale-context timur',
      'warn stale-sheet timur',
      'warn raci second-rope',
      'lint raci deps-update',
      'lint raci anya',
      'info weather storming',
    ]);
  });

  it('критичность единственного держателя зависит от свежей нагрузки', () => {
    const list = signals(game(), TODAY);
    expect(list.find((s) => s.target === 'databases')?.text).toContain('Нагрузка 94%');
    // у Тимура нагрузка 88%, но состояние устарело — верить ей нельзя
    expect(list.find((s) => s.target === 'hardware')?.text).toContain('Нагрузка неизвестна');
  });

  it('в текстах сигналов нет данных из слоя «только ты»', () => {
    const g = game();
    const privateTexts = Object.values(g.privates).flatMap((p) => [
      ...p.margin.map((m) => m.text),
      ...p.bonds.map((b) => b.note ?? ''),
    ]);
    const all = signals(g, TODAY).map((s) => s.text).join('\n');
    for (const t of privateTexts.filter(Boolean)) expect(all).not.toContain(t);
  });
});
