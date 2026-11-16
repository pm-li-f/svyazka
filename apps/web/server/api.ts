import type { IncomingMessage, ServerResponse } from 'node:http';
import { GameLoadError, Layer, loadGame, type SourceName } from '@svyazka/core';
import { sheetView, TurnError } from '@svyazka/engine';
import { type Keys, NavigatorError, type OpenModel, readKeys, runAsk, runPrep } from '@svyazka/navigator';
import * as ops from '@svyazka/ops';
import { type ConnectOptions, type Creds, readCreds, runSync, SourceError } from '@svyazka/sources';
import { buildState } from './state.js';

export interface ApiOptions {
  dir: string;
  port: number;
  today: () => string;
  /** Подмена модели и ключей штурмана для тестов. */
  navigator?: { open?: OpenModel; keys?: () => Keys };
  /** Подмена входа в источники и сети для тестов. */
  sources?: { creds?: () => Record<SourceName, Creds>; fetch?: ConnectOptions['fetch'] };
}

/** Ошибка запроса с текстом для человека. */
class BadRequest extends Error {}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new BadRequest('Слишком большой запрос.');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try {
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (data && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>;
  } catch {
    /* ниже */
  }
  throw new BadRequest('Тело запроса должно быть объектом JSON.');
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

/**
 * Данные о людях отдаём только своей странице. Проверка Host закрывает подмену
 * адреса через DNS, а обязательный заголовок и JSON в теле не дают чужой странице
 * отправить запись простым запросом: браузер такой запрос без разрешения не пошлёт.
 */
function guard(req: IncomingMessage, port: number): string | null {
  const host = req.headers.host ?? '';
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return 'Запрос с чужого адреса.';
  const origin = req.headers.origin;
  if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
    return 'Запрос с чужой страницы.';
  }
  if (req.method === 'POST') {
    if (req.headers['x-svyazka'] !== '1') return 'Нет заголовка x-svyazka.';
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return 'Нужен JSON.';
  }
  return null;
}

/** Возвращает обработчик: true — запрос был к API и обработан, false — не к API. */
export function createApi({ dir, port, today, navigator, sources }: ApiOptions) {
  const keys = () => (navigator?.keys ?? readKeys)();
  const creds = () => (sources?.creds ?? readCreds)();
  const nav = (model: unknown) => ({ dir, today: today(), modelName: str(model), keys: keys(), ...(navigator?.open ? { open: navigator.open } : {}) });

  return async function api(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (!url.pathname.startsWith('/api/')) return false;

    const denied = guard(req, port);
    if (denied) {
      send(res, 403, { error: denied });
      return true;
    }

    const route = `${req.method} ${url.pathname}`;
    const now = today();
    try {
      let m: RegExpExecArray | null;
      if (route === 'GET /api/state') {
        send(res, 200, buildState(dir, now, keys(), creds()));
      } else if (req.method === 'GET' && (m = /^\/api\/sheet\/([a-z0-9-]+)$/.exec(url.pathname))) {
        const layer = Layer.safeParse(url.searchParams.get('layer') ?? 'me');
        if (!layer.success) throw new BadRequest('layer: team, pair или me.');
        send(res, 200, sheetView(loadGame(dir), m[1] as string, now, layer.data));
      } else if (req.method === 'POST' && (m = /^\/api\/sheet\/([a-z0-9-]+)\/open$/.exec(url.pathname))) {
        const charged = ops.chargeSheetRead(dir, now, m[1] as string);
        send(res, 200, { charged: charged?.cost ?? 0 });
      } else if (route === 'POST /api/turn/start') {
        const body = await readJson(req);
        const budget = body['budget'];
        if (budget !== undefined && budget !== null && !Number.isInteger(budget)) throw new BadRequest('Бюджет — целое число.');
        ops.turnStart(dir, now, typeof budget === 'number' ? budget : undefined);
        send(res, 200, { ok: true });
      } else if (route === 'POST /api/turn/end') {
        const result = ops.turnEnd(dir, now, true);
        send(res, 200, { ok: true, commit: result.commit });
      } else if (route === 'POST /api/1on1') {
        const body = await readJson(req);
        const id = str(body['id']);
        if (!id) throw new BadRequest('Не указано, с кем встреча.');
        ops.oneOnOne(dir, now, id, str(body['note']));
        send(res, 200, { ok: true });
      } else if (route === 'POST /api/act') {
        const body = await readJson(req);
        const kind = str(body['kind']);
        if (!kind) throw new BadRequest('Не указано действие.');
        ops.act(dir, now, kind, str(body['target']), str(body['note']));
        send(res, 200, { ok: true });
      } else if (route === 'POST /api/navigator/ask') {
        const body = await readJson(req);
        send(res, 200, await runAsk(str(body['question']) ?? '', nav(body['model'])));
      } else if (route === 'POST /api/navigator/prep') {
        const body = await readJson(req);
        const id = str(body['id']);
        if (!id) throw new BadRequest('Не указано, к встрече с кем готовиться.');
        send(res, 200, await runPrep(id, nav(body['model'])));
      } else if (route === 'POST /api/sources/sync') {
        const only = (await readJson(req))['only'];
        if (only !== undefined && only !== 'jira' && only !== 'confluence') throw new BadRequest('only: jira или confluence.');
        send(res, 200, await runSync({ dir, today: now, creds: creds(), ...(only ? { only: [only] } : {}), ...(sources?.fetch ? { fetch: sources.fetch } : {}) }));
      } else if (route === 'POST /api/decide') {
        const body = await readJson(req);
        ops.decide(dir, now, str(body['text']) ?? '');
        send(res, 200, { ok: true });
      } else {
        send(res, 404, { error: 'Нет такого адреса.' });
      }
    } catch (e) {
      if (e instanceof BadRequest || e instanceof TurnError || e instanceof GameLoadError || e instanceof NavigatorError || e instanceof SourceError) {
        send(res, 400, { error: e.message });
      } else if (e instanceof Error && /не найден/.test(e.message)) {
        send(res, 404, { error: e.message });
      } else {
        console.error(e);
        send(res, 500, { error: 'Внутренняя ошибка сервера. Подробности — в терминале.' });
      }
    }
    return true;
  };
}
