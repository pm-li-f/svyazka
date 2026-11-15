import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { addJournalEntry, loadGame, saveTurn, setLast1on1, type Game, type Person, type Turn } from '@svyazka/core';
import {
  addDecision,
  budgetLimit,
  currentTurn,
  endTurn,
  hasAction,
  recordAction,
  signals,
  startTurn,
  TurnError,
} from '@svyazka/engine';

/**
 * Операции над папкой игры: прочитать, применить правило движка, записать.
 * Возвращают данные, а не текст — оформляют их `sv` и веб-интерфейс, каждый по-своему.
 */

/** Сегодняшняя дата по часам машины, а не по UTC: вечером это разные дни. */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export { initGame, InitError, type InitOptions, type InitPerson } from './init.js';

export interface TurnResult {
  game: Game;
  turn: Turn;
}

export function requireTurn(game: Game, today: string): Turn {
  const turn = currentTurn(game, today);
  if (!turn) throw new TurnError(`Ход на ${today} не начат. Начни его: sv turn start`);
  return turn;
}

export function budgetHint(dir: string, today: string): { usual: number | null; limit: number } {
  return budgetLimit(loadGame(dir), today);
}

export function turnStart(dir: string, today: string, budget?: number): TurnResult & { openSignals: number } {
  const game = loadGame(dir);
  const turn = startTurn(game, today, budget);
  saveTurn(dir, turn);
  return { game, turn, openSignals: signals(game, today).filter((s) => s.severity !== 'info').length };
}

export function turnShow(dir: string, today: string): TurnResult {
  const game = loadGame(dir);
  return { game, turn: requireTurn(game, today) };
}

export function act(dir: string, today: string, kind: string, target?: string, note?: string): TurnResult & { cost: number } {
  const game = loadGame(dir);
  const turn = recordAction(game, requireTurn(game, today), kind, target, note);
  saveTurn(dir, turn);
  return { game, turn, cost: turn.actions.at(-1)?.cost ?? 0 };
}

/** 1on1: списывает внимание, обновляет дату встречи в листе и, если есть заметка, пишет её в журнал. */
export function oneOnOne(dir: string, today: string, id: string, note?: string): TurnResult & { person: Person } {
  const game = loadGame(dir);
  const person = game.people.find((x) => x.id === id);
  if (!person) throw new TurnError(`Человек «${id}» не найден. Есть: ${game.people.map((x) => x.id).join(', ')}.`);
  if (person.is_lead) throw new TurnError('1on1 с самим собой не записываю.');
  const text = note?.trim() || undefined;
  const turn = recordAction(game, requireTurn(game, today), 'one-on-one', id, text);
  setLast1on1(dir, id, today);
  if (text) addJournalEntry(dir, id, { at: today, kind: '1on1', text });
  saveTurn(dir, turn);
  return { game, turn, person };
}

export function decide(dir: string, today: string, text: string): TurnResult {
  const game = loadGame(dir);
  const turn = addDecision(requireTurn(game, today), text);
  saveTurn(dir, turn);
  return { game, turn };
}

/**
 * Открытый лист стоит внимания один раз за ход на человека. Возвращает null, если
 * списывать нечего: ход не начат, закрыт, лист уже читали или у действия нет цены.
 */
export function chargeSheetRead(dir: string, today: string, id: string): (TurnResult & { cost: number }) | null {
  const game = loadGame(dir);
  const turn = currentTurn(game, today);
  if (!turn || turn.closed || hasAction(turn, 'read-sheet', id)) return null;
  if (game.config.action_costs['read-sheet'] === undefined) return null;
  const next = recordAction(game, turn, 'read-sheet', id);
  saveTurn(dir, next);
  return { game, turn: next, cost: next.actions.at(-1)?.cost ?? 0 };
}

/** Один и тот же каталог? Git на Windows отдаёт путь через «/» и с другим регистром буквы диска. */
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const real = realpathSync.native(resolve(p));
    return process.platform === 'win32' ? real.toLowerCase() : real;
  };
  return norm(a) === norm(b);
}

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

/** Коммит в конце хода — это журнал. Коммитим, только если папка игры сама является корнем репозитория. */
function commitTurn(dir: string, date: string): string {
  let top: string;
  try {
    top = git(dir, ['rev-parse', '--show-toplevel']).trim();
  } catch {
    return 'Папка игры не в git: коммит пропущен.';
  }
  if (!samePath(top, dir)) {
    return 'Папка игры лежит внутри другого репозитория: коммит пропущен, чтобы не задеть чужую историю.';
  }
  try {
    git(dir, ['add', '-A']);
    if (!git(dir, ['status', '--porcelain']).trim()) return 'Изменений нет: коммит не нужен.';
    git(dir, ['commit', '-q', '-m', `ход ${date}`]);
    return `Коммит: ход ${date}.`;
  } catch (e) {
    return `Коммит не удался: ${(e as Error).message.split('\n')[0]}`;
  }
}

export function turnEnd(dir: string, today: string, commit = true): TurnResult & { commit: string | null } {
  const game = loadGame(dir);
  const turn = endTurn(game, requireTurn(game, today), today);
  saveTurn(dir, turn);
  return { game, turn, commit: commit ? commitTurn(dir, today) : null };
}
