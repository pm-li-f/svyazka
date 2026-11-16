import type { Page } from 'playwright-core';

/**
 * Пример хода для руководства. Сборщик проживает его в копии `examples/demo`:
 * каждый шаг — настоящие действия в интерфейсе, снимок экрана и проверки.
 *
 * Если правила игры изменились и шаг больше не даёт описанного результата,
 * проверка падает и называет шаг: текст надо переписать вместе с правилом.
 */

/** День, в который прожит пример: понедельник после последнего хода в примере. */
export const STORY_DATE = '2026-11-16';
export const STORY_DAY = 'понедельник, 16 ноября';

export type Facts = Record<string, string | number>;

export interface Step {
  title: string;
  /** Что делает игрок и что происходит. Может ссылаться на то, что собрали шаги. */
  text: (f: Facts) => string;
  /** Блоки, которые попадут на снимки после шага. */
  shots: string[];
  run: (page: Page, f: Facts) => Promise<void>;
}

const block = (id: string) => `[data-block="${id}"]`;

/** Ждёт, пока в блоке появится текст. Не дождалась — ошибка называет блок и ожидание. */
export async function expectText(page: Page, selector: string, text: string | RegExp): Promise<void> {
  try {
    await page.locator(selector).filter({ hasText: text }).first().waitFor({ timeout: 8000 });
  } catch {
    const actual = await page
      .locator(selector)
      .first()
      .innerText()
      .catch(() => '(блок не найден)');
    throw new Error(`Ожидалось, что в «${selector}» будет «${text}». Сейчас там: ${actual.replace(/\s+/g, ' ').slice(0, 300)}`);
  }
}

const go = async (page: Page, route: string, wait: string) => {
  await page.goto(`${new URL(page.url()).origin}/#${route}`);
  await page.locator(wait).first().waitFor();
};
const signalCount = async (page: Page) => page.locator(`${block('signals')} .rows > li`).count();

