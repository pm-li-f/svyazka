import type { Layer } from '@svyazka/core';
import type { SheetView } from '@svyazka/engine';
import type { Answer } from '@svyazka/navigator';
import type { SyncResult } from '@svyazka/sources';
import type { StateView } from '../server/state';

export type { Answer, Layer, SheetView, StateView };

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
  act: (kind: string, target?: string, note?: string) => request<{ ok: true }>('POST', '/api/act', { kind, target, note }),
  ask: (question: string, model?: string) => request<Answer>('POST', '/api/navigator/ask', { question, model }),
  prep: (id: string, model?: string) => request<Answer>('POST', '/api/navigator/prep', { id, model }),
  decide: (text: string) => request<{ ok: true }>('POST', '/api/decide', { text }),
  sync: (only?: 'jira' | 'confluence') => request<SyncResult>('POST', '/api/sources/sync', { only }),
};
