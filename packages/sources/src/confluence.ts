import { type Connection, SourceError } from './http.js';

/** Confluence Data Center, REST API. Читаем только сведения о странице: кто и когда её менял. */

export interface PageInfo {
  page: string;
  title: string;
  space: string | null;
  updated: string;
  by: string | null;
  version: number;
  url: string;
}

interface RawPage {
  id?: string;
  title?: string;
  space?: { key?: string };
  version?: { number?: number; when?: string; by?: { displayName?: string; username?: string } };
  _links?: { webui?: string; base?: string };
}

export type PageRef = { id: string } | { space: string; title: string };

/**
 * Разбирает, как страница записана в артефакте: номером или ссылкой.
 * Понимает ссылки с `pageId=`, вида `/display/ПРОСТРАНСТВО/Название` и `/spaces/…/pages/номер/…`.
 */
export function pageRef(value: string, base: string): PageRef {
  const text = value.trim();
  if (/^\d+$/.test(text)) return { id: text };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new SourceError('config', `«${text}» — не номер страницы и не ссылка на неё.`);
  }
  if (url.origin !== new URL(base).origin) {
    throw new SourceError('config', `ссылка ведёт на ${url.origin}, а Confluence в config.yaml — ${new URL(base).origin}.`);
  }
  const byId = url.searchParams.get('pageId') ?? /\/pages\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1];
  if (byId && /^\d+$/.test(byId)) return { id: byId };
  const display = /\/display\/([^/]+)\/([^/]+)\/?$/.exec(url.pathname);
  if (display) {
    const decode = (s: string) => decodeURIComponent(s.replace(/\+/g, ' '));
    return { space: decode(display[1] as string), title: decode(display[2] as string) };
  }
  throw new SourceError('config', 'в ссылке не нашёл номер страницы. Открой страницу, выбери «…» → «Сведения о странице» и возьми pageId из адреса.');
}

const info = (raw: RawPage, base: string): PageInfo => {
  const when = raw.version?.when ?? '';
  if (!raw.id || !/^\d{4}-\d{2}-\d{2}/.test(when)) throw new SourceError('server', 'сервер не сообщил, когда страницу меняли.');
  return {
    page: raw.id,
    title: raw.title ?? '',
    space: raw.space?.key ?? null,
    updated: when.slice(0, 10),
    by: raw.version?.by?.displayName ?? raw.version?.by?.username ?? null,
    version: raw.version?.number ?? 1,
    url: base + (raw._links?.webui ?? `/pages/viewpage.action?pageId=${raw.id}`),
  };
};

/** Сведения о странице. Содержимое страницы не читается. */
export async function pageInfo(c: Connection, ref: PageRef): Promise<PageInfo> {
  if ('id' in ref) return info(await c.get<RawPage>(`/rest/api/content/${ref.id}`, { expand: 'version,space' }), c.base);
  const found = await c.get<{ results?: RawPage[] }>('/rest/api/content', { spaceKey: ref.space, title: ref.title, expand: 'version,space', limit: 1 });
  const first = found.results?.[0];
  if (!first) throw new SourceError('not-found', `страницы «${ref.title}» в пространстве ${ref.space} нет, или у пользователя нет к ней доступа.`);
  return info(first, c.base);
}
