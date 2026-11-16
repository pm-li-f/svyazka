import type { Game, JiraIssue, JiraLink, Task } from '@svyazka/core';
import { daysBetween } from './dates.js';
import type { Signal } from './signals.js';

/**
 * Данные из Jira и Confluence. Движок в сеть не ходит: он считает по снимку,
 * который `sv sync` положил в папку игры. Все сроки отсчитываются от даты снимка —
 * на этот день данные были верны; что было после, движок не знает и говорит об этом.
 */

/** Как переход выглядит в Jira. */
export interface TaskSource {
  task: string;
  title: string;
  status: Task['status'];
  query: string;
  /** Сколько задач за ссылкой, не считая самого эпика. */
  total: number;
  done: number;
  inProgress: number;
  todo: number;
  /** В работе, но не двигались дольше порога. */
  stalled: { key: string; days: number }[];
  overdue: { key: string; days: number }[];
  blocked: { key: string; by: string[] }[];
  /** У кого задачи в работе: id человека в игре или логин, если игра его не узнала. */
  working: { id: string | null; login: string; name: string; count: number }[];
  /** Сервер нашёл больше, чем прочитано. */
  truncated: boolean;
  error: string | null;
}

export interface SourcesView {
  jira: {
    configured: boolean;
    url: string | null;
    /** Сколько переходов и людей связано с Jira. */
    linked: { tasks: number; people: number };
    at: string | null;
    /** Сколько дней снимку. */
    age: number | null;
    stale: boolean;
    staleDays: number;
    wipMax: number;
    tasks: TaskSource[];
    /** Незакрытые задачи человека во всей Jira. Порядок — как в отряде, не по числу. */
    people: { id: string; name: string; inProgress: number; open: number; over: boolean }[];
    /** Исполнители, которых игра не узнала. */
    unknown: string[];
  };
  confluence: {
    configured: boolean;
    url: string | null;
    at: string | null;
    age: number | null;
    stale: boolean;
    artifacts: {
      id: string;
      title: string;
      ttl: number;
      /** null — снимка этой страницы ещё нет. */
      updated: string | null;
      days: number | null;
      by: string | null;
      url: string | null;
      stale: boolean;
      error: string | null;
      note: string | null;
    }[];
  };
}

const linkKeys = (link: JiraLink): string[] => (typeof link === 'string' ? [link] : Array.isArray(link) ? link : []);

/**
 * Задачи перехода без «обёртки». Если ссылка ведёт на эпик и у него есть задачи,
 * сам эпик в счёт не идёт: он закрывается последним и исказил бы картину.
 */
function workItems(link: JiraLink, issues: JiraIssue[]): JiraIssue[] {
  const own = new Set(linkKeys(link));
  const inner = issues.filter((i) => !own.has(i.key));
  return inner.length > 0 ? inner : issues;
}

