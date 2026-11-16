import { createAnthropic } from '@ai-sdk/anthropic';
import { createMoonshotAI } from '@ai-sdk/moonshotai';
import type { LanguageModel } from 'ai';
import type { Config, Layer, NavigatorModel, SourceName } from '@svyazka/core';
import { KEY_VAR, type Keys } from './keys.js';

/** Ошибка штурмана с текстом для человека. */
export class NavigatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NavigatorError';
  }
}

export interface ModelSpec {
  /** Короткое имя из настроек: `claude`, `kimi`. */
  name: string;
  provider: NavigatorModel['provider'];
  model: string;
  layers: Layer[];
  /** Данные каких источников можно отправлять этой модели. */
  sources: SourceName[];
  baseUrl: string | null;
  keyVar: string;
}

const spec = (name: string, m: NavigatorModel): ModelSpec => ({
  name,
  provider: m.provider,
  model: m.model,
  // Порядок слоёв всегда один и тот же, как бы их ни записали в настройках.
  layers: (['team', 'pair', 'me'] as const).filter((l) => m.layers.includes(l)),
  sources: (['jira', 'confluence'] as const).filter((s) => m.sources.includes(s)),
  baseUrl: m.base_url ?? null,
  keyVar: KEY_VAR[m.provider],
});

export const listModels = (config: Config): ModelSpec[] => Object.entries(config.navigator.models).map(([name, m]) => spec(name, m));

/** Модель по короткому имени; без имени — та, что по умолчанию. */
export function resolveModel(config: Config, name?: string): ModelSpec {
  const wanted = name ?? config.navigator.default;
  const found = config.navigator.models[wanted];
  if (!found) {
    throw new NavigatorError(
      `Модели «${wanted}» нет в настройках штурмана. Есть: ${Object.keys(config.navigator.models).join(', ')}. ` +
        'Добавить модель можно в config.yaml, в раздел navigator.models.',
    );
  }
  return spec(wanted, found);
}

export type OpenModel = (spec: ModelSpec, keys: Keys) => LanguageModel;

/** Подключается к поставщику напрямую, его собственным ключом. Общего шлюза нет. */
export const openModel: OpenModel = (m, keys) => {
  const key = keys[m.keyVar]?.value;
  if (!key) {
    throw new NavigatorError(`Нет ключа ${m.keyVar} для модели «${m.name}». Выполни «sv keys init» и впиши ключ в файл, который она назовёт.`);
  }
  const settings = { apiKey: key, ...(m.baseUrl ? { baseURL: m.baseUrl } : {}) };
  switch (m.provider) {
    case 'anthropic':
      return createAnthropic(settings)(m.model);
    case 'moonshotai':
      return createMoonshotAI(settings)(m.model);
    case 'alibaba':
      throw new NavigatorError('Поставщик alibaba (Qwen) пока не подключён. Сейчас работают anthropic и moonshotai.');
  }
};

/** Превращает ошибку поставщика в объяснение для человека. Ключ в текст не попадает. */
export function explain(error: unknown, m: ModelSpec): NavigatorError {
  if (error instanceof NavigatorError) return error;
  const e = error as { statusCode?: number; message?: string; cause?: { code?: string; message?: string }; name?: string };
  const who = `«${m.name}» (${m.provider})`;
  const status = e?.statusCode;
  if (status === 401) return new NavigatorError(`${who}: ключ ${m.keyVar} не подошёл. Проверь, что он скопирован целиком и выпущен на нужной площадке.`);
  if (status === 403) {
    return new NavigatorError(`${who}: поставщик отказал в доступе (403). Либо у ключа ${m.keyVar} нет прав на эту модель, либо поставщик не работает с твоим регионом или сетью.`);
  }
  if (status === 402) return new NavigatorError(`${who}: на счёте поставщика закончились деньги.`);
  if (status === 404) return new NavigatorError(`${who}: поставщик не знает модель «${m.model}». Проверь название в config.yaml.`);
  if (status === 429) return new NavigatorError(`${who}: превышен лимит запросов или исчерпан баланс. Подожди минуту или проверь счёт.`);
  if (status !== undefined && status >= 500) return new NavigatorError(`${who}: у поставщика сбой (${status}). Попробуй позже.`);
  const text = `${e?.message ?? ''} ${e?.cause?.code ?? ''} ${e?.cause?.message ?? ''}`;
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network/i.test(text)) {
    return new NavigatorError(`${who}: нет связи с поставщиком. Проверь интернет и доступность его адреса из твоей сети.`);
  }
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError' || /timeout|aborted/i.test(text)) {
    return new NavigatorError(`${who}: поставщик не ответил вовремя.`);
  }
  return new NavigatorError(`${who}: ${(e?.message ?? 'неизвестная ошибка').slice(0, 300)}`);
}
