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

/** Implicit replication over a JSON-dialect datapath (spec "Replication").
 *  Diverted child specs never reach the LFC's XPath machinery. */
export class ReplicationManager {
  clones: any[] = [];
  private parsed: ParsedPath | null = null;
  private ds: JsonDataset | null = null;
  private refreshCb = () => this.refresh();
  constructor(
    private reg: JsonRegistry, private host: RuntimeHost,
    private parent: any, private spec: any, private path: string,
    private origMake: (e: any, async?: any) => any,
  ) {
    try { this.parsed = parsePath(path); }
    catch (e) { host.warn(`jsondatapath "${path}": ${(e as JsonPathError).message}`); return; }
    if (this.parsed.dataset != null) {
      if (!reg.get(this.parsed.dataset))
        host.warn(`jsondatapath "${path}": unknown dataset "$${this.parsed.dataset}" (binds when registered)`);
      reg.whenRegistered(this.parsed.dataset, (ds) => { this.ds = ds; ds.onData(this.refreshCb); this.refresh(); });
    } else {
      this.refresh(); // relative: context datum is already constructed on an ancestor
      // relative rebinds arrive as full re-replication of the ancestor (destroy/recreate)
    }
  }
  private contextValue(): unknown {
    if (this.parsed!.dataset != null) return this.ds ? this.ds.data : null;
    for (let n = this.parent; n; n = n.immediateparent) if (n.data != null) return n.data;
    return null;
  }
  private matches(): unknown[] {
    const filterFn = this.parsed!.filter ? this.filterFn() : undefined; // Task 11
    return evaluatePath(this.contextValue(), this.parsed!, filterFn);
  }
  private filterFn(): ((obj: unknown, accum: unknown[]) => unknown[]) | undefined {
    return undefined; // Task 11
  }
  refresh(): void {
    if (this.parent.__LZdeleted) { if (this.ds) this.ds.offData(this.refreshCb); return; }
    const m = this.sorted(this.matches()); // sorted() is identity until Task 11
    const pooling = this.spec.attrs?.pooling === true || this.spec.attrs?.pooling === "true";
    if (!pooling) {
      for (const c of this.clones) if (!c.__LZdeleted) c.destroy();
      this.clones = [];
      this.create(m, 0);
    } else {
      const live = this.clones.filter((c) => !c.__LZdeleted);
      const reuse = Math.min(live.length, m.length);
      for (let i = 0; i < reuse; i++) {
        if (live[i].visible === false) live[i].setAttribute("visible", true);
        live[i].setAttribute("clonenumber", i);
        live[i].setAttribute("data", m[i]);
      }
      for (let i = m.length; i < live.length; i++) live[i].setAttribute("visible", false);
      this.clones = live;
      if (m.length > live.length) this.create(m.slice(live.length), live.length);
    }
    const ev = this.parent.onclones;
    if (ev && typeof ev.sendEvent === "function") ev.sendEvent(this.clones);
  }
  private create(datums: unknown[], base: number): void {
    for (let i = 0; i < datums.length; i++) {
      const datum = datums[i];
      if (isLzDataNode(datum)) { this.host.warn(`jsondatapath "${this.path}": LzDataElement datum refused (use the bridge one-way)`); continue; }
      const attrs = { ...this.spec.attrs, data: datum, clonenumber: base + i, cloneManager: this };
      delete attrs.jsondatapath;
      // No async arg: __LZisnew=true → the clone's own subtree instantiates
      // synchronously (createImmediate / syncNew). makeChild RETURNS the node —
      // that return value IS the clone tracking (the LFC's default path is
      // idle-queued, so scanning subnodes after the fact finds nothing).
      const node = this.origMake.call(this.parent, { ...this.spec, attrs });
      if (node) this.clones.push(node);
    }
  }
  private sorted(m: unknown[]): unknown[] { return m; } // Task 11
}

/** Duck-check for LFC data nodes (LzDataElement/LzDataText) without importing
 *  the LFC: the $lzc$set_data setter would instantiate a classic LzDatapath on
 *  anything that IS one — the guard keeps that branch unreachable. */
function isLzDataNode(v: unknown): boolean {
  return !!v && typeof v === "object" &&
    typeof (v as any).appendChild === "function" && "ownerDocument" in (v as any);
}

export function installJsonRuntime(host: RuntimeHost): JsonRegistry {
  const reg = new JsonRegistry(host);
  // makeChild is the LFC's universal instantiation funnel (LzInstantiator calls
  // parent.makeChild(spec, true) for every queued spec at every level,
  // including canvas children). Wrapping createChildren would miss canvas-level
  // bound views entirely and could not track idle-queued clones.
  const orig = host.lzNodeProto.makeChild;
  host.lzNodeProto.makeChild = function (e: any, async?: any) {
    if (this.__LZdeleted) return orig.call(this, e, async); // mirror the LFC's early-out
    const p = e && e.attrs && e.attrs.jsondatapath;
    if (typeof p === "string") { new ReplicationManager(reg, host, this, e, p, orig); return null; }
    return orig.call(this, e, async);
  };
  return reg;
}
