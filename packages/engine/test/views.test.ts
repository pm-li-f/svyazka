import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadGame } from '@svyazka/core';
import { raciMatrix, sheetView, skillMatrix } from '../src/index.js';

const demo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples/demo');
const TODAY = '2026-11-13';
const game = () => loadGame(demo);

describe('лист по слоям', () => {
  const PAIR_ONLY = ['Тяну, но без запаса', 'мастерство', 'process-vision', 'Провести три ревью', 'Просит дублёра', 'Если взял'];
  const ME_ONLY = ['понимают с полуслова', 'трение о сроках', 'Не грузить новым', 'Спрашивать.'];

  it('вид отряда не содержит ни одного поля из слоёв пары и CPTO', () => {
    const view = sheetView(game(), 'mark', TODAY, 'team');
    expect(view.pair).toBeUndefined();
    expect(view.me).toBeUndefined();
    const text = JSON.stringify(view);
    for (const s of [...PAIR_ONLY, ...ME_ONLY]) expect(text).not.toContain(s);
    expect(view.craft[0]).toMatchObject({ label: 'Базы данных', level: 3 });
    expect(view.tasks.map((t) => `${t.id} ${t.roles.join('')}`)).toEqual(['billing-migration R', 'queue-incident C', 'review-policy I']);
  });

  it('вид пары содержит лист, но не заметки и связи CPTO', () => {
    const view = sheetView(game(), 'mark', TODAY, 'pair');
    expect(view.me).toBeUndefined();
    const text = JSON.stringify(view);
    for (const s of PAIR_ONLY) expect(text).toContain(s);
    for (const s of ME_ONLY) expect(text).not.toContain(s);
  });

  it('полный вид отмечает разрыв и свежесть состояния', () => {
    const view = sheetView(game(), 'mark', TODAY);
    expect(view.pair?.state).toMatchObject({ load: 94, daysAgo: 6, fresh: true });
    expect(view.pair?.thinking.find((t) => t.key === 'process-vision')).toMatchObject({ self: 4, lead: 2, gap: true });
    expect(view.pair?.thinking.find((t) => t.key === 'feedback')?.gap).toBe(false);
    expect(view.me?.bonds.map((b) => `${b.name} ${b.strength}`)).toEqual(['Тимур 3', 'Аня 2', 'Лена 1']);
    expect(sheetView(game(), 'timur', TODAY).pair).toMatchObject({ daysSince1on1: 23, stale1on1: true });
    expect(sheetView(game(), 'timur', TODAY).pair?.state?.fresh).toBe(false);
  });

  it('сообщает, если человека нет', () => {
    expect(() => sheetView(game(), 'nobody', TODAY)).toThrow('человек «nobody» не найден');
  });
});

describe('матрицы', () => {
  it('RACI: руководитель первым, агенты последними, клетка с агентом-ответственным помечена', () => {
    const m = raciMatrix(game());
    expect(m.actors.map((a) => a.id)).toEqual(['you', 'anya', 'lena', 'mark', 'timur', 'prototyper', 'reviewer']);
    const deps = m.tasks.find((t) => t.id === 'deps-update');
    expect(deps?.cells['reviewer']).toEqual(['R', 'A']);
    expect(deps?.agentAccountable).toBe(true);
    expect(m.tasks.find((t) => t.id === 'billing-migration')?.cells).toMatchObject({ you: ['I'], anya: ['A'], mark: ['R'], timur: ['C'], lena: [] });
    expect(m.lint).toHaveLength(3);
  });

  it('ремесло: сначала то, что держит один', () => {
    const m = skillMatrix(game());
    expect(m.rows.slice(0, 2).map((r) => r.label)).toEqual(['Базы данных', 'Железо']);
    expect(m.rows[0]).toMatchObject({ single: true, holders: 1, levels: { mark: 3, lena: null, you: 1 } });
    expect(m.rows.at(-1)).toMatchObject({ label: 'Проверка результата', holders: 5 });
  });
});
