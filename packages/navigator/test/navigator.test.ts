import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, describe, expect, it } from 'vitest';
import { loadGame, type Layer } from '@svyazka/core';
import {
  ask,
  capGame,
  explain,
  gameTools,
  initKeysFile,
  instructions,
  keysFileIsOpen,
  listModels,
  NavigatorError,
  openModel,
  parseKeys,
  readKeys,
  resolveModel,
  runAsk,
  runPrep,
} from '../src/index.js';

const demo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples/demo');
const TODAY = '2026-11-13';
const game = () => loadGame(demo);

/** Строки, которые есть только в слое пары и только в слое руководителя. */
const PAIR_ONLY = ['Тяну, но без запаса', 'Провести три ревью', 'Просит дублёра', 'Если взял'];
const ME_ONLY = ['понимают с полуслова', 'трение о сроках', 'Не грузить новым', 'Обещал дублёра'];
const TURNS_ONLY = ['Дублёр по billing-db'];

const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined } };
const say = (text: string) => ({ content: [{ type: 'text' as const, text }], finishReason: { unified: 'stop' as const, raw: undefined }, usage, warnings: [] });
const call = (toolName: string, input: object, n = 1) => ({
  content: [{ type: 'tool-call' as const, toolCallId: `call-${n}`, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: 'tool-calls' as const, raw: undefined },
  usage,
  warnings: [],
});

let temp: string | undefined;
afterEach(() => {
  if (temp) rmSync(temp, { recursive: true, force: true });
  temp = undefined;
});
const scratch = () => (temp = mkdtempSync(join(tmpdir(), 'svyazka-nav-')));

async function runTool(layers: Layer[], name: string, input: object = {}): Promise<string> {
  const tools = gameTools(game(), TODAY, layers);
  const result = await (tools[name] as { execute: (i: object, o: object) => Promise<unknown> }).execute(input, { toolCallId: 't', messages: [] });
  return JSON.stringify(result);
}

describe('ключи', () => {
  it('разбирает файл: комментарии, export, кавычки, пустые значения', () => {
    expect(parseKeys('# комментарий\nANTHROPIC_API_KEY=sk-ant-1\nexport MOONSHOT_API_KEY="sk-2"\nПУСТО=\nEMPTY=\n\nкривая строка')).toEqual({
      ANTHROPIC_API_KEY: 'sk-ant-1',
      MOONSHOT_API_KEY: 'sk-2',
    });
  });

  it('переменная окружения важнее файла, чужие переменные не читаются', () => {
    const file = join(scratch(), 'keys.env');
    writeFileSync(file, 'ANTHROPIC_API_KEY=from-file\nMOONSHOT_API_KEY=kimi-file\n');
    const keys = readKeys({ ANTHROPIC_API_KEY: 'from-env', PATH: '/bin', AWS_SECRET: 'x' }, file);
    expect(keys['ANTHROPIC_API_KEY']).toEqual({ value: 'from-env', source: 'env' });
    expect(keys['MOONSHOT_API_KEY']).toEqual({ value: 'kimi-file', source: 'file' });
    expect(Object.keys(keys).sort()).toEqual(['ANTHROPIC_API_KEY', 'MOONSHOT_API_KEY']);
  });

  it('без файла и без переменных ключей нет', () => {
    expect(readKeys({}, join(scratch(), 'нет-такого.env'))).toEqual({});
  });

  it('создаёт файл с шаблоном, закрытый от других, и не трогает существующий', () => {
    const file = join(scratch(), '.svyazka', 'keys.env');
    expect(initKeysFile(file)).toEqual({ path: file, created: true });
    expect(readFileSync(file, 'utf8')).toContain('ANTHROPIC_API_KEY=');
    expect(readKeys({}, file)).toEqual({});
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(keysFileIsOpen(file)).toBe(false);
    }
    writeFileSync(file, 'ANTHROPIC_API_KEY=мой\n');
    expect(initKeysFile(file).created).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe('ANTHROPIC_API_KEY=мой\n');
  });
});

