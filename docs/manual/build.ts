/**
 * Сборка руководства игрока: `npm run manual`.
 *
 * Сборщик поднимает игру на копиях примеров, сам проходит по экранам, снимает их
 * и печатает PDF. Текст лежит в manual.md, описания блоков — в screens.ts,
 * пример хода — в story.ts. Снимки и цифры всегда из текущей версии игры.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MockLanguageModelV4 } from 'ai/test';
import { marked } from 'marked';
import { chromium, type Browser, type Page } from 'playwright-core';
import { loadGame } from '@svyazka/core';
import { roster, signals } from '@svyazka/engine';
import { startServer } from '../../apps/web/server/start.js';
import { GAME_STATE, SCREENS, type Screen } from './screens.js';
import { expectText, type Facts, STORY, STORY_DATE, STORY_DAY } from './story.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const out = join(here, 'out');
const img = join(out, 'img');
const WIDTH = 1360;
const MAP_DATE = '2026-11-13';

const block = (id: string) => `[data-block="${id}"]`;
const inline = (text: string) => marked.parseInline(text) as string;
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface Shot {
  file: string;
  /** Размер на экране в пикселях: по нему считается размер на странице. */
  width: number;
  height: number;
}

// ---------------------------------------------------------------- игра на копиях примеров

const temps: string[] = [];
const servers: Server[] = [];

function copyOf(example: string, git = false): string {
  const dir = mkdtempSync(join(tmpdir(), `svyazka-manual-${example}-`));
  temps.push(dir);
  cpSync(join(root, 'examples', example), dir, { recursive: true });
  if (git) {
    // Ход заканчивается коммитом, а он делается только в собственном репозитории папки игры.
    const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    run('init', '-q');
    run('config', 'user.name', 'Связка');
    run('config', 'user.email', 'manual@svyazka.invalid');
    run('add', '-A');
    run('commit', '-q', '-m', 'начало экспедиции');
  }
  return dir;
}

const usage = { inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 0, text: 0, reasoning: undefined } };

/**
 * Подставной штурман. Настоящие модели при сборке не вызываются: ответ на снимке
 * собирается из тех же данных игры, чтобы не расходиться с остальными экранами.
 */
function standInAnswer(dir: string, today: string): string {
  const game = loadGame(dir);
  const people = roster(game, today).filter((r) => r.kind === 'person' && !r.isLead);
  const stalest = [...people].sort((a, b) => (b.daysSince1on1 ?? 999) - (a.daysSince1on1 ?? 999))[0];
  const top = signals(game, today).filter((s) => s.severity === 'crit' || s.severity === 'warn').slice(0, 2);
  return [
    stalest
      ? `Первым — с тем, о ком знание старше всего: ${stalest.name}. ${stalest.daysSince1on1 === null ? 'Встреч ещё не было' : `Последняя встреча была ${stalest.daysSince1on1} дн. назад`}, срок годности контекста — ${game.config.ttl_days} дн.`
      : 'В отряде пока некого спрашивать.',
    '',
    ...top.map((s) => `- ${s.text}`),
    '',
    'Порядок задают давность контекста и сигналы. Это не оценка людей.',
  ].join('\n');
}

async function serve(dir: string, port: number, today: string): Promise<string> {
  const answer = standInAnswer(dir, today);
  servers.push(
    await startServer({
      dir,
      port,
      today: () => today,
      navigator: {
        keys: () => ({ ANTHROPIC_API_KEY: { value: 'stand-in', source: 'file' } }),
        open: () =>
          new MockLanguageModelV4({
            doGenerate: async (options) => {
              const steps = (JSON.stringify(options.prompt).match(/tool-result/g) ?? []).length;
              const call = (toolName: string) => ({
                content: [{ type: 'tool-call' as const, toolCallId: `c${steps}`, toolName, input: '{}' }],
                finishReason: { unified: 'tool-calls' as const, raw: undefined },
                usage,
                warnings: [],
              });
              if (steps === 0) return call('roster');
              if (steps === 1) return call('signals');
              return { content: [{ type: 'text' as const, text: answer }], finishReason: { unified: 'stop' as const, raw: undefined }, usage, warnings: [] };
            },
          }),
      },
    }),
  );
  return `http://127.0.0.1:${port}`;
}

