import { GameLoadError, loadGame } from '@svyazka/core';
import {
  type Answer,
  initKeysFile,
  KEY_VAR,
  keysFile,
  keysFileIsOpen,
  listModels,
  type ModelSpec,
  NavigatorError,
  openModel,
  ping,
  readKeys,
  runAsk,
  runPrep,
  type RunOptions,
} from '@svyazka/navigator';
import { type Cell, makePaint, type Paint, table } from './format.js';

const plain = makePaint(false);

/** Ответ штурмана: кто отвечал и что ему было открыто, сам ответ, что он смотрел. */
export function renderAnswer(a: Answer, p: Paint = plain): string {
  const tokens = a.tokens.input === null ? '' : ` · токены: ${a.tokens.input} → ${a.tokens.output ?? '?'}`;
  return [
    p.dim(`штурман · ${a.model.name} · ${a.model.provider}/${a.model.model} · ушли слои: ${a.model.layers.join(', ') || 'никакие'}`),
    '',
    a.text,
    '',
    p.dim(`смотрел: ${a.tools.join(', ') || 'ничего'}${tokens}`),
  ].join('\n');
}

export const askCmd = async (question: string, options: RunOptions, p: Paint = plain) => renderAnswer(await runAsk(question, options), p);
export const prepCmd = async (id: string, options: RunOptions, p: Paint = plain) => renderAnswer(await runPrep(id, options), p);

/** Модели из настроек игры. Если папку игры прочитать не удалось — список пуст. */
function configured(dir: string): ModelSpec[] {
  try {
    return listModels(loadGame(dir).config);
  } catch (e) {
    if (e instanceof GameLoadError) return [];
    throw e;
  }
}

const OPEN_WITH = { win32: 'notepad', darwin: 'open -e', linux: 'nano' } as const;

/** `sv keys init`: создаёт файл ключей и говорит, как его открыть. */
export function keysInit(p: Paint = plain): string {
  const { path, created } = initKeysFile();
  const editor = OPEN_WITH[process.platform as keyof typeof OPEN_WITH] ?? 'nano';
  return [
    created ? `Файл ключей создан: ${path}` : `Файл ключей уже есть, не трогаю: ${path}`,
    '',
    'Открой его и впиши ключи после знака «=»:',
    `  ${editor} "${path}"`,
    '',
    p.dim('Файл лежит только на этой машине. В репозиторий и в папку игры его не клади.'),
    p.dim('Проверить ключи: sv keys --check'),
  ].join('\n');
}

/** `sv keys`: какие ключи найдены и откуда. Сами ключи не печатаются. */
export async function keysStatus(dir: string, check: boolean, p: Paint = plain): Promise<string> {
  const keys = readKeys();
  const models = configured(dir);
  const rows: Cell[][] = [];
  const subjects: { keyVar: string; label: string; spec: ModelSpec | null }[] = models.length
    ? models.map((m) => ({ keyVar: m.keyVar, label: `${m.name} · ${m.provider}/${m.model}`, spec: m }))
    : Object.entries(KEY_VAR)
        .filter(([provider]) => provider !== 'alibaba')
        .map(([provider, keyVar]) => ({ keyVar, label: provider, spec: null }));

  for (const s of subjects) {
    const found = keys[s.keyVar];
    let state: Cell = found ? { t: `найден · ${found.source === 'env' ? 'переменная окружения' : 'файл'}`, c: p.green } : { t: 'нет', c: p.red };
    let result: Cell = '';
    if (check && found && s.spec) {
      try {
        await ping(s.spec, openModel(s.spec, keys));
        result = { t: 'отвечает', c: p.green };
      } catch (e) {
        if (!(e instanceof NavigatorError)) throw e;
        result = { t: e.message, c: p.red };
      }
    }
    if (check && !s.spec) state = found ? state : { t: 'нет', c: p.red };
    rows.push([{ t: s.keyVar, c: p.bold }, state, s.label, result]);
  }

  const missing = subjects.some((s) => !keys[s.keyVar]);
  return [
    p.dim(`ключи штурмана · файл ${keysFile()}`),
    ...table(rows),
    ...(keysFileIsOpen() ? ['', p.yellow('Файл ключей могут читать другие пользователи этой машины. Закрой его: chmod 600 "' + keysFile() + '"')] : []),
    ...(models.length === 0 ? ['', p.dim('Папка игры не найдена: показаны поставщики по умолчанию. Укажи --dir, чтобы увидеть модели из её настроек.')] : []),
    ...(missing ? ['', p.dim('Чтобы добавить ключ: sv keys init')] : check ? [] : ['', p.dim('Проверить пробным запросом: sv keys --check')]),
  ].join('\n');
}
