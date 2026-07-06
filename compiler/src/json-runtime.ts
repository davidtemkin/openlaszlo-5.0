// json-runtime.ts — the JSON databinding micro-runtime (spec: docs/superpowers/
// specs/2026-07-06-json-databinding-design.md, "Runtime components"). Authored
// here so the parser is shared with the compiler; bundled to
// startup/lz-json-data.js (IIFE) by `npm run bundle:jsondata` and prepended to
// the app blob by laszlo-dom.js. Every environment touchpoint (LzNode
// prototype, fetch, WebSocket, timers, window globals) is injected via
// RuntimeHost so the whole runtime is node-testable.

import { parsePath, evaluatePath, resolvePointer, hasFanout, ParsedPath, JsonPathError } from "./json-path.js";

export interface WsLike {
  send(s: string): void; close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: (() => void) | null;
}
export interface RuntimeHost {
  lzNodeProto: any;
  warn(msg: string): void;
  fetchFn?: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
  makeSocket?: (url: string) => WsLike;
  setTimeoutFn?: (cb: () => void, ms: number) => any;
  globals?: any; // window-ish: lz, canvas, LzDataElement (bridge)
}

export class JsonDataset {
  data: any = null;
  ready = false;
  private dataCbs = new Set<() => void>();
  private errCbs = new Set<(msg: string) => void>();
  constructor(public name: string, private host: RuntimeHost, public shape?: string) {}
  onData(cb: () => void): void { this.dataCbs.add(cb); }
  offData(cb: () => void): void { this.dataCbs.delete(cb); }
  onError(cb: (msg: string) => void): void { this.errCbs.add(cb); }
  fireError(msg: string): void { this.host.warn(`dataset "${this.name}": ${msg}`); for (const cb of [...this.errCbs]) cb(msg); }
  setData(v: any): void { this.data = v; this.ready = true; for (const cb of [...this.dataCbs]) cb(); }
  updateData(pointer: string, value: any): boolean {
    const r = resolvePointer(this.data, pointer);
    if (!r) { this.host.warn(`dataset "${this.name}": updateData("${pointer}") resolves nothing`); return false; }
    r.parent[r.key] = value;
    for (const cb of [...this.dataCbs]) cb();
    return true;
  }
  // toLzDataset(name?, opts?) — Task 12
}

export class JsonRegistry {
  private datasets = new Map<string, JsonDataset>();
  private pending = new Map<string, Array<(ds: JsonDataset) => void>>();
  constructor(private host: RuntimeHost) {}
  get(name: string): JsonDataset | undefined { return this.datasets.get(name); }
  whenRegistered(name: string, cb: (ds: JsonDataset) => void): void {
    const ds = this.datasets.get(name);
    if (ds) { cb(ds); return; }
    const q = this.pending.get(name) ?? [];
    q.push(cb);
    this.pending.set(name, q);
  }
  register(name: string, init: { json?: any; src?: string; ws?: string }): JsonDataset {
    const ds = new JsonDataset(name, this.host);
    this.datasets.set(name, ds);
    if ("json" in init) ds.setData(init.json);
    else if (init.src != null) this.fetchInto(ds, init.src);
    else if (init.ws != null) this.liveInto(ds, init.ws); // Task 9
    for (const cb of this.pending.get(name) ?? []) cb(ds);
    this.pending.delete(name);
    return ds;
  }
  private fetchInto(ds: JsonDataset, url: string): void {
    const f = this.host.fetchFn;
    if (!f) { ds.fireError("no fetch available"); return; }
    f(url).then(
      async (res) => {
        if (!res.ok) { ds.fireError(`fetch ${url} → ${res.status}`); return; }
        try { ds.setData(await res.json()); } catch (e) { ds.fireError(`bad JSON from ${url}: ${(e as Error).message}`); }
      },
      (e) => ds.fireError(`fetch ${url} failed: ${(e as Error).message}`));
  }
  private liveInto(ds: JsonDataset, url: string): void {
    ds.fireError("ws source not built yet"); // replaced in Task 9
  }
}

export function installJsonRuntime(host: RuntimeHost): JsonRegistry {
  const reg = new JsonRegistry(host);
  // Task 6 wraps host.lzNodeProto.makeChild here.
  return reg;
}
