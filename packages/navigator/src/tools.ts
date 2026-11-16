import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { Game, Layer } from '@svyazka/core';
import { attentionSplit, budgetLimit, mapView, roster, sheetView, signals, skillMatrix, strategy } from '@svyazka/engine';

/**
 * Оставляет в игре только те слои, которые можно показать модели.
 * Всё, что отдают инструменты, считается уже по урезанной игре: закрытый слой
 * не может попасть в ответ даже косвенно — например, нагрузкой в тексте сигнала.
 */
export function capGame(game: Game, layers: readonly Layer[]): Game {
  const pair = layers.includes('pair');
  const me = layers.includes('me');
  return {
    ...game,
    sheets: pair ? game.sheets : {},
    journals: pair ? game.journals : {},
    privates: me ? game.privates : {},
    // Ходы — это записи самого руководителя: его внимание, решения и то, до чего не дошли руки.
    turns: me ? game.turns : [],
  };
}

const deepest = (layers: readonly Layer[]): Layer => (layers.includes('me') ? 'me' : layers.includes('pair') ? 'pair' : 'team');

/** Инструменты игры для модели. Только чтение: штурман ничего не меняет в папке игры. */
export function gameTools(full: Game, today: string, layers: readonly Layer[]): ToolSet {
  const game = capGame(full, layers);
  const personId = z.string().describe('Идентификатор человека из списка отряда, например mark');
  const none = z.object({});

  return {
    roster: tool({
      description:
        'Отряд: люди и агенты. По людям: роль, тип MBTI, роль по Белбину, статус, нагрузка со слов человека, сколько дней прошло с последнего 1on1 и с обновления листа. По агентам: кто за них отвечает и давность отчёта.',
      inputSchema: none,
      execute: async () => ({ today, ttlDays: game.config.ttl_days, rows: roster(game, today) }),
    }),
    signals: tool({
      description:
        'Сигналы хода: на что стоит потратить внимание. Навык на одном человеке, устаревший контекст, нарушения RACI, потолок внимания, погода. Отсортированы по важности.',
      inputSchema: none,
      execute: async () => signals(game, today),
    }),
    sheet: tool({
      description:
        'Лист одного человека: кто он, ремесло, его переходы; если слой открыт — состояние и нагрузка с его слов, что его движет и гасит, оценки мышления, квест, темы 360, журнал встреч, связи и заметки на полях.',
      inputSchema: z.object({ id: personId }),
      execute: async ({ id }) => {
        if (!game.people.some((p) => p.id === id)) return { error: `Человека «${id}» нет. Есть: ${game.people.map((p) => p.id).join(', ')}.` };
        return sheetView(game, id, today, deepest(layers));
      },
    }),
    tasks: tool({
      description:
        'Открытые переходы (задачи): местность по Кеневину (trail тропа, pass перевал, fog туман, storm шторм), статус, к какому лагерю ведут, сколько дней открыты, кто ведёт и кто отвечает, замечания линтера RACI, разведки и выводы по ним.',
      inputSchema: none,
      execute: async () =>
        mapView(game, today).tasks.map(({ x: _x, y: _y, radius: _r, ...task }) => task),
    }),
    map: tool({
      description:
        'Карта и стратегия: видение, этап цикла, погода (стадия команды по Такману), лагеря маршрута и открытые переходы к каждому, где сейчас отряд, состав и план состава, каких ролей по Белбину нет, трещины (риски).',
      inputSchema: none,
      execute: async () => {
        const view = mapView(game, today);
        return {
          cycle: game.map.cycle,
          weather: game.map.weather,
          target: game.map.target,
          position: { fromCamp: view.route[view.squad.from]?.id ?? null, tasksDone: view.squad.done, tasksTotal: view.squad.total },
          ...strategy(game, view),
        };
      },
    }),
    skills: tool({
      description: 'Матрица ремесла: кто какой навык держит (1 учится, 2 делает сам, 3 учит других) и какие навыки держит один человек или никто.',
      inputSchema: none,
      execute: async () => skillMatrix(game),
    }),
    agents: tool({
      description: 'Агенты отряда: зачем каждый, какой человек за него отвечает, его отчёты с датами.',
      inputSchema: none,
      execute: async () => game.agents,
    }),
    turns: tool({
      description:
        'Последние ходы руководителя: бюджет внимания, на что он тратился, решения и то, до чего не дошли руки; сколько внимания ушло на маршрут. Пусто, если слой «только ты» закрыт.',
      inputSchema: z.object({ last: z.number().int().min(1).max(20).default(5).describe('Сколько последних ходов показать') }),
      execute: async ({ last }) => ({
        turns: [...game.turns].sort((a, b) => b.date.localeCompare(a.date)).slice(0, last),
        attention: attentionSplit(game, today),
        budget: budgetLimit(game, today),
        actionLabels: game.config.labels,
      }),
    }),
  };
}
