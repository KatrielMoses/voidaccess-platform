import type { ArchiveObjectStore } from "./store";

/** One fetched page, as the runner writes it to pages.jsonl.gz: URL, fetch time, hash of the text, SANITISED text. */
export interface PageRecord {
  url: string;
  fetched_at: string;
  content_hash?: string;
  text: string;
}

export interface ArchiveDeps {
  readBundle(runId: string): Promise<unknown>;
  /** null when the runner wrote no pages file (the mock engine): the archive then works from the bundle alone */
  readPages(runId: string): AsyncIterable<PageRecord> | null;
  objectStore: ArchiveObjectStore;
}

export interface ArchiveResult {
  entities: number;
  sources: number;
  observations: number;
  relationships: number;
  pagesStored: number;
  pagesDeduplicated: number;
  pagesDropped: { scan: number; removed: number; invalid: number };
  excerptsDropped: number;
}
