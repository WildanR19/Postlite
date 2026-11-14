// Visual preview harness: serves ui/ with a mock __TAURI__ so the frontend can
// be exercised in a plain browser. Not part of the app; verification only.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../ui");
const exposed = "state,DEFAULT_SETTINGS,normalizeSettings,newRequest,newFolder,newCollection,newEnvironment,newWorkspace,addTab,render,renderResponse,send,applyAppSettings,persist,flushWorkspace,openDrawer,closeDrawer,openAppSettings";

const mock = `
window.__TAURI__ = (() => {
  let saved = null;
  const invoke = async (cmd, args) => {
    switch (cmd) {
      case "load_workspace": return saved;
      case "save_workspace": saved = args.state; return null;
      case "http_send": {
        const r = args.request;
        await new Promise((res) => setTimeout(res, 350));
        if (/fail|invalid|refused/.test(r.url)) throw new Error("error sending request for url (" + r.url + "): client error (Connect): tcp connect error: Connection refused (os error 10061)");
        const body = JSON.stringify({ method: r.method, url: r.url, headers: Object.fromEntries(r.headers.map((h) => [h.key, h.value])), body: (() => { try { return r.body ? JSON.parse(r.body) : null; } catch { return r.body; } })(), items: [{ id: 1, name: "Kopi susu", price: 18000, stock: 24 }, { id: 2, name: "Matcha latte", price: 22000, stock: 9 }], page: 1, total: 2 }, null, 2);
        return { status: 200, status_text: "OK", elapsed_ms: 142, size_bytes: body.length, truncated: false, headers: [{ key: "content-type", value: "application/json; charset=utf-8" }, { key: "x-request-id", value: "req-8f3a2c" }, { key: "cache-control", value: "no-store" }], body };
      }
      case "cookie_list": return { rows: [], note: null, persisting: true };
      case "cookie_delete": return 0;
      case "cookie_purge": return null;
      case "cookie_set_persist": return null;
      case "proxy_credentials_get": return { username: "", password: "" };
      case "proxy_credentials_set": return null;
      default: return null;
    }
  };
  return {
    core: { invoke },
    app: { getVersion: async () => "0.2.0" },
    path: { appDataDir: async () => "preview" },
    window: { getCurrentWindow: () => ({ onCloseRequested: async () => {}, destroy: async () => {} }) },
  };
})();
`;

const handler = (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const file = { "/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/codegen.js": "codegen.js", "/styles.css": "styles.css" }[url.pathname];
  if (!file) { res.writeHead(404); res.end(); return; }
  let source = readFileSync(resolve(root, file), "utf8");
  if (file === "index.html") source = source.replace('<script src="./codegen.js"></script>', `<script>${mock}</script><script src="./codegen.js"></script>`);
  if (file === "app.js") source += `\nwindow.__verify = {${exposed}};\n`;
  res.writeHead(200, { "content-type": file.endsWith("js") ? "text/javascript" : file.endsWith("css") ? "text/css" : "text/html", "cache-control": "no-store" });
  res.end(source);
};
createServer(handler).listen(8123, () => console.log("postlite visual preview: http://127.0.0.1:8123"));