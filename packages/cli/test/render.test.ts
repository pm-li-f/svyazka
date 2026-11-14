import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadGame } from '@svyazka/core';
import { roster } from '@svyazka/engine';
import { makePaint, renderRaci, renderRoster, renderSheet, renderSignals, renderSkills } from '../src/index.js';

const demo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples/demo');
const TODAY = '2026-11-13';
const game = () => loadGame(demo);
/** Строка вывода, которая начинается с заданного слова, с ужатыми пробелами. */
const row = (out: string, start: string) =>
  out
    .split('\n')
    .find((l) => l.trim().startsWith(start))
    ?.trim()
    .replace(/\s+/g, ' ');

describe('отряд', () => {
  it('строки совпадают с макетом', () => {
    const out = renderRoster(game(), TODAY);
    expect(row(out, 'you')).toBe('you cpto — — loaded 90% — 12d стратегия, найм');
    expect(row(out, 'mark')).toBe('mark backend ISTP специалист loaded 94% 6d 6d billing-db');
    expect(row(out, 'timur')).toBe('timur infra ISTJ реализатор stale ? 23d 19d queue, hardware');
    expect(row(out, 'agent/reviewer')).toContain('R only · отвечает anya');
  });

  it('руководитель идёт первым, агенты — последними', () => {
    const rows = roster(game(), TODAY);
    expect(rows[0]?.id).toBe('you');
    expect(rows.slice(-2).every((r) => r.kind === 'agent')).toBe(true);
  });

  it('устаревшую нагрузку не показывает', () => {
    const timur = roster(game(), TODAY).find((r) => r.id === 'timur');
    expect(timur).toMatchObject({ status: 'stale', load: null });
  });
});

describe('RACI', () => {
  it('показывает матрицу и нарушения', () => {
    const out = renderRaci(game());
    expect(row(out, 'billing-migration')).toContain('перевал · сложный I A · R C · ·');
    expect(row(out, 'deps-update')).toContain('R A');
    expect(out).toContain('✗ deps-update: отвечает агент (reviewer)');
    expect(out).toContain('✗ second-rope: никто не ведёт');
    expect(out).toContain('! anya отвечает за 3 перехода сразу');
  });
});

describe('навыки', () => {
  it('подписи по-русски, сначала то, что держит один', () => {
    const lines = renderSkills(game()).split('\n');
    expect(lines[2]).toMatch(/^Базы данных .* 1 · держит один$/);
    expect(lines[3]).toMatch(/^Железо .* 1 · держит один$/);
    expect(row(lines.join('\n'), 'Проверка результата')).toBe('Проверка результата сам учит сам сам сам 5');
  });
});

describe('лист', () => {
  const PAIR_ONLY = ['Тяну, но без запаса', 'мастерство', 'Видение процессов', 'Провести три ревью', 'Просит дублёра', 'Если взял'];
  const ME_ONLY = ['понимают с полуслова', 'трение о сроках', 'Не грузить новым', 'Спрашивать.'];

  it('полный вид показывает все три слоя', () => {
    const out = renderSheet(game(), 'mark', TODAY);
    for (const s of [...PAIR_ONLY, ...ME_ONLY]) expect(out).toContain(s);
    expect(out).toContain('← разрыв: тема для 1on1');
    expect(row(out, 'Базы данных')).toBe('Базы данных учу других ▮▮▮');
  });

  it('вид отряда не содержит ничего из слоёв пары и CPTO', () => {
    const out = renderSheet(game(), 'mark', TODAY, 'team');
    expect(out).toContain('ремесло');
    for (const s of [...PAIR_ONLY, ...ME_ONLY]) expect(out).not.toContain(s);
    expect(out).not.toContain('[пара]');
    expect(out).not.toContain('[только ты]');
  });

  it('вид пары не содержит заметок и связей CPTO', () => {
    const out = renderSheet(game(), 'mark', TODAY, 'pair');
    for (const s of PAIR_ONLY) expect(out).toContain(s);
    for (const s of ME_ONLY) expect(out).not.toContain(s);
  });

  it('сообщает, если человека нет', () => {
    expect(() => renderSheet(game(), 'nobody', TODAY)).toThrow('человек «nobody» не найден');
  });
});

describe('сигналы и цвет', () => {
  it('выводит сигналы с подписями навыков', () => {
    const out = renderSignals(game(), TODAY);
    expect(out.split('\n')[0]).toBe('сигналы · 2026-11-13 · 8');
    expect(row(out, 'CRIT')).toBe('CRIT spof Навык «Базы данных» держит один человек — Марк. Нагрузка 94%.');
  });

  it('цвет не ломает выравнивание: без кодов раскраски текст тот же', () => {
    const colored = renderRoster(game(), TODAY, makePaint(true));
    // eslint-disable-next-line no-control-regex
    expect(colored.replace(/\u001b\[\d+m/g, '')).toBe(renderRoster(game(), TODAY));
    expect(colored).not.toBe(renderRoster(game(), TODAY));
  });
});
