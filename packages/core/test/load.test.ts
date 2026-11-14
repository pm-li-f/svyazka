import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { GameLoadError, loadGame } from '../src/index.js';

const demo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples/demo');

const temps: string[] = [];
function copyOfDemo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'svyazka-'));
  cpSync(demo, dir, { recursive: true });
  temps.push(dir);
  return dir;
}
function edit(dir: string, file: string, from: string, to: string) {
  const p = join(dir, file);
  const text = readFileSync(p, 'utf8');
  if (!text.includes(from)) throw new Error(`в ${file} нет строки «${from}»`);
  writeFileSync(p, text.replace(from, to));
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('пример данных', () => {
  it('загружается целиком', () => {
    const g = loadGame(demo);
    expect(g.people.map((p) => p.id).sort()).toEqual(['anya', 'lena', 'mark', 'timur', 'you']);
    expect(g.agents).toHaveLength(2);
    expect(g.tasks).toHaveLength(6);
    expect(g.people.filter((p) => p.is_lead).map((p) => p.id)).toEqual(['you']);
    expect(Object.keys(g.sheets).sort()).toEqual(['anya', 'lena', 'mark', 'timur', 'you']);
    expect(g.config.navigator.cloud_layers).toEqual(['team', 'pair', 'me']);
  });

  it('содержит случаи, которые должен поймать линтер на следующем шаге', () => {
    const g = loadGame(demo);
    const byId = Object.fromEntries(g.tasks.map((t) => [t.id, t]));
    // отвечает агент
    expect(byId['deps-update']?.raci.A).toBe('reviewer');
    // никто не ведёт
    expect(byId['second-rope']?.raci.R).toEqual([]);
    // один человек отвечает за три перехода
    expect(g.tasks.filter((t) => t.raci.A === 'anya')).toHaveLength(3);
  });

  it('ремесло лежит в слое отряда, оценки мышления — в слое пары', () => {
    const g = loadGame(demo);
    const mark = g.people.find((p) => p.id === 'mark');
    expect(mark?.craft['databases']?.level).toBe(3);
    expect(g.sheets['mark']?.thinking['process-vision']).toMatchObject({ self: 4, lead: 2 });
  });
});

describe('проверка папки', () => {
  it('ловит ссылку на несуществующего участника', () => {
    const dir = copyOfDemo();
    edit(dir, 'team/tasks/billing-migration.md', 'R: [mark]', 'R: [nobody]');
    expect(() => loadGame(dir)).toThrow(GameLoadError);
    try {
      loadGame(dir);
    } catch (e) {
      expect((e as GameLoadError).issues).toEqual([
        { file: 'team/tasks/billing-migration.md', message: 'raci: «nobody» не найден' },
      ]);
    }
  });

  it('ловит неверное значение и неизвестное поле', () => {
    const dir = copyOfDemo();
    edit(dir, 'team/tasks/queue-incident.md', 'terrain: storm', 'terrain: swamp\nmood: bad');
    try {
      loadGame(dir);
      expect.unreachable();
    } catch (e) {
      const issues = (e as GameLoadError).issues;
      expect(issues.every((i) => i.file === 'team/tasks/queue-incident.md')).toBe(true);
      expect(issues.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('не даёт назначить агенту ответственным другого агента', () => {
    const dir = copyOfDemo();
    edit(dir, 'team/agents/reviewer.md', 'accountable: anya', 'accountable: prototyper');
    expect(() => loadGame(dir)).toThrow(/accountable/);
  });
});
