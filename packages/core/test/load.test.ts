import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { GameLoadError, loadGame, Navigator, saveSnapshot } from '../src/index.js';

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
    expect(g.config.navigator.default).toBe('claude');
    // Старая запись с одной моделью тоже читается.
    expect(Navigator.parse({ provider: 'moonshotai', model: 'kimi-k2.6', cloud_layers: ['team'] })).toEqual({
      default: 'kimi',
      models: { kimi: { provider: 'moonshotai', model: 'kimi-k2.6', layers: ['team'], sources: [] } },
    });
    expect(() => Navigator.parse({ default: 'gpt', models: {} })).toThrow(/такой модели нет/);
    expect(g.config.navigator.models['kimi']).toEqual({ provider: 'moonshotai', model: 'kimi-k3', layers: ['team', 'pair', 'me'], sources: [] });
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

describe('ссылки на источники', () => {
  const issues = (dir: string): string[] => {
    try {
      loadGame(dir);
      return [];
    } catch (e) {
      if (e instanceof GameLoadError) return e.issues.map((i) => `${i.file}: ${i.message}`);
      throw e;
    }
  };

  it('без источников игра та же: настроек, артефактов и снимков нет', () => {
    const g = loadGame(demo);
    expect(g.config.sources).toEqual({ fresh_days: 2 });
    expect(g.artifacts).toEqual([]);
    expect(g.sources).toEqual({});
  });

  it('ссылка перехода — ключ, несколько ключей или свой JQL', () => {
    const dir = copyOfDemo();
    edit(dir, 'team/tasks/billing-migration.md', 'raci:', 'jira: PAY-10\nraci:');
    edit(dir, 'team/tasks/queue-incident.md', 'raci:', 'jira: [OPS-7, OPS-8]\nraci:');
    edit(dir, 'team/tasks/review-policy.md', 'raci:', 'jira: {jql: "project = DOC"}\nraci:');
    const g = loadGame(dir);
    expect(g.tasks.flatMap((t) => (t.jira ? [t.jira] : []))).toEqual(['PAY-10', ['OPS-7', 'OPS-8'], { jql: 'project = DOC' }]);
    edit(dir, 'team/tasks/billing-migration.md', 'jira: PAY-10', 'jira: pay-10');
    expect(issues(dir).join(' ')).toContain('team/tasks/billing-migration.md');
  });

  it('адрес источника — без логина и пароля; пороги берутся по умолчанию', () => {
    const dir = copyOfDemo();
    writeFileSync(join(dir, 'config.yaml'), readFileSync(join(dir, 'config.yaml'), 'utf8') + 'sources:\n  jira:\n    url: https://jira.example.test/jira\n');
    expect(loadGame(dir).config.sources.jira).toEqual({ url: 'https://jira.example.test/jira', auth: 'auto', stale_days: 7, wip_max: 3, blocks_link: 'Blocks', max_issues: 300 });
    edit(dir, 'config.yaml', 'https://jira.example.test/jira', 'https://reader:secret@jira.example.test');
    const found = issues(dir).join(' ');
    expect(found).toContain('логин и пароль в адрес не пишем');
    expect(found).not.toContain('secret');
  });

  it('артефакты: номер страницы читается и числом, повтор id и двойной логин Jira ловятся', () => {
    const dir = copyOfDemo();
    writeFileSync(join(dir, 'team/artifacts.yaml'), 'artifacts:\n  - {id: charter, title: Устав, confluence: 1001}\n  - {id: goals, title: Цели, confluence: "https://wiki.example.test/display/P/G", ttl_days: 90}\n');
    expect(loadGame(dir).artifacts).toEqual([
      { id: 'charter', title: 'Устав', confluence: '1001' },
      { id: 'goals', title: 'Цели', confluence: 'https://wiki.example.test/display/P/G', ttl_days: 90 },
    ]);
    edit(dir, 'team/artifacts.yaml', 'id: goals', 'id: charter');
    edit(dir, 'team/people/mark.md', 'role: backend', 'role: backend\njira: same');
    edit(dir, 'team/people/lena.md', 'name: Лена', 'name: Лена\njira: same');
    expect(issues(dir)).toEqual(['team/artifacts.yaml: идентификатор «charter» встречается дважды', 'team: логин Jira «same» записан у двоих']);
  });

  it('снимок пишется с пометкой, читается обратно, а испорченный называется по имени файла', () => {
    const dir = copyOfDemo();
    saveSnapshot(dir, 'jira', { at: '2026-11-14', tasks: {}, people: { mark: { in_progress: 2, open: 3 } } });
    const file = join(dir, 'team/sources/jira.yaml');
    expect(readFileSync(file, 'utf8').startsWith('# Снимок Jira.')).toBe(true);
    expect(loadGame(dir).sources.jira?.people['mark']).toEqual({ in_progress: 2, open: 3 });
    writeFileSync(file, 'at: вчера\n');
    expect(issues(dir).join(' ')).toContain('team/sources/jira.yaml: at:');
  });
});