export function sourcesView(game: Game, today: string): SourcesView {
  const cfg = game.config.sources;
  const jira = game.sources.jira;
  const wiki = game.sources.confluence;
  const actors = [...game.people, ...game.agents];
  const byLogin = new Map(actors.flatMap((a) => (a.jira ? [[a.jira, a] as const] : [])));
  const staleDays = cfg.jira?.stale_days ?? 7;
  const wipMax = cfg.jira?.wip_max ?? 3;

  const tasks: TaskSource[] = [];
  const unknown = new Set<string>();
  if (jira) {
    for (const task of game.tasks) {
      const snap = task.jira ? jira.tasks[task.id] : undefined;
      if (!task.jira || !snap) continue;
      const items = workItems(task.jira, snap.issues);
      const open = items.filter((i) => i.category !== 'done');
      const working = new Map<string, number>();
      for (const i of items) {
        if (i.assignee && !byLogin.has(i.assignee)) unknown.add(i.assignee);
        if (i.category === 'indeterminate' && i.assignee) working.set(i.assignee, (working.get(i.assignee) ?? 0) + 1);
      }
      tasks.push({
        task: task.id,
        title: task.title,
        status: task.status,
        query: snap.query,
        total: items.length,
        done: items.length - open.length,
        inProgress: open.filter((i) => i.category === 'indeterminate').length,
        todo: open.filter((i) => i.category === 'new').length,
        stalled: open
          .filter((i) => i.category === 'indeterminate')
          .map((i) => ({ key: i.key, days: daysBetween(i.updated, jira.at) }))
          .filter((i) => i.days > staleDays),
        overdue: open.flatMap((i) => (i.due && i.due < jira.at ? [{ key: i.key, days: daysBetween(i.due, jira.at) }] : [])),
        blocked: open.filter((i) => i.blocked_by.length > 0).map((i) => ({ key: i.key, by: i.blocked_by })),
        working: [...working].map(([login, count]) => {
          const actor = byLogin.get(login);
          return { id: actor?.id ?? null, login, name: actor?.name ?? login, count };
        }),
        truncated: snap.total > snap.issues.length,
        error: snap.error ?? (snap.total === 0 ? 'по ссылке ничего не найдено' : null),
      });
    }
  }

  const jiraAge = jira ? daysBetween(jira.at, today) : null;
  const wikiAge = wiki ? daysBetween(wiki.at, today) : null;
  return {
    jira: {
      configured: cfg.jira !== undefined,
      url: cfg.jira?.url ?? null,
      linked: { tasks: game.tasks.filter((t) => t.jira).length, people: game.people.filter((p) => p.jira).length },
      at: jira?.at ?? null,
      age: jiraAge,
      stale: jiraAge !== null && jiraAge > cfg.fresh_days,
      staleDays,
      wipMax,
      tasks,
      people: jira
        ? game.people.flatMap((p) => {
            const load = jira.people[p.id];
            return load && p.jira ? [{ id: p.id, name: p.name, inProgress: load.in_progress, open: load.open, over: load.in_progress > wipMax }] : [];
          })
        : [],
      unknown: [...unknown].sort(),
    },
    confluence: {
      configured: cfg.confluence !== undefined,
      url: cfg.confluence?.url ?? null,
      at: wiki?.at ?? null,
      age: wikiAge,
      stale: wikiAge !== null && wikiAge > cfg.fresh_days,
      artifacts: game.artifacts.map((a) => {
        const ttl = a.ttl_days ?? cfg.confluence?.ttl_days ?? 30;
        const page = wiki?.pages[a.id];
        const base = { id: a.id, title: a.title, ttl, note: a.note ?? null };
        if (!wiki || !page) return { ...base, updated: null, days: null, by: null, url: null, stale: false, error: null };
        if ('error' in page) return { ...base, updated: null, days: null, by: null, url: null, stale: false, error: page.error };
        const days = daysBetween(page.updated, wiki.at);
        return { ...base, updated: page.updated, days, by: page.by, url: page.url, stale: days > ttl, error: null };
      }),
    },
  };
}

const plural = (n: number, one: string, few: string, many: string): string => {
  const d = n % 10;
  const h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};
const issuesWord = (n: number) => `${n} ${plural(n, 'задача', 'задачи', 'задач')}`;
const list = (keys: string[], max = 3) => keys.slice(0, max).join(', ') + (keys.length > max ? ` и ещё ${keys.length - max}` : '');

/**
 * Сигналы из источников. Они описывают расхождение между игрой и трекером,
 * а не оценивают людей: число задач в работе — это число, а не отметка человеку.
 */
