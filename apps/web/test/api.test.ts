import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, describe, expect, it } from 'vitest';
import type { OpenModel } from '@svyazka/navigator';
import { createApi } from '../server/api';
import { buildState } from '../server/state';

const demo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples/demo');
const TODAY = '2026-11-14';

let server: Server | undefined;
let temp: string | undefined;

/** Поднимает API на свободном порту поверх копии примера. */
async function start(navigator?: { open: OpenModel }): Promise<{ base: string; port: number; dir: string }> {
  temp = mkdtempSync(join(tmpdir(), 'svyazka-web-'));
  cpSync(demo, temp, { recursive: true });
  const dir = temp;
  // Порт нужен обработчику заранее, поэтому сначала занимаем его пустым сервером.
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  // Ключи в тестах подставные: настоящий файл ключей и окружение не читаются.
  const api = createApi({ dir, port, today: () => TODAY, navigator: { keys: () => ({ ANTHROPIC_API_KEY: { value: 'sk-test', source: 'file' } }), ...navigator } });
  server = createServer((req, res) => {
    void api(req, res).then((handled) => {
      if (!handled) res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server?.listen(port, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${port}`, port, dir };
}

const post = (base: string, path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-svyazka': '1', ...headers },
    body: JSON.stringify(body),
  });

afterEach(async () => {
  await new Promise((r) => (server ? server.close(r) : r(undefined)));
  server = undefined;
  if (temp) rmSync(temp, { recursive: true, force: true });
  temp = undefined;
});

describe('состояние для экранов', () => {
  it('собирается из папки игры', () => {
    const s = buildState(demo, '2026-11-13');
    expect(s.roster.map((r) => r.id)).toEqual(['you', 'anya', 'lena', 'mark', 'timur', 'prototyper', 'reviewer']);
    expect(s.signals).toHaveLength(8);
    expect(s.targetCamp).toBe('Бета-релиз');
    expect(s.turn?.closed).toBe(true);
    expect(s.stress[0]).toEqual({ id: 'mark', left: 6 });
    expect(s.stress.at(-1)).toEqual({ id: 'timur', left: null });
    expect(s.agents.find((a) => a.id === 'reviewer')?.report?.text).toContain('41 ревью');
  });

  it('несёт карту, стратегию и расход внимания на маршрут', () => {
    const s = buildState(demo, '2026-11-13');
    expect(s.terrain.cells).toHaveLength(s.terrain.rows * s.terrain.detail);
    expect(s.terrain.tasks).toHaveLength(6);
    expect(s.strategy.camps.find((c) => c.isTarget)?.name).toBe('Бета-релиз');
    expect(s.attention).toEqual({ windowDays: 14, turns: 1, spent: 6, route: 3 });
  });

  it('не содержит данных из слоёв пары и CPTO', () => {
    const text = JSON.stringify(buildState(demo, '2026-11-13'));
    for (const s of ['Тяну, но без запаса', 'Просит дублёра', 'Не грузить новым', 'трение о сроках', 'Если взял']) {
      expect(text).not.toContain(s);
    }
  });
});

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
const reply = (text: string) => ({ content: [{ type: 'text' as const, text }], finishReason: { unified: 'stop' as const, raw: undefined }, usage, warnings: [] });

describe('штурман через API', () => {
  it('состояние называет модели и есть ли для них ключ, но не сам ключ', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/state`);
    const text = await res.text();
    const state = JSON.parse(text) as ReturnType<typeof buildState>;
    expect(state.navigator.default).toBe('claude');
    expect(state.navigator.models.map((m) => `${m.name}:${m.ready}`)).toEqual(['claude:true', 'kimi:false']);
    expect(text).not.toContain('sk-test');
  });

  it('вопрос и заметки к 1on1 идут в выбранную модель', async () => {
    const asked: string[] = [];
    const { base } = await start({
      open: (spec) => {
        asked.push(spec.name);
        return new MockLanguageModelV4({ doGenerate: reply(`Отвечает ${spec.name}.`) });
      },
    });
    const ask = await post(base, '/api/navigator/ask', { question: 'Что горит?' });
    expect(ask.status).toBe(200);
    expect(await ask.json()).toMatchObject({ text: 'Отвечает claude.', model: { name: 'claude', layers: ['team', 'pair', 'me'] }, tools: [] });

    const prep = await post(base, '/api/navigator/prep', { id: 'timur', model: 'kimi' });
    expect(await prep.json()).toMatchObject({ text: 'Отвечает kimi.', model: { name: 'kimi', provider: 'moonshotai' } });
    expect(asked).toEqual(['claude', 'kimi']);
  });

  it('без ключа, без вопроса и с чужой страницы штурман не отвечает', async () => {
    const { base, port } = await start();
    const noKey = await post(base, '/api/navigator/ask', { question: 'Что горит?', model: 'kimi' });
    expect(noKey.status).toBe(400);
    expect(((await noKey.json()) as { error: string }).error).toMatch(/Нет ключа MOONSHOT_API_KEY/);
    expect((await post(base, '/api/navigator/prep', {})).status).toBe(400);
    expect((await post(base, '/api/navigator/ask', { question: 'x', model: 'gpt' })).status).toBe(400);
    const foreign = await post(base, '/api/navigator/ask', { question: 'Что горит?' }, { origin: `http://evil.example:${port}` });
    expect(foreign.status).toBe(403);
  });
});

describe('API', () => {
  it('работа над маршрутом записывается в ход и видна на карте', async () => {
    const { base } = await start();
    const state = async () => (await (await fetch(`${base}/api/state`)).json()) as ReturnType<typeof buildState>;
    expect((await post(base, '/api/act', { kind: 'route-block', target: 'beta' })).status).toBe(400);

    await post(base, '/api/turn/start', { budget: 5 });
    const before = (await state()).attention;
    expect((await post(base, '/api/act', { kind: 'route-block', target: 'beta', note: 'Разложил маршрут' })).status).toBe(200);
    const after = await state();
    expect(after.turn?.actions).toEqual([{ kind: 'route-block', cost: 3, target: 'beta', note: 'Разложил маршрут' }]);
    expect(after.attention.route - before.route).toBe(3);
    expect(after.turn?.attention.spent).toBe(3);
  });

  it('проводит ход от начала до конца', async () => {
    const { base } = await start();
    const state = async () => (await (await fetch(`${base}/api/state`)).json()) as ReturnType<typeof buildState>;

    expect((await state()).turn).toBeNull();
    expect((await post(base, '/api/turn/start', { budget: 6 })).status).toBe(200);
    expect((await state()).turn?.attention).toEqual({ budget: 6, spent: 0 });

    // лист стоит внимания один раз
    expect(await (await post(base, '/api/sheet/mark/open')).json()).toEqual({ charged: 1 });
    expect(await (await post(base, '/api/sheet/mark/open')).json()).toEqual({ charged: 0 });

    expect((await post(base, '/api/1on1', { id: 'timur', note: 'Разобрали шторм' })).status).toBe(200);
    const sheet = (await (await fetch(`${base}/api/sheet/timur`)).json()) as { pair: { daysSince1on1: number; journal: { text: string }[] } };
    expect(sheet.pair.daysSince1on1).toBe(0);
    expect(sheet.pair.journal[0]?.text).toBe('Разобрали шторм');

    expect((await post(base, '/api/decide', { text: 'Дублёр — Тимур' })).status).toBe(200);
    const end = (await (await post(base, '/api/turn/end')).json()) as { commit: string };
    expect(end.commit).toMatch(/коммит пропущен/);

    const final = await state();
    expect(final.turn).toMatchObject({ closed: true, attention: { budget: 6, spent: 3 }, decisions: ['Дублёр — Тимур'] });
    expect(final.signals.some((s) => s.code === 'stale-context')).toBe(false);
  });

  it('лист отдаётся по слою', async () => {
    const { base } = await start();
    const team = await (await fetch(`${base}/api/sheet/mark?layer=team`)).text();
    expect(team).toContain('Базы данных');
    expect(team).not.toContain('Тяну, но без запаса');
    expect(team).not.toContain('Не грузить новым');
    const pair = await (await fetch(`${base}/api/sheet/mark?layer=pair`)).text();
    expect(pair).toContain('Тяну, но без запаса');
    expect(pair).not.toContain('Не грузить новым');
    expect((await fetch(`${base}/api/sheet/mark?layer=all`)).status).toBe(400);
    expect((await fetch(`${base}/api/sheet/nobody`)).status).toBe(404);
  });

  it('объясняет ошибки человеку', async () => {
    const { base } = await start();
    const res = await post(base, '/api/turn/start', { budget: 99 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Бюджет 99 выше допустимого 10: потолок 10.' });
    const noTurn = await post(base, '/api/decide', { text: 'рано' });
    expect(((await noTurn.json()) as { error: string }).error).toContain('не начат');
  });

  it('не отвечает чужим страницам и чужим адресам', async () => {
    const { base, port } = await start();
    // запись без обязательного заголовка — так выглядит простой запрос с чужой страницы
    const plain = await fetch(`${base}/api/turn/start`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    expect(plain.status).toBe(403);
    // чужая страница
    expect((await post(base, '/api/turn/start', {}, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await fetch(`${base}/api/state`, { headers: { origin: 'http://evil.example' } })).status).toBe(403);
    // своя страница
    expect((await fetch(`${base}/api/state`, { headers: { origin: `http://localhost:${port}` } })).status).toBe(200);
    // ход так и не начался
    const state = (await (await fetch(`${base}/api/state`)).json()) as { turn: unknown };
    expect(state.turn).toBeNull();
  });
});
