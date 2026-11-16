import { watch } from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createVite } from 'vite';
import { type ApiOptions, createApi } from './api.js';

/** Поднимает локальный сервер «Связки»: API, страницу и поток событий об изменениях в папке игры. */
export async function startServer({ dir, port, today, navigator, sources }: ApiOptions): Promise<Server> {
  const api = createApi({ dir, port, today, ...(navigator ? { navigator } : {}), ...(sources ? { sources } : {}) });

  // Страница узнаёт об изменениях в папке игры и перечитывает состояние:
  // правки из терминала и из Obsidian видны сразу.
  const listeners = new Set<ServerResponse>();
  let timer: NodeJS.Timeout | undefined;
  try {
    watch(dir, { recursive: true }, (_event, file) => {
      if (file && String(file).split(/[\\/]/)[0] === '.git') return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const res of listeners) res.write('data: change\n\n');
      }, 150);
    });
  } catch {
    console.warn('Не удалось следить за папкой игры: страницу придётся обновлять вручную.');
  }

  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const server = createServer();
  const vite = await createVite({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    appType: 'spa',
    server: { middlewareMode: true, hmr: { server } },
  });

  server.on('request', (req, res) => {
    if (req.url === '/api/events' && req.method === 'GET') {
      const host = req.headers.host ?? '';
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
        res.writeHead(403).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      listeners.add(res);
      req.on('close', () => listeners.delete(res));
      return;
    }
    api(req, res)
      .then((handled) => {
        if (!handled) vite.middlewares(req, res, () => res.writeHead(404).end());
      })
      .catch((e) => {
        console.error(e);
        if (!res.headersSent) res.writeHead(500).end();
      });
  });

  // Слушаем только свою машину: данные о людях наружу не отдаются.
  await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));
  return server;
}
