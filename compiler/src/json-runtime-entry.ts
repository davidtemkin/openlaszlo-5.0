// json-runtime-entry.ts — IIFE entry for startup/lz-json-data.js (built by
// `npm run bundle:jsondata`). Prepended to the app blob by laszlo-dom.js when
// the app declares <dataset type="json">: after the LFC and the adopt patch,
// before the app JS — so LzNode exists and no view has been constructed yet.

import { installJsonRuntime } from "./json-runtime.js";

const g = window as any;
if (typeof g.LzNode !== "undefined" && g.lz && !g.lz.jsondata) {
  g.lz.jsondata = installJsonRuntime({
    lzNodeProto: g.LzNode.prototype,
    warn: (m: string) => console.warn("[lz-json]", m),
    fetchFn: (u: string) => fetch(u),
    makeSocket: (u: string) => new WebSocket(u) as any,
    setTimeoutFn: (cb: () => void, ms: number) => setTimeout(cb, ms),
    globals: g,
  });
}
