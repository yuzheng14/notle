import type { ApiConfig, Database, NoteRecord, AudioTake, Style } from './types';
export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api${path}`, { ...options, signal: AbortSignal.timeout(390_000) }); }
  catch { throw new Error('连接服务失败或等待超时。录音仍在当前页面，可以稍后重试。'); }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `请求失败（${response.status}），请稍后重试。`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const loadState = () => request<Database>('/state');
export function transcribe(take: AudioTake, config: ApiConfig, style: Style): Promise<NoteRecord> {
  const body = new FormData();
  body.append('audio', take.blob, take.name);
  body.append('config', JSON.stringify(config));
  body.append('durationMs', String(Math.round(take.durationMs)));
  body.append('style', style);
  return request('/transcriptions', { method: 'POST', body });
}
export const rewrite = (id: string, config: ApiConfig, style: Style) => request<NoteRecord>(`/records/${encodeURIComponent(id)}/rewrite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config, style }) });
export const deleteRecord = (id: string) => request<void>(`/records/${encodeURIComponent(id)}`, { method: 'DELETE' });
