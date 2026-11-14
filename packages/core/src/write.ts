import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type Document, isSeq, parseDocument, stringify } from 'yaml';
import { Journal, Turn } from './schema.js';

/**
 * Запись в папку игры. Правим только YAML-шапку: свободные заметки под ней и
 * комментарии внутри шапки сохраняются, потому что файлы редактируют и руками.
 */

/** Строки не переносим: длинный текст остаётся одной строкой, а уже написанное руками не переформатируется. */
const YAML_OUT = { lineWidth: 0, flowCollectionPadding: false } as const;

const HEAD = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function split(text: string): { yaml: string; body: string } {
  const m = HEAD.exec(text);
  if (!m) throw new Error('нет YAML-шапки между строками ---');
  return { yaml: m[1] ?? '', body: text.slice(m[0].length) };
}

function compose(yaml: string, body: string): string {
  return `---\n${yaml.endsWith('\n') ? yaml : yaml + '\n'}---\n${body}`;
}

function update(path: string, change: (doc: Document) => void): void {
  const { yaml, body } = split(readFileSync(path, 'utf8'));
  const doc = parseDocument(yaml);
  change(doc);
  writeFileSync(path, compose(doc.toString(YAML_OUT), body));
}

/** Сохраняет ход в `turns/<дата>.md`. Заметки под шапкой, если файл уже был, остаются. */
export function saveTurn(root: string, turn: Turn): void {
  const data = Turn.parse(turn);
  const path = join(root, 'turns', `${data.date}.md`);
  mkdirSync(dirname(path), { recursive: true });
  const body = existsSync(path) ? split(readFileSync(path, 'utf8')).body : '';
  writeFileSync(path, compose(stringify(data, YAML_OUT), body));
}

/** Отмечает дату последнего 1on1 в листе человека. */
export function setLast1on1(root: string, person: string, date: string): void {
  const path = join(root, 'pair', person, 'sheet.md');
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, compose(stringify({ person, last_1on1: date }, YAML_OUT), ''));
    return;
  }
  update(path, (doc) => doc.set('last_1on1', date));
}

/** Добавляет запись в начало журнала встреч. Создаёт журнал, если его ещё нет. */
export function addJournalEntry(
  root: string,
  person: string,
  entry: { at: string; kind: '1on1' | '360' | 'note'; text: string },
): void {
  const path = join(root, 'pair', person, 'journal.md');
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, compose(stringify(Journal.parse({ person, entries: [entry] }), YAML_OUT), ''));
    return;
  }
  update(path, (doc) => {
    const entries = doc.get('entries');
    if (isSeq(entries)) entries.items.unshift(doc.createNode(entry));
    else doc.set('entries', [entry]);
  });
}