// ---------------------------------------------------------------- снимки

async function open(browser: Browser, base: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => {
    throw new Error(`Ошибка на странице: ${e.message}`);
  });
  await page.goto(`${base}/#/people`);
  await page.locator(block('roster')).waitFor();
  await page.evaluate(() => document.fonts.ready);
  // Нижняя панель на снимках стоит в потоке страницы: иначе она закрывает блоки при съёмке по одному.
  await page.addStyleTag({ content: '.dock { position: static !important; margin: 0 !important; padding: 0 !important; border: none !important; box-shadow: none !important; }' });
  return page;
}

const go = async (page: Page, route: string, wait: string) => {
  await page.goto(`${new URL(page.url()).origin}/#${route}`);
  await page.locator(wait).first().waitFor();
  await page.waitForTimeout(350);
};

async function shoot(page: Page, selector: string, name: string): Promise<Shot> {
  const target = page.locator(selector).first();
  if ((await target.count()) === 0) throw new Error(`На странице ${page.url()} нет блока «${selector}». Его переименовали или убрали: поправь screens.ts или story.ts.`);
  const box = await target.boundingBox();
  if (!box) throw new Error(`Блок «${selector}» не виден на странице ${page.url()}.`);
  const file = `${name}.png`;
  await target.screenshot({ path: join(img, file) });
  return { file, width: box.width, height: box.height };
}

/** Снимок всего экрана с номерами на блоках. */
async function overview(page: Page, screen: Screen): Promise<Shot> {
  await page.evaluate(
    ({ ids }) => {
      const layer = document.createElement('div');
      layer.id = 'manual-badges';
      layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:9999';
      ids.forEach((id, i) => {
        const el = document.querySelector(`[data-block="${id}"]`);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const badge = document.createElement('div');
        badge.textContent = String(i + 1);
        badge.style.cssText = `position:absolute;left:${Math.max(2, r.left + scrollX - 12)}px;top:${Math.max(2, r.top + scrollY - 12)}px;width:26px;height:26px;border-radius:50%;background:#e3b04b;color:#15181b;font:700 14px/26px Inter,sans-serif;text-align:center;box-shadow:0 0 0 2px #15181b`;
        layer.appendChild(badge);
      });
      document.body.appendChild(layer);
    },
    { ids: screen.blocks.map((b) => b.id) },
  );
  const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, height: document.documentElement.scrollHeight }));
  const file = `${screen.id}-screen.png`;
  await page.screenshot({ path: join(img, file), fullPage: true });
  await page.evaluate(() => document.getElementById('manual-badges')?.remove());
  return { file, ...size };
}

interface ScreenShots {
  overview: Shot;
  blocks: Record<string, Shot>;
  extra?: Shot;
}

async function captureScreens(page: Page): Promise<Record<string, ScreenShots>> {
  const shots: Record<string, ScreenShots> = {};

  // Положение дел для снимков: ход начат, записано решение, штурману задан вопрос.
  await page.fill('#budget-top', '8');
  await page.click(`${block('top')} button:has-text("начать ход")`);
  await page.locator('#decision').waitFor();
  await page.fill('#decision', 'Дублёром по базам данных будет Аня: начинаем с парных ревью.');
  await page.click(`${block('decision')} button`);
  await page.locator('#decision').evaluate((el) => (el as HTMLInputElement).value === '');

  for (const screen of SCREENS) {
    await go(page, screen.route, block(screen.blocks.at(-1)?.id ?? 'top'));
    if (screen.id === 'people') {
      await page.fill('#navigator-q', 'С кем поговорить первым?');
      await page.click(`${block('navigator')} button:has-text("спросить")`);
      await page.locator('.navigator-text').waitFor();
    }
    if (screen.id === 'sheet') await expectText(page, block('top'), '7/8');
    await page.waitForTimeout(400);

    const blocks: Record<string, Shot> = {};
    for (const b of screen.blocks) blocks[b.id] = await shoot(page, block(b.id), `${screen.id}-${b.id}`);
    const entry: ScreenShots = { overview: await overview(page, screen), blocks };

    if (screen.id === 'sheet') {
      // Тот же лист глазами отряда: видно, что слои пары и руководителя не показаны.
      await page.click(`${block('sheet-bar')} button:has-text("как видит отряд")`);
      await page.locator(block('sheet-state')).waitFor({ state: 'detached' });
      await page.waitForTimeout(300);
      entry.extra = await shoot(page, '.screen', 'sheet-as-team');
    }
    shots[screen.id] = entry;
  }
  return shots;
}

