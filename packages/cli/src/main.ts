import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { GameLoadError, Layer, loadGame } from '@svyazka/core';
import { makePaint } from './format.js';
import { renderRaci, renderRoster, renderSheet, renderSignals, renderSkills } from './render.js';

const HELP = `sv — «Связка» в терминале

  sv roster            отряд: люди и агенты, давность контекста
  sv signals           сигналы хода
  sv raci              матрица RACI и её нарушения
  sv skills            ремесло по отряду и кто его держит
  sv sheet <id>        лист человека

Параметры:
  --dir <путь>         папка игры (по умолчанию $SVYAZKA_DIR или текущая)
  --today <дата>       на какую дату считать давность, ГГГГ-ММ-ДД (по умолчанию сегодня)
  --layer <слой>       для sheet: до какого слоя показывать — team, pair или me (по умолчанию me)
  --no-color           без цвета`;

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
    'no-color': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const [command, arg] = positionals;
if (values.help || !command) {
  console.log(HELP);
  process.exit(command || values.help ? 0 : 2);
}

const today = values.today ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) fail('--today ждёт дату в формате ГГГГ-ММ-ДД');

const layer = Layer.safeParse(values.layer ?? 'me');
if (!layer.success) fail('--layer ждёт team, pair или me');

const dir = resolve(values.dir ?? process.env['SVYAZKA_DIR'] ?? '.');
const paint = makePaint(!values['no-color'] && !process.env['NO_COLOR'] && process.stdout.isTTY === true);

try {
  const game = loadGame(dir);
  switch (command) {
    case 'roster':
      console.log(renderRoster(game, today, paint));
      break;
    case 'signals':
      console.log(renderSignals(game, today, paint));
      break;
    case 'raci':
      console.log(renderRaci(game, paint));
      break;
    case 'skills':
      console.log(renderSkills(game, paint));
      break;
    case 'sheet':
      if (!arg) fail('sv sheet <id>: укажи, чей лист. Доступны: ' + game.people.map((p) => p.id).join(', '));
      console.log(renderSheet(game, arg, today, layer.data, paint));
      break;
    default:
      fail(`неизвестная команда «${command}»\n\n${HELP}`);
  }
} catch (e) {
  if (e instanceof GameLoadError) fail(e.message, 1);
  if (e instanceof Error) fail(e.message, 1);
  throw e;
}
