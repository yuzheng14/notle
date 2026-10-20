export type Style = 'natural' | 'paragraphs' | 'bullets';
export interface RewriteConfig { baseUrl: string; apiKey: string; model: string }
export interface MimoConfig extends RewriteConfig { provider: 'mimo'; language: string }
export interface DoubaoConfig { provider: 'doubao'; baseUrl: string; apiKey: string; appId: string; accessToken: string; resourceId: string; language: string }
export interface ApiConfig { transcription: MimoConfig | DoubaoConfig; rewrite: RewriteConfig }
export interface NoteRecord { id: string; createdAt: number; durationMs: number; original: string; polished: string | null; style: Style; warning: string | null }
export interface Hotword { id: string; term: string; aliases: string[]; enabled: boolean }
export interface Database { records: NoteRecord[]; hotwords: Hotword[] }
export interface AudioTake { blob: Blob; name: string; durationMs: number; url: string }