async function captureStory(page: Page): Promise<{ title: string; text: string; shots: Shot[] }[]> {
  const facts: Facts = {};
  const steps = [];
  for (const [i, step] of STORY.entries()) {
    try {
      await step.run(page, facts);
    } catch (e) {
      throw new Error(`Пример хода, шаг ${i + 1} «${step.title}»: ${(e as Error).message}`);
    }
    await page.waitForTimeout(350);
    const shots = [];
    for (const id of step.shots) shots.push(await shoot(page, block(id), `story-${i + 1}-${id}`));
    steps.push({ title: step.title, text: step.text(facts), shots });
  }
  return steps;
}

// ---------------------------------------------------------------- страница

/** Миллиметров на пиксель экрана: снимок экрана целиком занимает ширину листа. */
const MM = 0.2;

interface Fit {
  /** Крупнее этого снимок не печатается, мм на пиксель. */
  scale?: number;
  /** Рамка на листе, в которую снимок должен поместиться, мм. */
  maxWidth?: number;
  maxHeight?: number;
  caption?: string;
  cls?: string;
}

/** Снимок на листе: в своём масштабе, но не больше рамки, чтобы не рваться между страницами. */
function figure(shot: Shot, { scale = MM, maxWidth = 273, maxHeight = 150, caption, cls = '' }: Fit = {}): string {
  const mm = Math.min(scale, maxWidth / shot.width, maxHeight / shot.height);
  return `<figure class="${cls}"><img src="img/${shot.file}" style="width:${(shot.width * mm).toFixed(1)}mm" alt="${caption ? esc(caption) : ''}">${caption ? `<figcaption>${inline(caption)}</figcaption>` : ''}</figure>`;
}

function screenHtml(screen: Screen, shots: ScreenShots, chapter: number, n: number): string {
  const blocks = screen.blocks
    .map((b, i) => {
      const shot = shots.blocks[b.id] as Shot;
      const wide = shot.width > 640;
      return `<article class="block ${wide ? 'wide' : ''}">
  <header><span class="n">${i + 1}</span><h4>${esc(b.title)}</h4></header>
  ${wide ? figure(shot, { maxHeight: 112 }) : figure(shot, { maxWidth: 104, maxHeight: 104 })}
  <dl>
    <dt>Что показывает</dt><dd>${inline(b.what)}</dd>
    <dt>Откуда данные</dt><dd>${inline(b.source)}</dd>
    <dt>Зачем</dt><dd>${inline(b.why)}</dd>
  </dl>
</article>`;
    })
    .join('\n');
  const actions = screen.actions.map((a) => `<tr><td>${inline(a.act)}</td><td class="cost">${inline(a.cost)}</td><td>${inline(a.effect)}</td></tr>`).join('\n');
  const notes =
    screen.id === 'people'
      ? '<p class="note">Ответ штурмана на снимке — заготовка: при сборке руководства настоящие модели не вызываются. Сборщик составляет её из тех же данных игры, что видны на остальных блоках.</p>'
      : '';
  const extra =
    screen.id === 'sheet' && shots.extra
      ? `<h3>Тот же лист глазами отряда</h3><p>Переключатель «как видит отряд» оставляет только слой отряда: состояние, мотивация, журнал встреч и заметки на полях исчезают целиком, а не закрашиваются.</p>${figure(shots.extra, { cls: 'screen', maxHeight: 128 })}`
      : '';
  return `<section class="screen-chapter">
<h2><span class="num">${chapter}.${n}</span> Экран «${esc(screen.title)}»</h2>
<p class="lead">${inline(screen.lead)}</p>
<div class="overview">
${figure(shots.overview, { caption: `Экран «${screen.title}» целиком.`, cls: 'screen', maxWidth: 196, maxHeight: 146 })}
<div class="legend"><h4>Блоки экрана</h4><ol>${screen.blocks.map((b) => `<li>${esc(b.title)}</li>`).join('')}</ol>
<p>Номера на снимке — те же, что у блоков на следующих страницах. У каждого блока три ответа: что он показывает, откуда берутся данные и зачем он здесь.</p>${notes}</div>
</div>
<h3>Блоки</h3>
<div class="blocks">${blocks}</div>
${extra}
<div class="keep"><h3>Что здесь можно сделать</h3>
<table class="actions"><thead><tr><th>Действие</th><th>Внимание</th><th>Что меняется</th></tr></thead><tbody>${actions}</tbody></table></div>
</section>`;
}

