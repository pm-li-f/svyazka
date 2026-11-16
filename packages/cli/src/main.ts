import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { GameLoadError, Layer, loadGame } from '@svyazka/core';
import { NavigatorError } from '@svyazka/navigator';
import { InitError, localToday } from '@svyazka/ops';
import { askInit, parsePerson, runInit } from './init.js';
import { makePaint } from './format.js';
import { renderMap } from './map.js';
import { askCmd, keysInit, keysStatus, prepCmd } from './navigator.js';
import { renderRaci, renderRoster, renderSheet, renderSignals, renderSkills } from './render.js';
import { act, budgetHint, chargeSheetRead, decide, oneOnOne, turnEnd, turnShow, turnStart } from './turn.js';

const HELP = `sv — «Связка» в терминале

Начать
  sv init <путь>            создать новую папку игры: спросит про тебя и команду

Смотреть
  sv web                    веб-интерфейс на http://127.0.0.1:4173
  sv roster                 отряд: люди и агенты, давность контекста
  sv map                    карта: маршрут, местность, состав и трещины
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

Штурман
  sv ask "<вопрос>"         спросить штурмана: он сам возьмёт данные игры и ответит
  sv prep <id>              заметки к 1on1 с человеком
  sv keys                   какие ключи моделей найдены
  sv keys init              создать файл ключей
  sv keys --check           проверить ключи пробным запросом

Параметры
  --dir <путь>              папка игры (по умолчанию $SVYAZKA_DIR или текущая)
  --today <дата>            на какую дату считать, ГГГГ-ММ-ДД (по умолчанию сегодня)
  --budget <число>          для turn start: бюджет внимания
  --note "<текст>"          для 1on1 и act: заметка
  --layer <слой>            для sheet: до какого слоя показывать — team, pair или me
  --peek                    для sheet: посмотреть, не списывая внимание
  --no-commit               для turn end: не делать коммит
  --model <имя>             для ask и prep: какая модель отвечает (имена — в config.yaml)
  --no-color                без цвета

Для sv init без вопросов
  --yes                     не спрашивать, взять значения из флагов
  --lead-name "<имя>"       как тебя зовут
  --person "<id:Имя:роль>"  человек в команде; флаг можно повторять
  --camp "<название>"       ближайшая веха
  --no-git                  не создавать репозиторий`;

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
    yes: { type: 'boolean' },
    'lead-name': { type: 'string' },
    'lead-role': { type: 'string' },
    person: { type: 'string', multiple: true },
    camp: { type: 'string' },
    'no-git': { type: 'boolean' },
    model: { type: 'string' },
    check: { type: 'boolean' },
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

/** Пока модель думает, в терминале должно быть видно, что команда не зависла. В вывод команды строка не попадает. */
function thinking(): void {
  if (process.stderr.isTTY) console.error(paint.dim('штурман думает…'));
}

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
  if (command === 'init') {
    if (!arg) fail('sv init <путь>: укажи, где создать папку игры, например sv init ~/svyazka-game');
    const base = {
      today,
      lead: { id: 'you', name: values['lead-name'] ?? 'Ты', role: values['lead-role'] ?? 'cpto' },
      people: (values.person ?? []).map(parsePerson),
      camp: values.camp ?? 'Первый лагерь',
      git: !values['no-git'],
    };
    const opts = values.yes || !process.stdin.isTTY ? base : await askInit(base);
    console.log(runInit(resolve(arg), opts));
    process.exit(0);
  }
  switch (command) {
    case 'roster':
      console.log(renderRoster(loadGame(dir), today, paint));
      break;
    case 'map':
      console.log(renderMap(loadGame(dir), today, paint));
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
    case 'ask': {
      const question = positionals.slice(1).join(' ');
      if (!question.trim()) fail('sv ask "<вопрос>": напиши, что спросить у штурмана');
      thinking();
      console.log(await askCmd(question, { dir, today, modelName: values.model }, paint));
      break;
    }
    case 'prep':
      if (!arg) fail('sv prep <id>: укажи, к встрече с кем готовиться');
      thinking();
      console.log(await prepCmd(arg, { dir, today, modelName: values.model }, paint));
      break;
    case 'keys':
      if (arg === 'init') console.log(keysInit(paint));
      else if (!arg) console.log(await keysStatus(dir, values.check === true, paint));
      else fail('sv keys [init] [--check]');
      break;
    case 'decide':
      if (!arg) fail('sv decide "<текст>": укажи, что решил и почему');
      console.log(decide(dir, today, positionals.slice(1).join(' '), paint));
      break;
    default:
      fail(`неизвестная команда «${command}»\n\n${HELP}`);
  }
} catch (e) {
  if (e instanceof GameLoadError || e instanceof InitError || e instanceof NavigatorError) fail(e.message, 1);
  if (e instanceof Error) fail(e.message, 1);
  throw e;
}
