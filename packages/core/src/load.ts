import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';
import {
  Agent,
  Config,
  GameMap,
  Journal,
  Person,
  Private,
  Sheet,
  Task,
  Turn,
  type Game,
} from './schema.js';

export interface Issue {
  file: string;
  message: string;
}

export class GameLoadError extends Error {
  constructor(public readonly issues: Issue[]) {
    super(
      `Папка игры не прошла проверку (${issues.length}):\n` +
        issues.map((i) => `  ${i.file}: ${i.message}`).join('\n'),
    );
    this.name = 'GameLoadError';
  }
}

/** Читает YAML-файл или YAML-шапку Markdown-файла (между строками `---`). */
function readData(path: string): unknown {
  const text = readFileSync(path, 'utf8');
  if (!path.endsWith('.md')) return parseYaml(text);
  const m = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(text);
  if (!m) throw new Error('нет YAML-шапки между строками ---');
  return parseYaml(m[1] ?? '');
}

function listFiles(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext) && statSync(join(dir, f)).isFile())
    .sort()
    .map((f) => join(dir, f));
}

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => statSync(join(dir, f)).isDirectory())
    .sort();
}

/**
 * Загружает папку игры целиком и проверяет её: формат каждого файла и ссылки между ними.
 * Смысловые проверки (RACI без ответственного, протухший контекст) сюда не входят —
 * это работа движка.
 */
export function loadGame(root: string): Game {
  const issues: Issue[] = [];
  const rel = (p: string) => relative(root, p) || p;

  function read<S extends z.ZodType>(path: string, schema: S): z.infer<S> | undefined {
    if (!existsSync(path)) {
      issues.push({ file: rel(path), message: 'файл не найден' });
      return undefined;
    }
    let raw: unknown;
    try {
      raw = readData(path);
    } catch (e) {
      issues.push({ file: rel(path), message: (e as Error).message });
      return undefined;
    }
    const res = schema.safeParse(raw);
    if (!res.success) {
      for (const i of res.error.issues) {
        const where = i.path.length ? `${i.path.join('.')}: ` : '';
        issues.push({ file: rel(path), message: where + i.message });
      }
      return undefined;
    }
    return res.data;
  }

  function readAll<S extends z.ZodType>(dir: string, schema: S): z.infer<S>[] {
    const out: z.infer<S>[] = [];
    for (const f of listFiles(dir, '.md')) {
      const v = read(f, schema);
      if (v !== undefined) out.push(v);
    }
    return out;
  }

  const config = read(join(root, 'config.yaml'), Config);
  const map = read(join(root, 'team', 'map.yaml'), GameMap);
  const people = readAll(join(root, 'team', 'people'), Person);
  const agents = readAll(join(root, 'team', 'agents'), Agent);
  const tasks = readAll(join(root, 'team', 'tasks'), Task);
  const turns = readAll(join(root, 'turns'), Turn);

  const sheets: Record<string, Sheet> = {};
  const journals: Record<string, Journal> = {};
  for (const id of listDirs(join(root, 'pair'))) {
    const sheetPath = join(root, 'pair', id, 'sheet.md');
    const sheet = read(sheetPath, Sheet);
    if (sheet) {
      if (sheet.person !== id) {
        issues.push({ file: rel(sheetPath), message: `person «${sheet.person}» не совпадает с папкой «${id}»` });
      }
      sheets[id] = sheet;
    }
    const journalPath = join(root, 'pair', id, 'journal.md');
    if (existsSync(journalPath)) {
      const journal = read(journalPath, Journal);
      if (journal) journals[id] = journal;
    }
  }

  const privates: Record<string, Private> = {};
  for (const f of listFiles(join(root, 'me'), '.md')) {
    const p = read(f, Private);
    if (p) privates[p.person] = p;
  }

  // ---- ссылки между файлами
  const personIds = new Set(people.map((p) => p.id));
  const agentIds = new Set(agents.map((a) => a.id));
  const actorIds = new Set([...personIds, ...agentIds]);
  const need = (file: string, id: string, set: Set<string>, what: string) => {
    if (!set.has(id)) issues.push({ file, message: `${what}: «${id}» не найден` });
  };

  for (const dup of duplicates([...people.map((p) => p.id), ...agents.map((a) => a.id)])) {
    issues.push({ file: 'team', message: `идентификатор «${dup}» встречается дважды` });
  }
  for (const a of agents) {
    need(`team/agents/${a.id}.md`, a.accountable, personIds, 'accountable (должен быть человек)');
  }
  const campIds = new Set(map?.camps.map((c) => c.id) ?? []);
  if (map) need('team/map.yaml', map.target, campIds, 'target');
  for (const t of tasks) {
    const file = `team/tasks/${t.id}.md`;
    for (const id of [...t.raci.R, ...t.raci.C, ...t.raci.I]) need(file, id, actorIds, 'raci');
    if (t.raci.A) need(file, t.raci.A, actorIds, 'raci.A');
    if (t.camp && map) need(file, t.camp, campIds, 'camp');
  }
  for (const [id, s] of Object.entries(sheets)) {
    need(`pair/${id}/sheet.md`, s.person, personIds, 'person');
    if (s.state) need(`pair/${id}/sheet.md`, s.state.by, personIds, 'state.by');
  }
  for (const [id, j] of Object.entries(journals)) {
    need(`pair/${id}/journal.md`, j.person, personIds, 'person');
  }
  for (const [id, p] of Object.entries(privates)) {
    need(`me/${id}.md`, p.person, personIds, 'person');
    for (const b of p.bonds) need(`me/${id}.md`, b.with, personIds, 'bonds.with');
  }

  if (issues.length || !config || !map) throw new GameLoadError(issues);
  return { config, map, people, agents, tasks, sheets, journals, privates, turns };
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}
