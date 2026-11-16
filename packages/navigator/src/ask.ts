import { generateText, isStepCount, type LanguageModel } from 'ai';
import { loadGame, type Game } from '@svyazka/core';
import { type Keys, readKeys } from './keys.js';
import { explain, type ModelSpec, NavigatorError, type OpenModel, openModel, resolveModel } from './models.js';
import { instructions, prepQuestion } from './prompt.js';
import { gameTools } from './tools.js';

export interface Answer {
  text: string;
  /** Какая модель отвечала и какие слои ей были открыты. */
  model: Pick<ModelSpec, 'name' | 'provider' | 'model' | 'layers' | 'sources'>;
  /** Какие инструменты игры она вызывала, по порядку. */
  tools: string[];
  tokens: { input: number | null; output: number | null };
}

/** Сколько шагов модель может сделать: вызовы инструментов и итоговый ответ. */
const MAX_STEPS = 10;
const TIMEOUT_MS = 180_000;

/** Один вопрос штурману. Модель сама берёт данные инструментами игры и отвечает текстом. */
export async function ask(game: Game, today: string, spec: ModelSpec, model: LanguageModel, question: string): Promise<Answer> {
  const text = question.trim();
  if (!text) throw new NavigatorError('Вопрос пустой.');
  try {
    const result = await generateText({
      model,
      instructions: instructions(game, today, spec.layers, spec.sources),
      prompt: text,
      tools: gameTools(game, today, spec.layers, spec.sources),
      stopWhen: isStepCount(MAX_STEPS),
      timeout: TIMEOUT_MS,
      maxRetries: 1,
    });
    const tools = result.steps.flatMap((step) =>
      step.toolCalls.map((call) => {
        const id = (call.input as { id?: unknown } | undefined)?.id;
        return typeof id === 'string' ? `${call.toolName}(${id})` : call.toolName;
      }),
    );
    if (!result.text.trim()) {
      throw new NavigatorError(`«${spec.name}» не дала ответа за ${MAX_STEPS} шагов. Попробуй задать вопрос уже.`);
    }
    return {
      text: result.text.trim(),
      model: { name: spec.name, provider: spec.provider, model: spec.model, layers: spec.layers, sources: spec.sources },
      tools,
      tokens: { input: result.totalUsage.inputTokens ?? null, output: result.totalUsage.outputTokens ?? null },
    };
  } catch (error) {
    throw explain(error, spec);
  }
}

export interface RunOptions {
  dir: string;
  today: string;
  /** Короткое имя модели из настроек. Без него — модель по умолчанию. */
  modelName?: string | undefined;
  /** Подмена для тестов. */
  open?: OpenModel;
  keys?: Keys;
}

/** Читает папку игры и ключи, открывает модель и задаёт вопрос. */
export async function runAsk(question: string, { dir, today, modelName, open = openModel, keys = readKeys() }: RunOptions): Promise<Answer> {
  const game = loadGame(dir);
  const spec = resolveModel(game.config, modelName);
  return ask(game, today, spec, open(spec, keys), question);
}

/** Заметки к 1on1 с человеком. */
export async function runPrep(id: string, { dir, today, modelName, open = openModel, keys = readKeys() }: RunOptions): Promise<Answer> {
  const game = loadGame(dir);
  const person = game.people.find((p) => p.id === id);
  if (!person) throw new NavigatorError(`Человек «${id}» не найден. Есть: ${game.people.map((p) => p.id).join(', ')}.`);
  if (person.is_lead) throw new NavigatorError('Заметки к 1on1 с самим собой не готовлю.');
  const spec = resolveModel(game.config, modelName);
  return ask(game, today, spec, open(spec, keys), prepQuestion(game, id));
}

/** Пробный запрос: ключ подходит, модель существует и отвечает. */
export async function ping(spec: ModelSpec, model: LanguageModel): Promise<void> {
  try {
    await generateText({ model, prompt: 'Ответь одним словом: готов.', maxOutputTokens: 512, timeout: 60_000, maxRetries: 0 });
  } catch (error) {
    throw explain(error, spec);
  }
}
