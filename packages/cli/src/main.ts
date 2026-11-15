import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { GameLoadError, Layer, loadGame } from '@svyazka/core';
import { localToday } from '@svyazka/ops';
import { makePaint } from './format.js';
import { renderRaci, renderRoster, renderSheet, renderSignals, renderSkills } from './render.js';
import { act, budgetHint, chargeSheetRead, decide, oneOnOne, turnEnd, turnShow, turnStart } from './turn.js';

const HELP = `sv — «Связка» в терминале

Смотреть
  sv roster                 отряд: люди и агенты, давность контекста
  sv signals                сигналы хода
  sv raci                   матрица RACI и её нарушения
  sv skills                 ремесло по отряду и кто его держит
  sv sheet <id>             лист человека (в открытом ходе стоит внимания, один раз за ход)

Ход
  sv turn start             утренняя отметка: сколько сил на сегодня
  sv turn                   как идёт ход
  sv 1on1 <id>              записать 1on1: обновляет дату встречи и журнал
  sv act <действие> [цель]  записать другое действие
  sv decide "<текст>"       строка в журнал решений
  sv turn end               закрыть ход: что не успел, коммит

Параметры
  --dir <путь>              папка игры (по умолчанию $SVYAZKA_DIR или текущая)
  --today <дата>            на какую дату считать, ГГГГ-ММ-ДД (по умолчанию сегодня)
  --budget <число>          для turn start: бюджет внимания
  --note "<текст>"          для 1on1 и act: заметка
  --layer <слой>            для sheet: до какого слоя показывать — team, pair или me
  --peek                    для sheet: посмотреть, не списывая внимание
  --no-commit               для turn end: не делать коммит
  --no-color                без цвета`;

function fail(message: string, code = 2): never {
  console.error(message);
  process.exit(code);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: 'string' },
    today: { type: 'string' },
    layer: { type: 'string' },
    budget: { type: 'string' },
    note: { type: 'string' },
    peek: { type: 'boolean' },
    'no-commit': { type: 'boolean' },
    'no-color': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const [command, arg, arg2] = positionals;
if (values.help || !command) {
  console.log(HELP);
  process.exit(command || values.help ? 0 : 2);
}

const today = values.today ?? localToday();
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) fail('--today ждёт дату в формате ГГГГ-ММ-ДД');

const layer = Layer.safeParse(values.layer ?? 'me');
if (!layer.success) fail('--layer ждёт team, pair или me');

const dir = resolve(values.dir ?? process.env['SVYAZKA_DIR'] ?? '.');
const paint = makePaint(!values['no-color'] && !process.env['NO_COLOR'] && process.stdout.isTTY === true);

async function askBudget(): Promise<number | undefined> {
  if (values.budget !== undefined) {
    const n = Number(values.budget);
    if (!Number.isInteger(n)) fail('--budget ждёт целое число');
    return n;
  }
  if (!process.stdin.isTTY) return undefined;
  const { usual, limit } = budgetHint(dir, today);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const hint = usual === null ? `от 0 до ${limit}` : `обычно ${usual}, не больше ${limit}; Enter — как обычно`;
  const answer = (await rl.question(`Сколько сил на сегодня? (${hint}) `)).trim();
  rl.close();
  if (!answer) return undefined;
  const n = Number(answer);
  if (!Number.isInteger(n)) fail('Нужно целое число.');
  return n;
}

try {
  switch (command) {
    case 'roster':
      console.log(renderRoster(loadGame(dir), today, paint));
      break;
    case 'signals':
      console.log(renderSignals(loadGame(dir), today, paint));
      break;
    case 'raci':
      console.log(renderRaci(loadGame(dir), paint));
      break;
    case 'skills':
      console.log(renderSkills(loadGame(dir), paint));
      break;
    case 'sheet': {
      const game = loadGame(dir);
      if (!arg) fail('sv sheet <id>: укажи, чей лист. Есть: ' + game.people.map((p) => p.id).join(', '));
      console.log(renderSheet(game, arg, today, layer.data, paint));
      if (layer.data === 'me' && !values.peek) {
        const charged = chargeSheetRead(dir, today, arg, paint);
        if (charged) console.log('\n' + charged);
      }
      break;
    }
    case 'turn':
      if (arg === 'start') console.log(turnStart(dir, today, await askBudget(), paint));
      else if (arg === 'end') console.log(turnEnd(dir, today, !values['no-commit'], paint));
      else if (!arg) console.log(turnShow(dir, today, paint));
      else fail('sv turn [start|end]');
      break;
    case '1on1':
      if (!arg) fail('sv 1on1 <id>: укажи, с кем была встреча');
      console.log(oneOnOne(dir, today, arg, values.note, paint));
      break;
    case 'act':
      if (!arg) fail('sv act <действие> [цель]: укажи действие');
      console.log(act(dir, today, arg, arg2, values.note, paint));
      break;
    case 'decide':
      if (!arg) fail('sv decide "<текст>": укажи, что решил и почему');
      console.log(decide(dir, today, positionals.slice(1).join(' '), paint));
      break;
    default:
      fail(`неизвестная команда «${command}»\n\n${HELP}`);
  }
} catch (e) {
  if (e instanceof GameLoadError) fail(e.message, 1);
  if (e instanceof Error) fail(e.message, 1);
  throw e;
}