describe('модели', () => {
  it('в примере две модели, по умолчанию Claude', () => {
    const config = game().config;
    expect(listModels(config).map((m) => `${m.name}:${m.provider}:${m.model}:${m.keyVar}`)).toEqual([
      'claude:anthropic:claude-sonnet-5-5:ANTHROPIC_API_KEY',
      'kimi:moonshotai:kimi-k3:MOONSHOT_API_KEY',
    ]);
    expect(resolveModel(config).name).toBe('claude');
    expect(resolveModel(config, 'kimi').layers).toEqual(['team', 'pair', 'me']);
  });

  it('незнакомое имя модели объясняется человеку', () => {
    expect(() => resolveModel(game().config, 'gpt')).toThrow(/Модели «gpt» нет.*Есть: claude, kimi/);
  });

  it('без ключа модель не открывается, и в ошибке сказано, что делать', () => {
    const spec = resolveModel(game().config, 'kimi');
    expect(() => openModel(spec, {})).toThrow(/Нет ключа MOONSHOT_API_KEY.*sv keys init/);
    expect(openModel(spec, { MOONSHOT_API_KEY: { value: 'sk-test', source: 'file' } })).toBeDefined();
    expect(openModel(resolveModel(game().config), { ANTHROPIC_API_KEY: { value: 'sk-ant-test', source: 'env' } })).toBeDefined();
  });

  it('ошибки поставщика переводятся на человеческий язык и не содержат ключа', () => {
    const spec = resolveModel(game().config, 'kimi');
    expect(explain({ statusCode: 401, message: 'Invalid key sk-secret' }, spec).message).toMatch(/ключ MOONSHOT_API_KEY не подошёл/);
    expect(explain({ statusCode: 401, message: 'Invalid key sk-secret' }, spec).message).not.toContain('sk-secret');
    expect(explain({ statusCode: 429 }, spec).message).toMatch(/лимит/);
    expect(explain({ statusCode: 403 }, spec).message).toMatch(/отказал в доступе/);
    expect(explain({ statusCode: 404 }, spec).message).toMatch(/не знает модель «kimi-k3»/);
    expect(explain({ message: 'fetch failed', cause: { code: 'ENOTFOUND' } }, spec).message).toMatch(/нет связи/);
    expect(explain(new NavigatorError('своя'), spec).message).toBe('своя');
  });
});

describe('слои', () => {
  it('закрытый слой не попадает ни в один инструмент', async () => {
    const all = async (layers: Layer[]) =>
      (
        await Promise.all([
          runTool(layers, 'roster'),
          runTool(layers, 'signals'),
          runTool(layers, 'sheet', { id: 'mark' }),
          runTool(layers, 'sheet', { id: 'timur' }),
          runTool(layers, 'tasks'),
          runTool(layers, 'map'),
          runTool(layers, 'skills'),
          runTool(layers, 'agents'),
          runTool(layers, 'turns', { last: 5 }),
        ])
      ).join('\n');

    const team = await all(['team']);
    for (const s of [...PAIR_ONLY, ...ME_ONLY, ...TURNS_ONLY]) expect(team, s).not.toContain(s);
    // Нагрузка — слой пары: без него сигнал не называет процент.
    expect(team).not.toMatch(/Нагрузка \d+%/);
    expect(team).toContain('billing-migration');

    const pair = await all(['team', 'pair']);
    for (const s of PAIR_ONLY) expect(pair, s).toContain(s);
    for (const s of [...ME_ONLY, ...TURNS_ONLY]) expect(pair, s).not.toContain(s);

    const full = await all(['team', 'pair', 'me']);
    for (const s of [...PAIR_ONLY, ...ME_ONLY, ...TURNS_ONLY]) expect(full, s).toContain(s);
  });

  it('урезанная игра не меняет исходную', () => {
    const g = game();
    const capped = capGame(g, ['team']);
    expect(capped.sheets).toEqual({});
    expect(capped.turns).toEqual([]);
    expect(Object.keys(g.sheets).length).toBeGreaterThan(0);
    expect(capped.people).toBe(g.people);
  });

  it('инструмент листа объясняет, если человека нет', async () => {
    expect(await runTool(['team', 'pair', 'me'], 'sheet', { id: 'nobody' })).toMatch(/Человека «nobody» нет. Есть: /);
  });

  it('правила называют закрытые слои, чтобы модель не гадала', () => {
    expect(instructions(game(), TODAY, ['team', 'pair', 'me'])).toContain('доступны все слои');
    const text = instructions(game(), TODAY, ['team']);
    expect(text).toContain('Тебе закрыты слои: пара (человек и руководитель); только руководитель');
    expect(text).toContain(`Сегодня ${TODAY}`);
  });
});

