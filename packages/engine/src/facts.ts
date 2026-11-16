import type { Game } from '@svyazka/core';
import type { Facts } from './events.js';
import { raciLint } from './raci.js';
import { signals } from './signals.js';
import { currentTurn } from './turn.js';

/** Снимок состояния для сравнения: по двум таким снимкам `events` находит, что произошло. */
export function facts(game: Game, today: string): Facts {
  const label = (id: string) => game.config.labels[id] ?? id;
  const name = (id: string) => game.people.find((p) => p.id === id)?.name;
  const turn = currentTurn(game, today);
  const all = signals(game, today);

  const signalFacts: Facts['signals'] = {};
  for (const s of all) {
    signalFacts[`${s.code}:${s.target}`] ??= { severity: s.severity, code: s.code, target: s.target, subject: name(s.target) ?? label(s.target) };
  }
  const quests: Facts['quests'] = {};
  const sheets: Facts['sheets'] = {};
  for (const [id, sheet] of Object.entries(game.sheets)) {
    if (sheet.quest) quests[id] = { done: sheet.quest.done, steps: sheet.quest.steps };
    if (sheet.sheet_updated) sheets[id] = sheet.sheet_updated;
  }

  return {
    date: today,
    turn: !turn ? 'none' : turn.closed ? 'closed' : 'open',
    budget: turn?.attention.budget ?? null,
    untouched: turn?.untouched.length ?? 0,
    signals: signalFacts,
    storms: Object.fromEntries(game.tasks.filter((t) => t.terrain === 'storm' && t.status !== 'done').map((t) => [t.id, t.title])),
    camps: Object.fromEntries(game.map.camps.filter((c) => c.phase === 'done').map((c) => [c.id, c.name])),
    people: Object.fromEntries(game.people.map((p) => [p.id, p.name])),
    lint: raciLint(game).length,
    quests,
    sheets,
  };
}
