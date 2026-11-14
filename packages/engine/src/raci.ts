import type { Game } from '@svyazka/core';

export type RaciFinding =
  /** У перехода нет ответственного. */
  | { code: 'no-accountable'; task: string }
  /** Отвечает агент. Агент может вести, но отвечает всегда человек. */
  | { code: 'agent-accountable'; task: string; actor: string }
  /** Никто не ведёт: переход стоит. */
  | { code: 'no-responsible'; task: string }
  /** Один человек отвечает за слишком много переходов сразу. */
  | { code: 'accountable-overload'; actor: string; tasks: string[] };

/** Линтер RACI. Завершённые переходы не проверяются. */
export function raciLint(game: Game): RaciFinding[] {
  const agents = new Set(game.agents.map((a) => a.id));
  const open = game.tasks.filter((t) => t.status !== 'done');
  const out: RaciFinding[] = [];

  for (const t of open) {
    if (t.raci.A === null) out.push({ code: 'no-accountable', task: t.id });
    else if (agents.has(t.raci.A)) out.push({ code: 'agent-accountable', task: t.id, actor: t.raci.A });
    if (t.raci.R.length === 0) out.push({ code: 'no-responsible', task: t.id });
  }

  const byPerson = new Map<string, string[]>();
  for (const t of open) {
    const a = t.raci.A;
    if (a === null || agents.has(a)) continue;
    byPerson.set(a, [...(byPerson.get(a) ?? []), t.id]);
  }
  for (const [actor, tasks] of byPerson) {
    if (tasks.length > game.config.raci.accountable_max) {
      out.push({ code: 'accountable-overload', actor, tasks });
    }
  }
  return out;
}