describe('источники', () => {
  const withJira = () => loadGame(resolve(demo, '../jira-pomnit-vse'));
  /** Строки, которые есть только в снимках Jira и Confluence. */
  const JIRA_ONLY = ['PAY-14', 'd.contractor', 'jira-stall', 'одновременно в работе'];
  const WIKI_ONLY = ['Цели на квартал', 'wiki.example.test', 'stale-doc'];
  const DAY = '2026-11-14';

  const everything = async (sources: ('jira' | 'confluence')[]): Promise<string> => {
    const tools = gameTools(withJira(), DAY, ['team', 'pair', 'me'], sources);
    const out: string[] = [instructions(withJira(), DAY, ['team', 'pair', 'me'], sources)];
    for (const [name, t] of Object.entries(tools)) {
      const input = name === 'sheet' ? { id: 'mark' } : name === 'turns' ? { last: 5 } : {};
      out.push(JSON.stringify(await (t as { execute: (i: object, o: object) => Promise<unknown> }).execute(input, { toolCallId: 't', messages: [] })));
    }
    return out.join('\n');
  };

  it('в примере источники закрыты обеим моделям', () => {
    expect(listModels(withJira().config).map((m) => [m.name, m.sources])).toEqual([
      ['claude', []],
      ['kimi', []],
    ]);
  });

  it('закрытый источник не попадает ни в один инструмент и ни в один сигнал', async () => {
    const closed = await everything([]);
    for (const text of [...JIRA_ONLY, ...WIKI_ONLY]) expect(closed, text).not.toContain(text);
    expect(closed).toContain('Данные Jira и Confluence тебе не открыты');

    const jira = await everything(['jira']);
    for (const text of JIRA_ONLY) expect(jira, text).toContain(text);
    for (const text of WIKI_ONLY) expect(jira, text).not.toContain(text);

    const both = await everything(['jira', 'confluence']);
    for (const text of [...JIRA_ONLY, ...WIKI_ONLY]) expect(both, text).toContain(text);
    // Заголовки задач модели не уходят даже при открытом источнике: ей хватает ключей и чисел.
    expect(both).not.toContain('Перенос истории подписок');
  });

  it('модели без источников данные Jira не уходят, и ответ это подписывает', async () => {
    const game = withJira();
    const model = new MockLanguageModelV4({ doGenerate: [call('sources', {}), call('signals', {}, 2), call('sheet', { id: 'mark' }, 3), say('По данным игры.')] });
    const answer = await ask(game, DAY, resolveModel(game.config, 'kimi'), model, 'Что с миграцией биллинга?');
    expect(answer.model.sources).toEqual([]);
    const sent = JSON.stringify(model.doGenerateCalls);
    for (const text of [...JIRA_ONLY, ...WIKI_ONLY]) expect(sent, text).not.toContain(text);
    expect(sent).toContain('этой модели не открыты');
  });

  it('открытый источник доходит до модели и назван в подписи', async () => {
    const game = withJira();
    (game.config.navigator.models['claude'] as { sources: string[] }).sources = ['jira'];
    const model = new MockLanguageModelV4({ doGenerate: [call('sources', {}), say('PAY-14 стоит 12 дней.')] });
    const answer = await ask(game, DAY, resolveModel(game.config, 'claude'), model, 'Что стоит?');
    expect(answer.model.sources).toEqual(['jira']);
    expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).toContain('PAY-14');
  });
});

