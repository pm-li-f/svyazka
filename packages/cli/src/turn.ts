import type { Game, Turn } from '@svyazka/core';
import * as ops from '@svyazka/ops';
import { type Cell, type Paint, makePaint, table } from './format.js';

/** Команды хода: операции берутся из `@svyazka/ops`, здесь только оформление текстом. */

export { budgetHint } from '@svyazka/ops';

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

export function turnStart(dir: string, today: string, budget?: number, p: Paint = plain): string {
  const { game, turn, openSignals } = ops.turnStart(dir, today, budget);
  return [renderTurn(game, turn, p), '', p.dim(`сигналов на сегодня: ${openSignals} · посмотреть: sv signals`)].join('\n');
}

export function turnShow(dir: string, today: string, p: Paint = plain): string {
  const { game, turn } = ops.turnShow(dir, today);
  return renderTurn(game, turn, p);
}

export function act(dir: string, today: string, kind: string, target?: string, note?: string, p: Paint = plain): string {
  const { game, turn, cost } = ops.act(dir, today, kind, target, note);
  return `${label(game, kind)}${target ? ` · ${target}` : ''}: −${cost}\n${attentionLine(turn, p)}`;
}

export function oneOnOne(dir: string, today: string, id: string, note?: string, p: Paint = plain): string {
  const { turn, person } = ops.oneOnOne(dir, today, id, note);
  const tail = note?.trim()
    ? 'Заметка записана в журнал встреч.'
    : 'Заметку можно добавить флагом --note или прямо в журнал.';
  return [`1on1 · ${person.name}: дата встречи обновлена. ${tail}`, attentionLine(turn, p)].join('\n');
}

export function decide(dir: string, today: string, text: string, p: Paint = plain): string {
  ops.decide(dir, today, text);
  return `${p.dim('решение записано:')} ${text.trim()}`;
}

export function chargeSheetRead(dir: string, today: string, id: string, p: Paint = plain): string | null {
  const res = ops.chargeSheetRead(dir, today, id);
  if (!res) return null;
  return p.dim(`${label(res.game, 'read-sheet')} · ${id}: −${res.cost} · `) + attentionLine(res.turn, p);
}

export function turnEnd(dir: string, today: string, commit = true, p: Paint = plain): string {
  const res = ops.turnEnd(dir, today, commit);
  const out = [renderTurn(res.game, res.turn, p)];
  if (res.commit) out.push('', p.dim(res.commit));
  return out.join('\n');
}