export function sourceSignals(game: Game, today: string): Signal[] {
  const view = sourcesView(game, today);
  const out: Signal[] = [];
  const name = (id: string) => game.people.find((p) => p.id === id)?.name ?? game.agents.find((a) => a.id === id)?.name ?? id;

  for (const t of view.jira.tasks) {
    const task = game.tasks.find((x) => x.id === t.task);
    if (!task) continue;
    if (t.error) {
      out.push({ severity: 'lint', code: 'jira-link', target: t.task, text: `${t.task}: в Jira ${t.error}. Проверь ссылку jira в файле перехода.` });
      continue;
    }
    const open = task.status !== 'done';
    if (open && t.stalled.length) {
      const verb = t.stalled.length === 1 ? 'не двигалась' : 'не двигались';
      out.push({
        severity: 'warn',
        code: 'jira-stall',
        target: t.task,
        text: `${t.task}: в Jira ${issuesWord(t.stalled.length)} в работе ${verb} больше ${view.jira.staleDays} дн. (${list(t.stalled.map((i) => i.key))}).`,
      });
    }
    if (open && t.overdue.length) {
      const worst = Math.max(...t.overdue.map((i) => i.days));
      out.push({
        severity: 'warn',
        code: 'jira-overdue',
        target: t.task,
        text:
          t.overdue.length === 1
            ? `${t.task}: в Jira просрочена ${t.overdue[0]?.key}, на ${worst} дн.`
            : `${t.task}: в Jira просрочено ${issuesWord(t.overdue.length)} (${list(t.overdue.map((i) => i.key))}), дольше всего — ${worst} дн.`,
      });
    }
    if (open && t.blocked.length) {
      out.push({
        severity: 'warn',
        code: 'jira-blocked',
        target: t.task,
        text: `${t.task}: в Jira ждут другие задачи — ${list(t.blocked.map((i) => `${i.key} ждёт ${i.by.join(', ')}`), 2)}.`,
      });
    }

    // Расхождение игры и Jira: одно замечание на переход.
    const drift: string[] = [];
    if (open && t.total > 0 && t.done === t.total) drift.push(`в Jira закрыто всё (${t.done} из ${t.total}), а переход в игре открыт`);
    if (!open && t.done < t.total) drift.push(`переход в игре закрыт, а в Jira открыто ${t.total - t.done} из ${t.total}`);
    if (task.status === 'planned' && t.inProgress > 0) drift.push(`в игре переход не начат, а в Jira ${issuesWord(t.inProgress)} уже в работе`);
    if (open) {
      const rope = new Set([...task.raci.R, ...task.raci.C, ...(task.raci.A ? [task.raci.A] : [])]);
      const outside = t.working.filter((w) => w.id !== null && !rope.has(w.id));
      if (outside.length) drift.push(`в Jira задачи в работе у ${outside.length === 1 ? 'участника' : 'участников'} вне связки: ${outside.map((w) => w.name).join(', ')}`);
      // Ведущий без задач заметен, только когда работа идёт у других.
      const busy = new Set(t.working.map((w) => w.id));
      const idle = task.raci.R.filter((id) => game.people.some((p) => p.id === id && p.jira) && !busy.has(id));
      if (idle.length && t.working.length > 0 && idle.length === task.raci.R.length) {
        drift.push(`ведёт ${idle.map(name).join(', ')}, но в Jira в работе у ${idle.length === 1 ? 'него' : 'них'} ничего нет`);
      }
    }
    if (drift.length) out.push({ severity: 'lint', code: 'jira-drift', target: t.task, text: `${t.task}: ${drift.join('; ')}.` });
  }

  for (const p of view.jira.people) {
    if (!p.over) continue;
    out.push({
      severity: 'warn',
      code: 'jira-load',
      target: p.id,
      text: `${p.name}: в Jira одновременно в работе ${issuesWord(p.inProgress)} (порог ${view.jira.wipMax}). Это число из трекера, а не оценка.`,
    });
  }

  for (const a of view.confluence.artifacts) {
    if (a.error) {
      out.push({ severity: 'lint', code: 'stale-doc', target: a.id, text: `${a.title}: ${a.error}. Проверь ссылку в team/artifacts.yaml.` });
    } else if (a.stale && a.days !== null) {
      out.push({ severity: 'warn', code: 'stale-doc', target: a.id, text: `${a.title}: страница в Confluence не менялась ${a.days} дн. при сроке годности ${a.ttl}.` });
    }
  }

  const fresh = (title: string, key: 'jira' | 'confluence', has: boolean, linked: number) => {
    const s = view[key];
    if (!s.configured || linked === 0) return;
    if (!has) {
      out.push({ severity: 'info', code: 'sources', target: key, text: `${title}: адрес настроен, а данных ещё нет. Сними их: sv sync.` });
    } else if (s.stale) {
      out.push({ severity: 'info', code: 'sources', target: key, text: `${title}: данные сняты ${s.age} дн. назад, сигналы по ним могли устареть. Обнови: sv sync.` });
    }
  };
  fresh('Jira', 'jira', view.jira.at !== null, view.jira.linked.tasks + view.jira.linked.people);
  fresh('Confluence', 'confluence', view.confluence.at !== null, view.confluence.artifacts.length);
  return out;
}
