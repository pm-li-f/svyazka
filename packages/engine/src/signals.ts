import type { Game } from '@svyazka/core';
import { freshness } from './freshness.js';
import { raciLint } from './raci.js';
import { skillCoverage } from './skills.js';

export type Severity = 'crit' | 'warn' | 'lint' | 'info';

export interface Signal {
  severity: Severity;
  /** Машинный код: spof, stale-context, stale-sheet, raci, weather. */
  code: string;
  /** О ком или о чём сигнал: id человека, навыка или перехода. */
  target: string;
  text: string;
}

const ORDER: Record<Severity, number> = { crit: 0, warn: 1, lint: 2, info: 3 };

/**
 * Сигналы хода: всё, на что стоит потратить внимание. Чистая функция от состояния
 * игры и сегодняшней даты. Сигналы только описывают положение дел — оценок людям
 * здесь нет.
 */
export function signals(game: Game, today: string): Signal[] {
  const out: Signal[] = [];
  const name = (id: string) =>
    game.people.find((p) => p.id === id)?.name ?? game.agents.find((a) => a.id === id)?.name ?? id;
  const label = (id: string) => game.config.labels[id] ?? id;
  const fresh = new Map(freshness(game, today).map((f) => [f.person, f]));

  for (const c of skillCoverage(game)) {
    if (c.none) {
      out.push({ severity: 'warn', code: 'spof', target: c.skill, text: `Навык «${label(c.skill)}» не держит никто.` });
      continue;
    }
    if (!c.single) continue;
    const holder = c.holders[0] as string;
    const sheet = game.sheets[holder];
    const loadKnown = fresh.get(holder)?.stateFresh === true && sheet?.state !== undefined;
    const load = loadKnown ? sheet?.state?.load : undefined;
    const crit = load !== undefined && load >= game.config.signals.load_crit;
    const tail = load !== undefined ? ` Нагрузка ${load}%.` : ' Нагрузка неизвестна: состояние устарело.';
    out.push({
      severity: crit ? 'crit' : 'warn',
      code: 'spof',
      target: c.skill,
      text: `Навык «${label(c.skill)}» держит один человек — ${name(holder)}.${tail}`,
    });
  }

  for (const f of fresh.values()) {
    if (f.stale1on1) {
      out.push({
        severity: 'warn',
        code: 'stale-context',
        target: f.person,
        text:
          f.daysSince1on1 === null
            ? `${name(f.person)}: 1on1 не было ни разу.`
            : `${name(f.person)}: последний 1on1 был ${f.daysSince1on1} дн. назад. Контекст устарел.`,
      });
    }
    if (f.staleSheet) {
      out.push({
        severity: 'warn',
        code: 'stale-sheet',
        target: f.person,
        text:
          f.daysSinceSheet === null
            ? `${name(f.person)}: лист ни разу не обновлялся.`
            : `${name(f.person)}: лист не обновлялся ${f.daysSinceSheet} дн.`,
      });
    }
  }

  for (const r of raciLint(game)) {
    switch (r.code) {
      case 'no-responsible':
        out.push({ severity: 'warn', code: 'raci', target: r.task, text: `${r.task}: никто не ведёт, переход стоит.` });
        break;
      case 'no-accountable':
        out.push({ severity: 'lint', code: 'raci', target: r.task, text: `${r.task}: нет ответственного.` });
        break;
      case 'agent-accountable':
        out.push({
          severity: 'lint',
          code: 'raci',
          target: r.task,
          text: `${r.task}: отвечает ${name(r.actor)}. Агент может вести, отвечает всегда человек.`,
        });
        break;
      case 'accountable-overload':
        out.push({
          severity: 'lint',
          code: 'raci',
          target: r.actor,
          text: `${name(r.actor)} отвечает за ${r.tasks.length} перехода сразу: ${r.tasks.join(', ')}.`,
        });
        break;
    }
  }

  const w = game.map.weather;
  if (w.stage === 'forming' || w.stage === 'storming') {
    out.push({
      severity: 'info',
      code: 'weather',
      target: w.stage,
      text:
        w.stage === 'storming'
          ? 'Погода: storming. Новые правила — только на одну связку, не на весь отряд.'
          : 'Погода: forming. Отряд ещё складывается: договорённости важнее скорости.',
    });
  }

  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}