const storyHtml = (steps: { title: string; text: string; shots: Shot[] }[]) =>
  `<ol class="story">${steps
    .map(
      (s) => `<li class="step"><h3>${esc(s.title)}</h3><p>${inline(s.text)}</p><div class="shots">${s.shots.map((shot) => figure(shot, { scale: 0.21, maxWidth: 270, maxHeight: 92 })).join('')}</div></li>`,
    )
    .join('\n')}</ol>`;

const sv = (dir: string, today: string, ...args: string[]) =>
  execFileSync(process.execPath, [join(root, 'bin/sv.mjs'), ...args, '--dir', dir, '--today', today, '--no-color'], { encoding: 'utf8' }).trimEnd();

function page(body: string, cover: Shot, commit: string): string {
  const font = (name: string, file: string) => pathToFileURL(join(root, 'node_modules/@fontsource', name, file)).href;
  const fonts = [
    ...['400', '600', '700'].flatMap((w) => [font('inter', `cyrillic-${w}.css`), font('inter', `latin-${w}.css`)]),
    ...['400', '700'].flatMap((w) => [font('jetbrains-mono', `cyrillic-${w}.css`), font('jetbrains-mono', `latin-${w}.css`)]),
  ];
  const built = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Связка. Руководство игрока</title>
${fonts.map((href) => `<link rel="stylesheet" href="${href}">`).join('\n')}
<link rel="stylesheet" href="../manual.css">
</head><body>
<section class="cover" style="background-image:linear-gradient(rgba(21,24,27,.55),rgba(21,24,27,.92)),url(img/${cover.file})">
  <p class="brand">связка</p>
  <h1 class="title">Руководство игрока</h1>
  <p class="subtitle">Как вести команду разработки, если представить её экспедицией</p>
  <p class="stamp">Версия игры: ${GAME_STATE} · собрано ${built} · коммит ${commit}</p>
</section>
${body}
<section class="colophon">
<h1>Как собрано это руководство</h1>
<p>Руководство собирается из текущей версии игры командой <code>npm run manual</code>. Сборщик поднимает игру на копии примера, проходит по экранам, проживает пример хода и снимает экран после каждого шага. Поэтому снимки и цифры в нём всегда из той версии, что указана на обложке.</p>
<p>Если экран изменился, а описание нет, сборка останавливается и называет блок. Что и где править, написано в <code>docs/manual/README.md</code>.</p>
</section>
</body></html>`;
}

// ---------------------------------------------------------------- сборка

async function build(): Promise<void> {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(img, { recursive: true });

  const screensDir = copyOf('demo');
  const storyDir = copyOf('demo', true);
  const screensBase = await serve(screensDir, 4291, STORY_DATE);
  const storyBase = await serve(storyDir, 4292, STORY_DATE);
  const maps = [
    { example: 'kak-po-maslu', title: 'Всё хорошо', text: 'Погода performing: видно весь маршрут. Отряд прошёл большую часть пути, впереди один перевал и одна тропа.' },
    { example: 'ezhik-v-tumane', title: 'Поиск продукта', text: 'Почти все переходы — туман. Маршрут назван, но не проложен.' },
    { example: 'this-is-fine', title: 'Всё плохо', text: 'Три шторма у самого начала пути, старшему четвёртая неделя. Отряд не сдвинулся от лагеря.' },
  ];

  const executablePath = process.env['CHROME_PATH'];
  const browser = await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' });
  try {
    const screenPage = await open(browser, screensBase);
    const shots = await captureScreens(screenPage);
    console.log(`экраны: ${Object.keys(shots).length}, блоков: ${Object.values(shots).reduce((n, s) => n + Object.keys(s.blocks).length, 0)}`);

    const storyPage = await open(browser, storyBase);
    const steps = await captureStory(storyPage);
    console.log(`пример хода: ${steps.length} шагов`);

    const mapShots: Shot[] = [];
    for (const [i, m] of maps.entries()) {
      const base = await serve(copyOf(m.example), 4293 + i, MAP_DATE);
      const p = await open(browser, base);
      await go(p, '/map', '.map canvas');
      await p.waitForTimeout(500);
      mapShots.push(await shoot(p, block('map'), `map-${m.example}`));
      await p.close();
    }
    const cover = await (async () => {
      await go(screenPage, '/map', '.map canvas');
      await screenPage.waitForTimeout(500);
      return shoot(screenPage, '.map canvas', 'cover');
    })();

    // Текст: вставки заменяются собранными частями.
    const parts: Record<string, (chapter: number) => string> = {
      story: () => storyHtml(steps),
      maps: () =>
        `<div class="keep"><p>Вот три карты из трёх примеров. Правила одни и те же, данные разные.</p><div class="maps">${maps.map((m, i) => `<div>${figure(mapShots[i] as Shot, { maxWidth: 87 })}<h4>${m.title} · <code>${m.example}</code></h4><p>${m.text}</p></div>`).join('')}</div></div>`,
      day: () => STORY_DAY,
      date: () => STORY_DATE,
    };
    SCREENS.forEach((s, i) => (parts[`screen:${s.id}`] = (chapter) => screenHtml(s, shots[s.id] as ScreenShots, chapter, i + 1)));
    parts['cli:roster'] = () => `<pre class="cli">${esc(sv(screensDir, STORY_DATE, 'roster'))}</pre>`;
    parts['cli:signals'] = () => `<pre class="cli">${esc(sv(screensDir, STORY_DATE, 'signals'))}</pre>`;

    const source = readFileSync(join(here, 'manual.md'), 'utf8').replace(/<!--[\s\S]*?-->/, '');
    const unknown = [...source.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => (m[1] as string).trim()).filter((k) => !(k in parts));
    if (unknown.length) throw new Error(`В manual.md есть неизвестные вставки: ${unknown.join(', ')}`);

    let chapter = 0;
    const body = source
      .split(/^(?=# )/m)
      .filter((c) => c.trim())
      .map((text) => {
        chapter += 1;
        // Вставка на отдельной строке — целый блок страницы, внутри строки — слово.
        const pieces = text.split(/^\{\{([^}]+)\}\}\s*$/m);
        const html = pieces
          .map((piece, i) =>
            i % 2 === 1
              ? (parts[piece.trim()] as (c: number) => string)(chapter)
              : (marked.parse(piece.replace(/\{\{([^}]+)\}\}/g, (_, k: string) => (parts[k.trim()] as (c: number) => string)(chapter))) as string),
          )
          .join('\n')
          .replace(/<h1>/, `<h1><span class="num">${chapter}</span> `);
        return `<section class="chapter">${html}</section>`;
      })
      .join('\n');

    let commit = 'нет';
    try {
      commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    } catch {
      // Сборка вне репозитория: на обложке останется «нет».
    }
    writeFileSync(join(out, 'manual.html'), page(body, cover, commit));

    const print = await browser.newPage();
    await print.goto(pathToFileURL(join(out, 'manual.html')).href);
    await print.evaluate(() => document.fonts.ready);
    await print.pdf({
      path: join(out, 'svyazka-manual.pdf'),
      format: 'A4',
      landscape: true,
      printBackground: true,
      tagged: true,
      outline: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;padding:0 12mm;font:8px Inter,Arial,sans-serif;color:#7b8480;display:flex;justify-content:space-between"><span>Связка · руководство игрока</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
      margin: { top: '11mm', bottom: '13mm', left: '12mm', right: '12mm' },
    });
    console.log(`готово: ${join(out, 'svyazka-manual.pdf')}`);
    if (process.argv.includes('--publish')) {
      cpSync(join(out, 'svyazka-manual.pdf'), join(root, 'docs/svyazka-manual.pdf'));
      console.log(`опубликовано: ${join(root, 'docs/svyazka-manual.pdf')}`);
    }
  } finally {
    await browser.close();
  }
}

try {
  await build();
} finally {
  for (const s of servers) s.closeAllConnections?.();
  for (const s of servers) s.close();
  for (const dir of temps) if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
