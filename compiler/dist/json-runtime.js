// json-runtime.ts — the JSON databinding micro-runtime (spec: docs/superpowers/
// specs/2026-07-06-json-databinding-design.md, "Runtime components"). Authored
// here so the parser is shared with the compiler; bundled to
// startup/lz-json-data.js (IIFE) by `npm run bundle:jsondata` and prepended to
// the app blob by laszlo-dom.js. Every environment touchpoint (LzNode
// prototype, fetch, WebSocket, timers, window globals) is injected via
// RuntimeHost so the whole runtime is node-testable.
import { parsePath, evaluatePath, resolvePointer } from "./json-path.js";
export class JsonDataset {
    constructor(name, host, shape) {
        this.name = name;
        this.host = host;
        this.shape = shape;
        this.data = null;
        this.ready = false;
        this.dataCbs = new Set();
        this.errCbs = new Set();
    }
    onData(cb) { this.dataCbs.add(cb); }
    offData(cb) { this.dataCbs.delete(cb); }
    onError(cb) { this.errCbs.add(cb); }
    fireError(msg) { this.host.warn(`dataset "${this.name}": ${msg}`); for (const cb of [...this.errCbs])
        cb(msg); }
    setData(v) { this.data = v; this.ready = true; for (const cb of [...this.dataCbs])
        cb(); }
    updateData(pointer, value) {
        const r = resolvePointer(this.data, pointer);
        if (!r) {
            this.host.warn(`dataset "${this.name}": updateData("${pointer}") resolves nothing`);
            return false;
        }
        r.parent[r.key] = value;
        for (const cb of [...this.dataCbs])
            cb();
        return true;
    }
}
export class JsonRegistry {
    constructor(host) {
        this.host = host;
        this.datasets = new Map();
        this.pending = new Map();
    }
    get(name) { return this.datasets.get(name); }
    whenRegistered(name, cb) {
        const ds = this.datasets.get(name);
        if (ds) {
            cb(ds);
            return;
        }
        const q = this.pending.get(name) ?? [];
        q.push(cb);
        this.pending.set(name, q);
    }
    register(name, init) {
        const ds = new JsonDataset(name, this.host);
        this.datasets.set(name, ds);
        if ("json" in init)
            ds.setData(init.json);
        else if (init.src != null)
            this.fetchInto(ds, init.src);
        else if (init.ws != null)
            this.liveInto(ds, init.ws); // Task 9
        for (const cb of this.pending.get(name) ?? [])
            cb(ds);
        this.pending.delete(name);
        return ds;
    }
    fetchInto(ds, url) {
        const f = this.host.fetchFn;
        if (!f) {
            ds.fireError("no fetch available");
            return;
        }
        f(url).then(async (res) => {
            if (!res.ok) {
                ds.fireError(`fetch ${url} → ${res.status}`);
                return;
            }
            try {
                ds.setData(await res.json());
            }
            catch (e) {
                ds.fireError(`bad JSON from ${url}: ${e.message}`);
            }
        }, (e) => ds.fireError(`fetch ${url} failed: ${e.message}`));
    }
    liveInto(ds, url) {
        ds.fireError("ws source not built yet"); // replaced in Task 9
    }
}
/** Implicit replication over a JSON-dialect datapath (spec "Replication").
 *  Diverted child specs never reach the LFC's XPath machinery. */
