import { z } from 'zod';

/**
 * Схема данных игры. Это источник правды о формате: загрузчик, движок,
 * интерфейс и штурман опираются на эти типы.
 *
 * Слой видимости задаётся папкой, а не полем:
 *   team/  — видит отряд
 *   pair/  — человек и CPTO
 *   me/    — только CPTO
 */

export const DateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'дата в формате ГГГГ-ММ-ДД');

export const Id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'идентификатор: латиница в нижнем регистре, цифры, дефис');

/** Ремесло: 1 — учусь, 2 — делаю сам, 3 — учу других. Одна согласованная отметка. */
export const CraftLevel = z.union([z.literal(1), z.literal(2), z.literal(3)]);

/** Оценка «мышление и люди»: 1–5, видна только паре. */
export const Score = z.number().int().min(1).max(5);

// ---------------------------------------------------------------- team/

export const Person = z.strictObject({
  id: Id,
  name: z.string().min(1),
  role: z.string().min(1),
  /** CPTO — тоже человек в отряде, со своим листом. */
  is_lead: z.boolean().default(false),
  joined: DateStr.optional(),
  /** MBTI — язык, чтобы договориться, не основание для решений. */
  mbti: z.string().regex(/^[EI][SN][TF][JP]$/).optional(),
  belbin: z.string().optional(),
  belbin_shadow: z.string().optional(),
  owns: z.array(z.string()).default([]),
  craft: z
    .record(z.string(), z.strictObject({ level: CraftLevel, agreed: DateStr }))
    .default({}),
});

export const Agent = z.strictObject({
  id: Id,
  name: z.string().min(1),
  purpose: z.string().min(1),
  /** За агента всегда отвечает человек. */
  accountable: Id,
  /** Слово агентам: их отчёты. */
  reports: z.array(z.strictObject({ at: DateStr, text: z.string().min(1) })).default([]),
});

/** Местность по Кеневину: тропа — простой, перевал — сложный, туман — запутанный, шторм — хаотичный. */
export const Terrain = z.enum(['trail', 'pass', 'fog', 'storm']);

export const Raci = z.strictObject({
  /** Ведёт участок. Может быть агент. */
  R: z.array(Id).default([]),
  /** Отвечает. Схема допускает любой id или пусто: нарушения ловит линтер, а не загрузчик. */
  A: Id.nullable().default(null),
  /** На связи: спросить до решения. */
  C: z.array(Id).default([]),
  /** В лагере знает: сообщить после. */
  I: z.array(Id).default([]),
});

export const Task = z.strictObject({
  id: Id,
  title: z.string().min(1),
  terrain: Terrain,
  status: z.enum(['planned', 'active', 'blocked', 'done']),
  camp: Id.optional(),
  since: DateStr.optional(),
  note: z.string().optional(),
  raci: Raci,
  /** Разведки: для переходов типа «туман». Это и есть журнал гипотез. */
  probes: z
    .array(z.strictObject({ text: z.string().min(1), outcome: z.string().optional() }))
    .default([]),
});

export const GameMap = z.strictObject({
  vision: z.string().optional(),
  /** Этап цикла PMBOK light: замысел, маршрут, переход, сверка, разбор. */
  cycle: z.enum(['initiating', 'planning', 'executing', 'monitoring', 'closing']),
  target: Id,
  /** Погода — стадия команды по Такману. */
  weather: z.strictObject({
    stage: z.enum(['forming', 'storming', 'norming', 'performing']),
    note: z.string().optional(),
    at: DateStr,
  }),
  camps: z
    .array(
      z.strictObject({
        id: Id,
        name: z.string().min(1),
        phase: z.enum(['done', 'current', 'planned', 'idea']),
        note: z.string().optional(),
      }),
    )
    .min(1),
});

// ---------------------------------------------------------------- pair/

