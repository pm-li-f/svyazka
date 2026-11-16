import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadGame, type Game } from '@svyazka/core';
import { sheetView, signals, sourceSignals, sourcesView } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (name: string): Game => loadGame(resolve(here, '../../../examples', name));
const TODAY = '2026-11-14';
const by = (game: Game, today = TODAY) => Object.fromEntries(sourceSignals(game, today).map((s) => [`${s.code}:${s.target}`, s]));

describe('источники: пример jira-pomnit-vse', () => {
  const game = load('jira-pomnit-vse');

  it('переход в Jira считается без самого эпика', () => {
    const view = sourcesView(game, TODAY);
    const billing = view.jira.tasks.find((t) => t.task === 'billing-migration');
    expect(billing).toMatchObject({ total: 9, done: 3, inProgress: 3, todo: 3, truncated: false, error: null });
    expect(billing?.stalled).toEqual([{ key: 'PAY-14', days: 12 }]);
    expect(billing?.overdue).toEqual([{ key: 'PAY-17', days: 4 }]);
    expect(billing?.blocked).toEqual([{ key: 'PAY-18', by: ['OPS-7'] }]);
    // Одиночная задача без подзадач считается сама.
    expect(view.jira.tasks.find((t) => t.task === 'queue-incident')).toMatchObject({ total: 1, inProgress: 1 });
    expect(view.jira.unknown).toEqual(['d.contractor']);
  });

  it('застой, просрочка и ожидание — по сигналу на переход', () => {
    const s = by(game);
    expect(s['jira-stall:billing-migration']?.text).toBe('billing-migration: в Jira 1 задача в работе не двигалась больше 7 дн. (PAY-14).');
    expect(s['jira-overdue:billing-migration']?.text).toBe('billing-migration: в Jira просрочена PAY-17, на 4 дн.');
    expect(s['jira-blocked:billing-migration']?.text).toContain('PAY-18 ждёт OPS-7');
    expect(s['jira-stall:billing-migration']?.severity).toBe('warn');
  });

  it('расхождение игры и Jira — одно замечание на переход', () => {
    const s = by(game);
    expect(s['jira-drift:review-policy']?.text).toBe('review-policy: в Jira закрыто всё (3 из 3), а переход в игре открыт.');
    expect(s['jira-drift:billing-migration']?.text).toBe('billing-migration: в Jira задачи в работе у участника вне связки: Лена.');
    expect(s['jira-link:second-rope']?.text).toContain('ничего не найдено');
    // Там, где игра и Jira согласны, замечаний нет.
    expect(s['jira-drift:onboarding-v2']).toBeUndefined();
    expect(s['jira-drift:queue-incident']).toBeUndefined();
  });

  it('нагрузка — число из трекера, без сравнения людей', () => {
    const s = by(game);
    expect(Object.keys(s).filter((k) => k.startsWith('jira-load:'))).toEqual(['jira-load:mark']);
    expect(s['jira-load:mark']?.text).toBe('Марк: в Jira одновременно в работе 4 задачи (порог 3). Это число из трекера, а не оценка.');
    // Порядок людей — как в отряде, а не по числу задач.
    expect(sourcesView(game, TODAY).jira.people.map((p) => p.id)).toEqual(game.people.filter((p) => p.jira).map((p) => p.id));
    expect(sheetView(game, 'mark', TODAY, 'team').jira).toEqual({ at: TODAY, inProgress: 4, open: 5 });
  });

  it('страницы-артефакты: устаревшая и пропавшая', () => {
    const s = by(game);
    expect(s['stale-doc:quarter-goals']?.text).toBe('Цели на квартал: страница в Confluence не менялась 47 дн. при сроке годности 30.');
    expect(s['stale-doc:risk-register']?.severity).toBe('lint');
    // У устава свой срок — 180 дней, он свежий; постмортемы и роадмап меняли недавно.
    expect(Object.keys(s).filter((k) => k.startsWith('stale-doc:')).sort()).toEqual(['stale-doc:quarter-goals', 'stale-doc:risk-register']);
  });

  it('сроки считаются от даты снимка, а старый снимок назван старым', () => {
    const later = by(game, '2026-11-20');
    expect(later['jira-stall:billing-migration']?.text).toContain('1 задача');
    expect(later['sources:jira']?.text).toBe('Jira: данные сняты 6 дн. назад, сигналы по ним могли устареть. Обнови: sv sync.');
    expect(later['sources:confluence']?.severity).toBe('info');
    expect(by(game)['sources:jira']).toBeUndefined();
  });

  it('сигналы источников входят в общий список и не меняют остальные', () => {
    const all = signals(game, TODAY);
    const demo = signals(load('demo'), TODAY);
    const fromSources = all.filter((s) => /^(jira-|stale-doc|sources)/.test(s.code));
    expect(fromSources).toHaveLength(9);
    expect(all.length - fromSources.length).toBe(demo.length);
  });
});

describe('источники: правила на изменённых данных', () => {
  const base = load('jira-pomnit-vse');
  const withTask = (id: string, change: (t: Game['tasks'][number]) => void): Game => {
    const game = structuredClone(base);
    change(game.tasks.find((t) => t.id === id) as Game['tasks'][number]);
    return game;
  };

  it('закрытый переход с открытыми задачами в Jira', () => {
    const s = by(withTask('billing-migration', (t) => (t.status = 'done')));
    expect(s['jira-drift:billing-migration']?.text).toBe('billing-migration: переход в игре закрыт, а в Jira открыто 6 из 9.');
    // У закрытого перехода застой и просрочка уже не сигналят.
    expect(s['jira-stall:billing-migration']).toBeUndefined();
    expect(s['jira-overdue:billing-migration']).toBeUndefined();
  });

  it('не начатый переход, по которому в Jira уже работают', () => {
    const s = by(withTask('onboarding-v2', (t) => (t.status = 'planned')));
    expect(s['jira-drift:onboarding-v2']?.text).toBe('onboarding-v2: в игре переход не начат, а в Jira 1 задача уже в работе.');
  });

  it('ведущий без задач заметен, когда работа идёт у других', () => {
    const s = by(withTask('billing-migration', (t) => (t.raci = { R: ['timur'], A: 'anya', C: ['mark', 'lena'], I: [] })));
    expect(s['jira-drift:billing-migration']?.text).toBe('billing-migration: ведёт Тимур, но в Jira в работе у него ничего нет.');
  });

  it('без ссылки, без снимка и без настройки сигналов нет', () => {
    const unlinked = structuredClone(base);
    for (const t of unlinked.tasks) delete t.jira;
    unlinked.artifacts = [];
    for (const p of unlinked.people) delete p.jira;
    expect(sourceSignals(unlinked, TODAY)).toEqual([]);

    const empty = structuredClone(base);
    empty.sources = {};
    expect(sourceSignals(empty, TODAY).map((s) => `${s.code}:${s.target}:${s.severity}`)).toEqual(['sources:jira:info', 'sources:confluence:info']);

    expect(sourceSignals(load('demo'), TODAY)).toEqual([]);
  });
});