export class ReplicationManager {
    constructor(reg, host, parent, spec, path, origMake) {
        this.reg = reg;
        this.host = host;
        this.parent = parent;
        this.spec = spec;
        this.path = path;
        this.origMake = origMake;
        this.clones = [];
        this.parsed = null;
        this.ds = null;
        this.refreshCb = () => this.refresh();
        try {
            this.parsed = parsePath(path);
        }
        catch (e) {
            host.warn(`jsondatapath "${path}": ${e.message}`);
            return;
        }
        if (this.parsed.dataset != null) {
            if (!reg.get(this.parsed.dataset))
                host.warn(`jsondatapath "${path}": unknown dataset "$${this.parsed.dataset}" (binds when registered)`);
            reg.whenRegistered(this.parsed.dataset, (ds) => { this.ds = ds; ds.onData(this.refreshCb); this.refresh(); });
        }
        else {
            this.refresh(); // relative: context datum is already constructed on an ancestor
            // relative rebinds arrive as full re-replication of the ancestor (destroy/recreate)
        }
    }
    contextValue() {
        if (this.parsed.dataset != null)
            return this.ds ? this.ds.data : null;
        for (let n = this.parent; n; n = n.immediateparent)
            if (n.data != null)
                return n.data;
        return null;
    }
    matches() {
        const filterFn = this.parsed.filter ? this.filterFn() : undefined; // Task 11
        return evaluatePath(this.contextValue(), this.parsed, filterFn);
    }
    filterFn() {
        return undefined; // Task 11
    }
    refresh() {
        if (this.parent.__LZdeleted) {
            if (this.ds)
                this.ds.offData(this.refreshCb);
            return;
        }
        const m = this.sorted(this.matches()); // sorted() is identity until Task 11
        const pooling = this.spec.attrs?.pooling === true || this.spec.attrs?.pooling === "true";
        if (!pooling) {
            for (const c of this.clones)
                if (!c.__LZdeleted)
                    c.destroy();
            this.clones = [];
            this.create(m, 0);
        }
        else {
            const live = this.clones.filter((c) => !c.__LZdeleted);
            const reuse = Math.min(live.length, m.length);
            for (let i = 0; i < reuse; i++) {
                if (live[i].visible === false)
                    live[i].setAttribute("visible", true);
                live[i].setAttribute("clonenumber", i);
                live[i].setAttribute("data", m[i]);
            }
            for (let i = m.length; i < live.length; i++)
                live[i].setAttribute("visible", false);
            this.clones = live;
            if (m.length > live.length)
                this.create(m.slice(live.length), live.length);
        }
        const ev = this.parent.onclones;
        if (ev && typeof ev.sendEvent === "function")
            ev.sendEvent(this.clones);
    }
    create(datums, base) {
        for (let i = 0; i < datums.length; i++) {
            const datum = datums[i];
            if (isLzDataNode(datum)) {
                this.host.warn(`jsondatapath "${this.path}": LzDataElement datum refused (use the bridge one-way)`);
                continue;
            }
            const attrs = { ...this.spec.attrs, data: datum, clonenumber: base + i, cloneManager: this };
            delete attrs.jsondatapath;
            // No async arg: __LZisnew=true → the clone's own subtree instantiates
            // synchronously (createImmediate / syncNew). makeChild RETURNS the node —
            // that return value IS the clone tracking (the LFC's default path is
            // idle-queued, so scanning subnodes after the fact finds nothing).
            const node = this.origMake.call(this.parent, { ...this.spec, attrs });
            if (node)
                this.clones.push(node);
        }
    }
    sorted(m) { return m; } // Task 11
}
/** Duck-check for LFC data nodes (LzDataElement/LzDataText) without importing
 *  the LFC: the $lzc$set_data setter would instantiate a classic LzDatapath on
 *  anything that IS one — the guard keeps that branch unreachable. */
function isLzDataNode(v) {
    return !!v && typeof v === "object" &&
        typeof v.appendChild === "function" && "ownerDocument" in v;
}
export function installJsonRuntime(host) {
    const reg = new JsonRegistry(host);
    // makeChild is the LFC's universal instantiation funnel (LzInstantiator calls
    // parent.makeChild(spec, true) for every queued spec at every level,
    // including canvas children). Wrapping createChildren would miss canvas-level
    // bound views entirely and could not track idle-queued clones.
    const orig = host.lzNodeProto.makeChild;
    host.lzNodeProto.makeChild = function (e, async) {
        if (this.__LZdeleted)
            return orig.call(this, e, async); // mirror the LFC's early-out
        const p = e && e.attrs && e.attrs.jsondatapath;
        if (typeof p === "string") {
            new ReplicationManager(reg, host, this, e, p, orig);
            return null;
        }
        return orig.call(this, e, async);
    };
    return reg;
}
