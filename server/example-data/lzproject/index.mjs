import { handleLzproject } from "./data.mjs";
// /api/lzproject/rest/<controller>/<action> — in-memory CRUD + session auth + i18n
export async function handle(req, res, sub, q, body) {
  if (sub.startsWith("rest/")) {
    const r = handleLzproject(req.method, sub.slice("rest/".length), body, req);
    const headers = { "Content-Type": "text/xml;charset=utf-8" };
    if (r.setCookie) headers["Set-Cookie"] = r.setCookie;
    res.writeHead(200, headers);
    res.end('<?xml version="1.0" encoding="UTF-8"?>\n' + r.xml);
    return true;
  }
  return false;
}