describe('вопрос штурману', () => {
  it('модель берёт данные инструментом и отвечает; видно, что она вызывала', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [call('sheet', { id: 'mark' }), call('signals', {}, 2), say('Марк перегружен: 94% с его слов, 6 дней назад.')] });
    const spec = resolveModel(game().config);
    const answer = await ask(game(), TODAY, spec, model, 'Как Марк?');

    expect(answer.text).toBe('Марк перегружен: 94% с его слов, 6 дней назад.');
    expect(answer.tools).toEqual(['sheet(mark)', 'signals']);
    expect(answer.model).toEqual({ name: 'claude', provider: 'anthropic', model: 'claude-sonnet-5-5', layers: ['team', 'pair', 'me'], sources: [] });
    expect(answer.tokens).toEqual({ input: 30, output: 15 });

    // Модель получила правила, вопрос и набор инструментов только для чтения.
    const first = JSON.stringify(model.doGenerateCalls[0]);
    expect(first).toContain('Ты — штурман');
    expect(first).toContain('Как Марк?');
    expect((model.doGenerateCalls[0]?.tools ?? []).map((t) => t.name).sort()).toEqual(['agents', 'map', 'roster', 'sheet', 'signals', 'skills', 'sources', 'tasks', 'turns']);
    // Вторым шагом ей вернулся лист Марка со всеми слоями.
    const second = JSON.stringify(model.doGenerateCalls[1]?.prompt);
    expect(second).toContain('Тяну, но без запаса');
    expect(second).toContain('Не грузить новым');
  });

  it('модели с закрытыми слоями данные этих слоёв не уходят', async () => {
    const g = game();
    g.config.navigator.models['kimi']!.layers = ['team'];
    const model = new MockLanguageModelV4({ doGenerate: [call('sheet', { id: 'mark' }), call('turns', { last: 5 }, 2), call('signals', {}, 3), say('По открытым данным: ведёт миграцию биллинга.')] });
    const answer = await ask(g, TODAY, resolveModel(g.config, 'kimi'), model, 'Как Марк?');

    expect(answer.model.layers).toEqual(['team']);
    const sent = JSON.stringify(model.doGenerateCalls);
    for (const s of [...PAIR_ONLY, ...ME_ONLY, ...TURNS_ONLY]) expect(sent, s).not.toContain(s);
    expect(sent).toContain('Тебе закрыты слои');
    expect(sent).toContain('billing-migration');
  });

  it('пустой вопрос и пустой ответ объясняются', async () => {
    const spec = resolveModel(game().config);
    await expect(ask(game(), TODAY, spec, new MockLanguageModelV4({ doGenerate: say('x') }), '  ')).rejects.toThrow('Вопрос пустой.');
    await expect(ask(game(), TODAY, spec, new MockLanguageModelV4({ doGenerate: say('') }), 'Вопрос')).rejects.toThrow(/не дала ответа/);
  });

  it('ошибка поставщика доходит до человека понятным текстом', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
      },
    });
    await expect(ask(game(), TODAY, resolveModel(game().config, 'kimi'), model, 'Вопрос')).rejects.toThrow(/«kimi» \(moonshotai\): ключ MOONSHOT_API_KEY не подошёл/);
  });

  it('runAsk читает папку, выбирает модель по имени и передаёт ей ключи', async () => {
    const seen: string[] = [];
    const answer = await runAsk('Что горит?', {
      dir: demo,
      today: TODAY,
      modelName: 'kimi',
      keys: { MOONSHOT_API_KEY: { value: 'sk-test', source: 'file' } },
      open: (spec, keys) => {
        seen.push(`${spec.name}:${keys[spec.keyVar]?.source}`);
        return new MockLanguageModelV4({ doGenerate: say('Шторм в очереди задач.') });
      },
    });
    expect(seen).toEqual(['kimi:file']);
    expect(answer.text).toBe('Шторм в очереди задач.');
  });

  it('runPrep готовит заметки к 1on1: просит четыре блока и называет человека', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [call('sheet', { id: 'timur' }), say('Что изменилось\n- Встреча была 23 дня назад.')] });
    const answer = await runPrep('timur', { dir: demo, today: TODAY, keys: {}, open: () => model });
    expect(answer.tools).toEqual(['sheet(timur)']);
    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    for (const s of ['Тимур', 'Что изменилось', 'Что я обещал', 'О чём спросить', 'Чего я не знаю']) expect(prompt).toContain(s);

    await expect(runPrep('you', { dir: demo, today: TODAY, keys: {}, open: () => model })).rejects.toThrow(/с самим собой/);
    await expect(runPrep('nobody', { dir: demo, today: TODAY, keys: {}, open: () => model })).rejects.toThrow(/не найден/);
  });
});
