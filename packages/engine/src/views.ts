import type { Game, Layer, Task } from '@svyazka/core';
import { daysBetween } from './dates.js';
import { freshness } from './freshness.js';
import { raciLint, type RaciFinding } from './raci.js';
import { skillCoverage } from './skills.js';

/**
 * Представления для экранов. Всё, что показывает данные о человеке, собирается
 * здесь и принимает слой, до которого показывать: интерфейс не решает сам,
 * что скрыть, — он получает уже отфильтрованное.
 */

const ORDER: Layer[] = ['team', 'pair', 'me'];
const reaches = (upTo: Layer, layer: Layer) => ORDER.indexOf(layer) <= ORDER.indexOf(upTo);
type Role = 'R' | 'A' | 'C' | 'I';

function rolesOf(task: Task, id: string): Role[] {
  const out: Role[] = [];
  if (task.raci.R.includes(id)) out.push('R');
  if (task.raci.A === id) out.push('A');
  if (task.raci.C.includes(id)) out.push('C');
  if (task.raci.I.includes(id)) out.push('I');
  return out;
}

export interface SheetView {
  upTo: Layer;
  person: {
    id: string;
    name: string;
    role: string;
    isLead: boolean;
    joined: string | null;
    mbti: string | null;
    belbin: string | null;
    belbinShadow: string | null;
    owns: string[];
  };
  craft: { skill: string; label: string; level: 1 | 2 | 3; agreed: string }[];
  tasks: { id: string; title: string; terrain: Task['terrain']; roles: Role[] }[];
  /** Незакрытые задачи человека в Jira по последнему снимку. Это видит весь отряд и в самой Jira. */
  jira: { at: string; inProgress: number; open: number } | null;
  /** Слой «человек и CPTO». Отсутствует, если показываем только слой отряда. */
  pair?: {
    state: { energy: number; load: number; note: string | null; at: string; daysAgo: number; fresh: boolean } | null;
    last1on1: string | null;
    daysSince1on1: number | null;
    stale1on1: boolean;
    drives: string[];
    dampers: string[];
    thinking: { key: string; label: string; self: number; lead: number; gap: boolean }[];
    quest: { text: string; steps: number; done: number } | null;
    journal: { at: string; kind: string; text: string }[];
    review360: { at: string; themes: string[] } | null;
  };
  /** Слой «только CPTO». Отсутствует во всех остальных видах. */
  me?: {
    bonds: { with: string; name: string; strength: 1 | 2 | 3; note: string | null }[];
    margin: { at: string; text: string }[];
  };
}