export const Sheet = z.strictObject({
  person: Id,
  /** Состояние заполняет сам человек. Это не оценка: баллов за стресс нет. */
  state: z
    .strictObject({
      energy: z.number().int().min(1).max(5),
      load: z.number().int().min(0).max(100),
      note: z.string().optional(),
      by: Id,
      at: DateStr,
    })
    .optional(),
  last_1on1: DateStr.optional(),
  /** Когда человек сам обновлял свой лист. */
  sheet_updated: DateStr.optional(),
  drives: z.array(z.string()).default([]),
  dampers: z.array(z.string()).default([]),
  thinking: z
    .record(z.string(), z.strictObject({ self: Score, lead: Score, at: DateStr }))
    .default({}),
  quest: z
    .strictObject({
      text: z.string().min(1),
      steps: z.number().int().min(1),
      done: z.number().int().min(0),
    })
    .optional(),
  /** 360: темы текстом, без баллов. */
  review360: z.strictObject({ at: DateStr, themes: z.array(z.string()) }).optional(),
});

export const Journal = z.strictObject({
  person: Id,
  entries: z
    .array(
      z.strictObject({
        at: DateStr,
        kind: z.enum(['1on1', '360', 'note']),
        text: z.string().min(1),
      }),
    )
    .default([]),
});

// ---------------------------------------------------------------- me/

export const Private = z.strictObject({
  person: Id,
  bonds: z
    .array(
      z.strictObject({
        with: Id,
        strength: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        note: z.string().optional(),
      }),
    )
    .default([]),
  /** Заметки на полях. В оценки не попадают. */
  margin: z.array(z.strictObject({ at: DateStr, text: z.string().min(1) })).default([]),
});

// ---------------------------------------------------------------- ход и настройки

export const Turn = z.strictObject({
  date: DateStr,
  attention: z.strictObject({
    budget: z.number().int().min(0).max(10),
    spent: z.number().int().min(0),
  }),
  actions: z
    .array(
      z.strictObject({
        kind: z.string().min(1),
        cost: z.number().int().min(1).max(3),
        target: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .default([]),
  /** Журнал решений: что решил и почему. */
  decisions: z.array(z.string()).default([]),
  /** До чего не дошли руки. */
  untouched: z.array(z.string()).default([]),
});

export const Layer = z.enum(['team', 'pair', 'me']);

export const Config = z.strictObject({
  /** Срок годности контекста о человеке, в днях. */
  ttl_days: z.number().int().min(1),
  attention: z.strictObject({
    cap: z.number().int().min(1).max(10),
    over_usual: z.number().int().min(0),
    window_days: z.number().int().min(1),
  }),
  action_costs: z.record(z.string(), z.number().int().min(1).max(3)),
  raci: z.strictObject({
    /** За сколько активных переходов один человек может отвечать, прежде чем это станет сигналом. */
    accountable_max: z.number().int().min(1),
  }),
  signals: z.strictObject({
    /** Нагрузка, начиная с которой единственный держатель навыка — критический сигнал. */
    load_crit: z.number().int().min(1).max(100),
  }),
  /** Названия для людей: id навыка или качества → подпись по-русски. Без подписи показывается id. */
  labels: z.record(z.string(), z.string()).default({}),
  navigator: z.strictObject({
    provider: z.enum(['anthropic', 'moonshotai', 'alibaba']),
    model: z.string().min(1),
    /** Какие слои можно отправлять облачной модели. В первой версии — все. */
    cloud_layers: z.array(Layer),
  }),
});

// ---------------------------------------------------------------- всё вместе

export type Person = z.infer<typeof Person>;
export type Agent = z.infer<typeof Agent>;
export type Task = z.infer<typeof Task>;
export type GameMap = z.infer<typeof GameMap>;
export type Sheet = z.infer<typeof Sheet>;
export type Journal = z.infer<typeof Journal>;
export type Private = z.infer<typeof Private>;
export type Turn = z.infer<typeof Turn>;
export type Config = z.infer<typeof Config>;
export type Layer = z.infer<typeof Layer>;

export interface Game {
  config: Config;
  map: GameMap;
  people: Person[];
  agents: Agent[];
  tasks: Task[];
  /** Ключ — id человека. */
  sheets: Record<string, Sheet>;
  journals: Record<string, Journal>;
  privates: Record<string, Private>;
  turns: Turn[];
}