export const STORY: Step[] = [
  {
    title: 'Утро: сколько сил на сегодня',
    text: () =>
      'Ход начинается с честного ответа самому себе. Поле в шапке уже подсказывает обычное значение — медиану за две недели. Берём 8 из 10 и нажимаем «начать ход». В шапке появляется счётчик внимания: 8 из 8.',
    shots: ['top'],
    run: async (page) => {
      await go(page, '/people', '#budget-top');
      await page.fill('#budget-top', '8');
      await page.click(`${block('top')} button:has-text("начать ход")`);
      await expectText(page, block('top'), '8/8');
    },
  },
  {
    title: 'Сигналы: что просит внимания',
    text: (f) =>
      `Смотреть можно бесплатно. Сигналов в списке: ${f['signalsBefore']}. Сверху критический — _${f['firstSignal']}_ Ниже есть сигнал про Тимура — _${f['timurSignal']}_ Отсюда и план на день: сначала тот, на ком держится навык, потом тот, о ком мы давно ничего не знаем.`,
    shots: ['signals'],
    run: async (page, f) => {
      f['signalsBefore'] = await signalCount(page);
      f['firstSignal'] = (await page.locator(`${block('signals')} .rows > li .prose`).first().innerText()).trim();
      const timur = page.locator(`${block('signals')} .rows > li`).filter({ hasText: 'stale-context · timur' });
      await timur.first().waitFor({ timeout: 8000 });
      f['timurSignal'] = (await timur.first().locator('.prose').innerText()).trim();
    },
  },
  {
    title: 'Лист Марка: минус 1',
    text: () =>
      'Открываем лист Марка прямо из списка отряда. Это стоит 1 очко, один раз за ход: вернуться к листу сегодня можно бесплатно. Счётчик показывает 7 из 8. На листе видно то, что стоит за сигналом: нагрузка 94% с его слов, а в заметках на полях — обещание найти дублёра.',
    shots: ['top', 'sheet-state', 'sheet-margin'],
    run: async (page) => {
      await page.click(`${block('roster')} a[href="#/sheet/mark"]`);
      await page.locator(block('sheet-state')).waitFor();
      await expectText(page, block('top'), '7/8');
      await expectText(page, block('sheet-state'), '94%');
      await expectText(page, block('sheet-margin'), /дубл/i);
    },
  },
  {
    title: '1on1 с Тимуром: минус 1 и минус 2',
    text: () =>
      'Переходим на лист Тимура (ещё 1 очко, осталось 6) и после разговора записываем встречу: пара строк в журнал и кнопка «записать 1on1». Встреча стоит 2 очка, остаётся 4. Блок 1on1 теперь говорит «Последняя встреча — сегодня», а заметка стоит первой строкой в журнале.',
    shots: ['sheet-oneonone', 'sheet-journal'],
    run: async (page) => {
      await go(page, '/sheet/timur', block('sheet-oneonone'));
      await expectText(page, block('top'), '6/8');
      await page.fill('#note', 'Очередь задач под контролем. Договорились, что на дежурстве его подменяет Аня.');
      await page.click(`${block('sheet-oneonone')} button:has-text("записать 1on1")`);
      await expectText(page, block('top'), '4/8');
      await expectText(page, block('sheet-oneonone'), 'Последняя встреча — сегодня');
      await expectText(page, block('sheet-journal'), 'подменяет Аня');
    },
  },
  {
    title: 'Отряд после встречи',
    text: (f) =>
      `Возвращаемся на экран отряда. Сигналов было ${f['signalsBefore']}, стало ${f['signalsAfter']}: сигнал о протухшем контексте Тимура ушёл сам, отмечать его не пришлось. В его строке в столбце 1ON1 теперь 0d. А вот столбец «лист» у Тимура всё ещё красный: своё состояние обновляет он сам, и за него этого никто не сделает.`,
    shots: ['roster'],
    run: async (page, f) => {
      await go(page, '/people', block('signals'));
      await page.locator(`${block('signals')} .rows > li`).filter({ hasText: 'stale-context · timur' }).waitFor({ state: 'detached', timeout: 8000 });
      f['signalsAfter'] = await signalCount(page);
      if (Number(f['signalsAfter']) >= Number(f['signalsBefore'])) {
        throw new Error(`После 1on1 сигналов должно стать меньше: было ${f['signalsBefore']}, стало ${f['signalsAfter']}.`);
      }
      await expectText(page, `${block('roster')} tr:has(a[href="#/sheet/timur"])`, '0d');
    },
  },
  {
    title: 'Карта: работа над маршрутом, минус 3',
    text: (f) =>
      `Людьми занялись, теперь стратегия. На карте внизу правой колонки записываем, что сделали для маршрута. Это самое дорогое действие: 3 очка. Остаётся 1. Строка «внимание командира» пересчиталась — _${f['attention']}_`,
    shots: ['map-attention'],
    run: async (page, f) => {
      await go(page, '/map', '#route-note');
      await page.fill('#route-note', 'Разложил путь к лагерю 3 на три перехода');
      await page.click(`${block('map-cracks')} button:has-text("записать")`);
      await expectText(page, block('top'), '1/8');
      f['attention'] = (await page.locator(`${block('map-attention')} .soft`).first().innerText()).trim();
    },
  },
  {
    title: 'Решение в журнал',
    text: () =>
      'Вывод дня записываем одной строкой внизу экрана отряда: что решили и почему. Внимания это не стоит. Решение сразу видно в журнале хода.',
    shots: ['turn'],
    run: async (page) => {
      await go(page, '/people', '#decision');
      await page.fill('#decision', 'Дублёром по базам данных будет Аня: начинаем с парных ревью.');
      await page.click(`${block('decision')} button`);
      await go(page, '/turn', block('turn'));
      await expectText(page, block('turn'), 'Дублёром по базам данных будет Аня');
    },
  },
  {
    title: 'Перерасход: игра не мешает',
    text: () =>
      'Осталось 1 очко, а посмотреть хочется ещё два листа. Открываем лист Ани — счётчик на нуле. Открываем лист Лены — и вместо остатка шапка пишет «перерасход 1». Ничего не блокируется: игра не турникет. Но в журнале дня это останется, и через две недели будет видно, часто ли ты обещаешь себе меньше, чем тратишь.',
    shots: ['top'],
    run: async (page) => {
      await go(page, '/sheet/anya', block('sheet-who'));
      await expectText(page, block('top'), '0/8');
      await go(page, '/sheet/lena', block('sheet-who'));
      await expectText(page, block('top'), 'перерасход 1');
    },
  },
  {
    title: 'Вечер: закрыть ход',
    text: (f) =>
      `На экране хода нажимаем «закрыть ход» и подтверждаем. Игра сама дописывает, до чего мы не дошли. Сигналов без внимания осталось: ${f['untouched']}. Это не упрёк, а список на завтра. Последняя строка сообщает о коммите: день записан в историю.`,
    shots: ['turn-untouched'],
    run: async (page, f) => {
      await go(page, '/turn', block('turn'));
      await page.click(`${block('turn')} button:has-text("закрыть ход")`);
      await page.click(`${block('turn')} button:has-text("закрыть"):not(:has-text("ход"))`);
      await expectText(page, block('turn'), 'ход закрыт');
      await expectText(page, block('turn'), /до чего не дошёл · \d+/i);
      f['untouched'] = Number((await page.locator(`${block('turn')} h3:has-text("до чего не дошёл")`).innerText()).replace(/\D+/g, ''));
      f['commit'] = (await page.locator(`${block('turn')} .panel-foot`).innerText()).trim();
      if (!String(f['commit']).includes(STORY_DATE)) throw new Error(`В строке коммита нет даты хода: «${f['commit']}»`);
    },
  },
];
