export type Style = 'natural' | 'paragraphs' | 'bullets';
export interface ApiConfig { baseUrl: string; apiKey: string; transcriptionModel: string; rewriteModel: string; language: string }
export interface NoteRecord { id: string; createdAt: number; durationMs: number; original: string; polished: string | null; style: Style; warning: string | null }
export interface Database { records: NoteRecord[] }
export interface AudioTake { blob: Blob; name: string; durationMs: number; url: string }
