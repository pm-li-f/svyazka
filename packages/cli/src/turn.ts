import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { addJournalEntry, loadGame, saveTurn, setLast1on1, type Game, type Turn } from '@svyazka/core';
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
import { type Cell, type Paint, makePaint, table } from './format.js';

/**
 * Команды хода. Каждая читает папку игры, меняет её и возвращает текст для вывода.
 * Правила хода — в движке; здесь только чтение, запись и оформление.
 */

const plain = makePaint(false);
const label = (game: Game, id: string) => game.config.labels[id] ?? id;

function attentionLine(turn: Turn, p: Paint): string {
  const { budget, spent } = turn.attention;
  const left = budget - spent;
  const bar = p.yellow('▮'.repeat(Math.max(0, left))) + '▯'.repeat(Math.min(spent, budget));
  return left >= 0
    ? `внимание ${bar} осталось ${left} из ${budget}`
    : `внимание ${bar} бюджет ${budget} исчерпан, перерасход ${-left}`;
}

function requireTurn(game: Game, today: string): Turn {
  const turn = currentTurn(game, today);
  if (!turn) throw new TurnError(`Ход на ${today} не начат. Начни его: sv turn start`);
  return turn;
}

function renderTurn(game: Game, turn: Turn, p: Paint): string {
  const out = [`${p.bold(`ход · ${turn.date}`)}${turn.closed ? p.dim(' · закрыт') : ''}`, attentionLine(turn, p)];
  if (turn.actions.length) {
    const rows: Cell[][] = turn.actions.map((a) => [label(game, a.kind), a.target ?? '', `−${a.cost}`, a.note ?? '']);
    out.push('', p.dim('действия'), ...table(rows, 3).map((l) => `  ${l}`));
  }
  if (turn.decisions.length) out.push('', p.dim('решения'), ...turn.decisions.map((d) => `  ${d}`));
  if (turn.untouched.length) out.push('', p.dim('до чего не дошёл'), ...turn.untouched.map((u) => `  ${u}`));
  return out.join('\n');
}

export function budgetHint(dir: string, today: string): { usual: number | null; limit: number } {
  return budgetLimit(loadGame(dir), today);
}

export function turnStart(dir: string, today: string, budget?: number, p: Paint = plain): string {
  const game = loadGame(dir);
  const turn = startTurn(game, today, budget);
  saveTurn(dir, turn);
  const open = signals(game, today).filter((s) => s.severity !== 'info').length;
  return [renderTurn(game, turn, p), '', p.dim(`сигналов на сегодня: ${open} · посмотреть: sv signals`)].join('\n');
}

export function turnShow(dir: string, today: string, p: Paint = plain): string {
  const game = loadGame(dir);
  return renderTurn(game, requireTurn(game, today), p);
}

export function act(dir: string, today: string, kind: string, target?: string, note?: string, p: Paint = plain): string {
  const game = loadGame(dir);
  const turn = recordAction(game, requireTurn(game, today), kind, target, note);
  saveTurn(dir, turn);
  const cost = turn.actions.at(-1)?.cost ?? 0;
  return `${label(game, kind)}${target ? ` · ${target}` : ''}: −${cost}\n${attentionLine(turn, p)}`;
}

/** 1on1: списывает внимание, обновляет дату встречи в листе и, если есть заметка, пишет её в журнал. */
export function oneOnOne(dir: string, today: string, id: string, note?: string, p: Paint = plain): string {
  const game = loadGame(dir);
  const person = game.people.find((x) => x.id === id);
  if (!person) throw new TurnError(`Человек «${id}» не найден. Есть: ${game.people.map((x) => x.id).join(', ')}.`);
  if (person.is_lead) throw new TurnError('1on1 с самим собой не записываю.');
  const turn = recordAction(game, requireTurn(game, today), 'one-on-one', id, note);
  setLast1on1(dir, id, today);
  if (note) addJournalEntry(dir, id, { at: today, kind: '1on1', text: note });
  saveTurn(dir, turn);
  const tail = note ? 'Заметка записана в журнал встреч.' : 'Заметку можно добавить флагом --note или прямо в журнал.';
  return [`1on1 · ${person.name}: дата встречи обновлена. ${tail}`, attentionLine(turn, p)].join('\n');
}

export function decide(dir: string, today: string, text: string, p: Paint = plain): string {
  const game = loadGame(dir);
  const turn = addDecision(requireTurn(game, today), text);
  saveTurn(dir, turn);
  return `${p.dim('решение записано:')} ${text.trim()}`;
}

/**
 * Открытый лист стоит внимания один раз за ход на человека. Возвращает строку для
 * вывода или null, если списывать нечего: ход не начат, закрыт или лист уже читали.
 */
export function chargeSheetRead(dir: string, today: string, id: string, p: Paint = plain): string | null {
  const game = loadGame(dir);
  const turn = currentTurn(game, today);
  if (!turn || turn.closed || hasAction(turn, 'read-sheet', id)) return null;
  if (game.config.action_costs['read-sheet'] === undefined) return null;
  const next = recordAction(game, turn, 'read-sheet', id);
  saveTurn(dir, next);
  return p.dim(`${label(game, 'read-sheet')} · ${id}: −${next.actions.at(-1)?.cost ?? 0} · `) + attentionLine(next, p);
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
  if (realpathSync(top) !== realpathSync(dir)) {
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

export function turnEnd(dir: string, today: string, commit = true, p: Paint = plain): string {
  const game = loadGame(dir);
  const turn = endTurn(game, requireTurn(game, today), today);
  saveTurn(dir, turn);
  const out = [renderTurn(game, turn, p)];
  if (commit) out.push('', p.dim(commitTurn(dir, today)));
  return out.join('\n');
}
