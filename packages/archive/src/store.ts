import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** Content-addressed object storage for page snapshots. GCS in production, the local filesystem in dev and tests. */
export interface ArchiveObjectStore {
  /** Stores bytes under `key` unless it already exists. Returns whether it was newly created. */
  put(key: string, bytes: Uint8Array): Promise<"created" | "exists">;
  get(key: string): Promise<Uint8Array | null>;
  /** Removes the object and every stored version of it. Idempotent. */
  deleteAll(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

const KEY_RE = /^[a-z0-9][a-z0-9/._-]{0,200}$/;
export function assertKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes("..") || key.includes("//"))
    throw new Error(`invalid object key: ${key}`);
}

export class LocalFsObjectStore implements ArchiveObjectStore {
  private root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private path(key: string) {
    assertKey(key);
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root)) throw new Error("path escape");
    return p;
  }
  async put(key: string, bytes: Uint8Array) {
    const p = this.path(key);
    if (await this.exists(key)) return "exists";
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes, { flag: "wx" }).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "EEXIST") throw e;
    });
    return "created";
  }
  async get(key: string) {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch {
      return null;
    }
  }
  async deleteAll(key: string) {
    await rm(this.path(key), { force: true });
  }
  async exists(key: string) {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Google Cloud Storage over the JSON API with plain fetch. `token()` returns an access token (metadata server on
 * Cloud Run, ADC locally); the architect supplies it when wiring production. The bucket is versioned, so
 * deleteAll lists every generation of the object and deletes each one.
 */
export class GcsObjectStore implements ArchiveObjectStore {
  constructor(
    private bucket: string,
    private token: () => Promise<string>,
    private fetchImpl: typeof fetch = fetch,
  ) {}
  private async call(url: string, init: RequestInit = {}) {
    return this.fetchImpl(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${await this.token()}` },
    });
  }
  private obj = (key: string) =>
    `https://storage.googleapis.com/storage/v1/b/${this.bucket}/o/${encodeURIComponent(key)}`;
  async put(key: string, bytes: Uint8Array) {
    assertKey(key);
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${this.bucket}/o?uploadType=media&name=${encodeURIComponent(key)}&ifGenerationMatch=0`;
    const res = await this.call(url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes as BodyInit,
    });
    if (res.status === 412) return "exists";
    if (!res.ok) throw new Error(`GCS put failed: ${res.status}`);
    return "created";
  }
  async get(key: string) {
    assertKey(key);
    const res = await this.call(`${this.obj(key)}?alt=media`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GCS get failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  async exists(key: string) {
    assertKey(key);
    const res = await this.call(this.obj(key));
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`GCS exists failed: ${res.status}`);
    return true;
  }
  async deleteAll(key: string) {
    assertKey(key);
    const list = await this.call(
      `https://storage.googleapis.com/storage/v1/b/${this.bucket}/o?versions=true&prefix=${encodeURIComponent(key)}&fields=items(name,generation)`,
    );
    if (!list.ok) throw new Error(`GCS list failed: ${list.status}`);
    const items = ((await list.json()) as { items?: { name: string; generation: string }[] }).items ?? [];
    for (const it of items.filter((i) => i.name === key)) {
      const res = await this.call(`${this.obj(key)}?generation=${it.generation}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`GCS delete failed: ${res.status}`);
    }
  }
}