export function sheetView(game: Game, id: string, today: string, upTo: Layer = 'me'): SheetView {
  const person = game.people.find((p) => p.id === id);
  if (!person) throw new Error(`человек «${id}» не найден`);
  const label = (k: string) => game.config.labels[k] ?? k;
  const name = (k: string) => game.people.find((p) => p.id === k)?.name ?? k;

  const jiraLoad = game.sources.jira?.people[id];

  const view: SheetView = {
    upTo,
    person: {
      id: person.id,
      name: person.name,
      role: person.role,
      isLead: person.is_lead,
      joined: person.joined ?? null,
      mbti: person.mbti ?? null,
      belbin: person.belbin ?? null,
      belbinShadow: person.belbin_shadow ?? null,
      owns: person.owns,
    },
    craft: Object.entries(person.craft)
      .map(([skill, v]) => ({ skill, label: label(skill), level: v.level, agreed: v.agreed }))
      .sort((a, b) => b.level - a.level || a.label.localeCompare(b.label, 'ru')),
    tasks: game.tasks
      .filter((t) => t.status !== 'done')
      .map((t) => ({ id: t.id, title: t.title, terrain: t.terrain, roles: rolesOf(t, id) }))
      .filter((t) => t.roles.length > 0),
    jira: jiraLoad ? { at: (game.sources.jira as { at: string }).at, inProgress: jiraLoad.in_progress, open: jiraLoad.open } : null,
  };

  if (reaches(upTo, 'pair')) {
    const sheet = game.sheets[id];
    const f = freshness(game, today).find((x) => x.person === id);
    view.pair = {
      state: sheet?.state
        ? {
            energy: sheet.state.energy,
            load: sheet.state.load,
            note: sheet.state.note ?? null,
            at: sheet.state.at,
            daysAgo: daysBetween(sheet.state.at, today),
            fresh: f?.stateFresh ?? false,
          }
        : null,
      last1on1: sheet?.last_1on1 ?? null,
      daysSince1on1: f?.daysSince1on1 ?? null,
      stale1on1: f?.stale1on1 ?? false,
      drives: sheet?.drives ?? [],
      dampers: sheet?.dampers ?? [],
      thinking: Object.entries(sheet?.thinking ?? {}).map(([key, v]) => ({
        key,
        label: label(key),
        self: v.self,
        lead: v.lead,
        gap: Math.abs(v.self - v.lead) >= 2,
      })),
      quest: sheet?.quest ?? null,
      journal: game.journals[id]?.entries ?? [],
      review360: sheet?.review360 ?? null,
    };
  }

  if (reaches(upTo, 'me')) {
    const priv = game.privates[id];
    view.me = {
      bonds: (priv?.bonds ?? []).map((b) => ({ with: b.with, name: name(b.with), strength: b.strength, note: b.note ?? null })),
      margin: priv?.margin ?? [],
    };
  }
  return view;
}

export interface RaciMatrix {
  actors: { id: string; name: string; kind: 'person' | 'agent' }[];
  tasks: {
    id: string;
    title: string;
    terrain: Task['terrain'];
    status: Task['status'];
    note: string | null;
    cells: Record<string, Role[]>;
    /** Отвечает агент: клетку надо подсветить. */
    agentAccountable: boolean;
  }[];
  lint: RaciFinding[];
}

/** Матрица RACI по открытым переходам: руководитель, люди, затем агенты. */
export function raciMatrix(game: Game): RaciMatrix {
  const people = [...game.people].sort((a, b) => Number(b.is_lead) - Number(a.is_lead));
  const agentIds = new Set(game.agents.map((a) => a.id));
  const actors: RaciMatrix['actors'] = [
    ...people.map((p) => ({ id: p.id, name: p.name, kind: 'person' as const })),
    ...game.agents.map((a) => ({ id: a.id, name: a.name, kind: 'agent' as const })),
  ];
  return {
    actors,
    tasks: game.tasks
      .filter((t) => t.status !== 'done')
      .map((t) => ({
        id: t.id,
        title: t.title,
        terrain: t.terrain,
        status: t.status,
        note: t.note ?? null,
        cells: Object.fromEntries(actors.map((a) => [a.id, rolesOf(t, a.id)])),
        agentAccountable: t.raci.A !== null && agentIds.has(t.raci.A),
      })),
    lint: raciLint(game),
  };
}

export interface SkillMatrix {
  people: { id: string; name: string }[];
  rows: {
    skill: string;
    label: string;
    levels: Record<string, 1 | 2 | 3 | null>;
    holders: number;
    single: boolean;
    none: boolean;
  }[];
}

/** Матрица ремесла: только слой отряда, сначала то, что держит меньше людей. */
export function skillMatrix(game: Game): SkillMatrix {
  const people = [...game.people].sort((a, b) => Number(b.is_lead) - Number(a.is_lead));
  const label = (k: string) => game.config.labels[k] ?? k;
  return {
    people: people.map((p) => ({ id: p.id, name: p.name })),
    rows: skillCoverage(game)
      .map((c) => ({
        skill: c.skill,
        label: label(c.skill),
        levels: Object.fromEntries(people.map((p) => [p.id, p.craft[c.skill]?.level ?? null])),
        holders: c.holders.length,
        single: c.single,
        none: c.none,
      }))
      .sort((a, b) => a.holders - b.holders || a.label.localeCompare(b.label, 'ru')),
  };
}
