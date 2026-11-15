import type { Layer } from '@svyazka/core';
import type { SheetView } from '@svyazka/engine';
import type { StateView } from '../server/state';

export type { Layer, SheetView, StateView };

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: method === 'POST' ? { 'content-type': 'application/json', 'x-svyazka': '1' } : undefined,
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Сервер ответил ${res.status}.`);
  return data as T;
}

export const api = {
  state: () => request<StateView>('GET', '/api/state'),
  sheet: (id: string, layer: Layer) => request<SheetView>('GET', `/api/sheet/${id}?layer=${layer}`),
  openSheet: (id: string) => request<{ charged: number }>('POST', `/api/sheet/${id}/open`),
  startTurn: (budget?: number) => request<{ ok: true }>('POST', '/api/turn/start', { budget }),
  endTurn: () => request<{ ok: true; commit: string | null }>('POST', '/api/turn/end'),
  oneOnOne: (id: string, note: string) => request<{ ok: true }>('POST', '/api/1on1', { id, note }),
  decide: (text: string) => request<{ ok: true }>('POST', '/api/decide', { text }),
};
