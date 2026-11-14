// Drives the headless preview browser (CDP 9240) through the visual states and
// writes screenshots into .verify/. Verification only, not part of the app.
import { writeFileSync } from "node:fs";

const targets = await (await fetch("http://127.0.0.1:9240/json/list")).json();
const page = targets.find((t) => t.type === "page" && t.url.startsWith("http://127.0.0.1:8123"));
if (!page) throw new Error("preview page not found");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => (socket.onopen = resolve));
const pending = new Map();
let next = 0;
const problems = [];
socket.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.method === "Runtime.exceptionThrown") problems.push("exception: " + JSON.stringify(msg.params.exceptionDetails?.exception?.description ?? msg.params));
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") problems.push("console: " + msg.params.args?.map((a) => a.value ?? a.description).join(" "));
  if (!msg.id) return;
  const item = pending.get(msg.id);
  if (!item) return;
  pending.delete(msg.id);
  msg.error ? item.reject(new Error(msg.error.message)) : item.resolve(msg.result);
};
const cmd = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++next;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const shot = async (name) => {
  const { data } = await cmd("Page.captureScreenshot", { format: "png" });
  writeFileSync(new URL(name, import.meta.url), Buffer.from(data, "base64"));
  console.log("shot", name);
};
const click = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);

await cmd("Page.enable");
await cmd("Runtime.enable");
await cmd("Page.navigate", { url: `http://127.0.0.1:8123/?run=${Date.now()}` });
await evaluate(`new Promise((resolve, reject) => { const start = Date.now(); const timer = setInterval(() => { if (window.__verify) { clearInterval(timer); resolve(true); } else if (Date.now() - start > 5000) { clearInterval(timer); reject(new Error("startup failed")); } }, 30); })`);

await evaluate(`(() => {
  const v = window.__verify;
  v.state.workspaces[0].name = 'SHODA API';
  const login = v.newRequest({ name: 'Login', method: 'POST', url: '{{base_url}}/auth/login', body: { mode: 'raw', raw: '{"email":"rina@shoda.id"}', contentType: 'application/json' } });
  const refresh = v.newRequest({ name: 'Refresh token', method: 'POST', url: '{{base_url}}/auth/refresh' });
  const list = v.newRequest({ name: 'List products', method: 'GET', url: '{{base_url}}/api/products', params: [{ key: 'page', value: '1', enabled: true }, { key: 'limit', value: '20', enabled: true }] });
  const detail = v.newRequest({ name: 'Product detail', method: 'GET', url: '{{base_url}}/api/products/1' });
  const stock = v.newRequest({ name: 'Update stock', method: 'PATCH', url: '{{base_url}}/api/products/1', body: { mode: 'raw', raw: '{"stock":24}', contentType: 'application/json' } });
  const remove = v.newRequest({ name: 'Remove product', method: 'DELETE', url: '{{base_url}}/api/products/1' });
  const health = v.newRequest({ name: 'Health', method: 'GET', url: '{{base_url}}/health' });
  const auth = v.newFolder({ name: 'Auth', items: [login, refresh] });
  const catalog = v.newFolder({ name: 'Catalog', items: [list, detail, stock, remove] });
  const col = v.newCollection('Shoda Backend', { items: [auth, catalog, health], variables: [{ key: 'base_url', value: 'http://127.0.0.1:8123', enabled: true }] });
  v.state.collections.push(col);
  v.state.environments.push(v.newEnvironment({ name: 'Local', variables: [{ key: 'base_url', value: 'http://127.0.0.1:8123', enabled: true }] }));
  v.state.expanded.add(col.id); v.state.expanded.add(catalog.id);
  v.addTab(list);
  v.addTab(v.newRequest({ name: 'Untitled Request', method: 'POST', url: '' }));
  v.render();
  return true;
})()`);

const stage = () => evaluate(`(() => { const r = document.querySelector('#res-pane'); const view = document.querySelector('#res-tabs .tab.is-active')?.dataset.tab; const idle = getComputedStyle(document.querySelector('.res-idle')).display; const failed = getComputedStyle(document.querySelector('.res-failed')).display; const pretty = getComputedStyle(document.querySelector('#pretty')).display; return { cls: r.className, view, idle, failed, pretty }; })()`);

console.log("idle:", JSON.stringify(await stage()));
await shot("preview-idle-dark.png");

await evaluate(`(() => { const v = window.__verify; v.state.activeTabId = v.state.tabs[0].id; v.render(); return true; })()`);
await evaluate(`__verify.send()`);
console.log("success:", JSON.stringify(await stage()));
await shot("preview-success-dark.png");

await click('#res-tabs [data-tab="res-headers"]');
console.log("headers view:", JSON.stringify(await stage()));
await click('#res-tabs [data-tab="pretty"]');

await evaluate(`(() => { const v = window.__verify; const t = v.state.tabs.find(t => t.id === v.state.activeTabId); t.req.url = 'http://127.0.0.1:9/fail'; v.render(); return true; })()`);
await evaluate(`__verify.send()`);
console.log("failed:", JSON.stringify(await stage()));
await shot("preview-failed-dark.png");

await click('#res-tabs [data-tab="res-headers"]');
console.log("failed+headers:", JSON.stringify(await stage()));
await click('#res-tabs [data-tab="tests"]');
console.log("failed+tests:", JSON.stringify(await stage()));
await click('#res-tabs [data-tab="pretty"]');
console.log("failed+pretty again:", JSON.stringify(await stage()));

await evaluate(`(() => { const v = window.__verify; v.state.settings.general.theme = 'light'; v.applyAppSettings(); return true; })()`);
await shot("preview-failed-light.png");

await evaluate(`(() => { const v = window.__verify; const t = v.state.tabs.find(t => t.id === v.state.activeTabId); t.req.url = '{{base_url}}/api/products'; v.render(); return true; })()`);
await evaluate(`__verify.send()`);
await shot("preview-success-light.png");

await evaluate(`(() => { const v = window.__verify; v.state.activeTabId = v.state.tabs[1].id; v.render(); return true; })()`);
await shot("preview-idle-light.png");

await evaluate(`(() => { const v = window.__verify; v.state.settings.general.theme = 'dark'; v.applyAppSettings(); return true; })()`);
await cmd("Emulation.setDeviceMetricsOverride", { width: 860, height: 700, deviceScaleFactor: 1, mobile: false });
await evaluate(`new Promise(r => requestAnimationFrame(() => r(true)))`);
console.log("narrow overflow:", await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`));
await shot("preview-idle-narrow.png");
await cmd("Emulation.clearDeviceMetricsOverride");

console.log("runtime problems:", problems.length ? problems : "none");
socket.close();
process.exit(0);