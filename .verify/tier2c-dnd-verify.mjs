/* Tier 2C verify: drag & drop import + manual tree reordering (collections,
   folders, subfolders, requests), end-to-end against the isolated debug build
   (identifier app.postlite.tier1verify20261110, devUrl 8100, CDP 9235). Drives
   the real DOM listeners with synthetic DragEvents and a real DataTransfer/
   FileList, so the handlers under test are the shipped ones.
     node .verify/tier2c-dnd-verify.mjs */
import assert from 'node:assert/strict';
import { evaluate, reload, screenshot, close } from './tier1-cdp.mjs';

const lit = (v) => JSON.stringify(v);
let passed = 0;
const check = async (name, expression) => {
  const value = await evaluate(`(async()=>(${expression}))()`);
  assert.equal(value, true, `${name}: ${JSON.stringify(value)}`);
  passed++;
  console.log(`PASS ${name}`);
};
const ok = (name, condition) => { assert.ok(condition, name); passed++; console.log(`PASS ${name}`); };
const wait = (ms) => evaluate(`new Promise(r=>setTimeout(r,${ms}))`);
const settle = () => wait(220);
const shot = async (name) => { await wait(300); await screenshot(name); };
const names = () => evaluate(`__verify.state.collections.map(c=>c.name)`);

/* Seed a deterministic tree: three collections, each with one request + a folder. */
const seed = () => evaluate(`(() => {
  const mk = (name) => __verify.newCollection(name, { items: [
    __verify.newRequest({ name: name + ' req' }),
    __verify.newFolder({ name: name + ' folder', items: [__verify.newRequest({ name: 'nested' })] }),
  ]});
  __verify.state.collections = [mk('Alpha'), mk('Beta'), mk('Gamma')];
  __verify.state.environments = [];
  __verify.state.filter = '';
  document.querySelector('#tree-search').value = '';
  __verify.persist();
  __verify.render();
  return true;
})()`);

/* Reorder by dragging sourceId's row onto targetId, before/after its head row.
   Groups drag by their .node-head; request rows drag as a whole. */
const dragReorder = (sourceId, targetId, before) => evaluate(`(() => {
  const host = document.querySelector('#collections');
  const row = (nid) => { const n = host.querySelector('.node[data-id="' + nid + '"]'); return n.dataset.kind === 'request' ? n : n.querySelector(':scope > .node-head'); };
  const src = row('${sourceId}');
  const tgt = row('${targetId}');
  const r = tgt.getBoundingClientRect();
  const y = ${before} ? r.top + 2 : r.bottom - 2;
  const dt = new DataTransfer();
  src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
  host.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
  host.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
  src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
  return true;
})()`);

const idOf = (name) => evaluate(`__verify.state.collections.find(c=>c.name===${lit(name)}).id`);
const itemId = (name) => evaluate(`(() => { const walk=(items)=>{ for(const it of items){ if(it.name===${lit(name)}) return it.id; const hit=it.items?walk(it.items):null; if(hit) return hit; } return null; }; return walk(__verify.state.collections); })()`);
/* Names of the items directly under parentId (collection or folder); null = root. */
const orderUnder = (parentId) => evaluate(`(() => {
  if (${lit(parentId)} === null) return __verify.state.collections.map(c=>c.name);
  const walk=(items)=>{ for(const it of items){ if(it.id===${lit(parentId)}) return (it.items??[]).map(x=>x.name); const hit=it.items?walk(it.items):null; if(hit) return hit; } return null; };
  return walk(__verify.state.collections);
})()`);

/* Drop one or more files anywhere on the window; returns whether the overlay lit. */
const dropFiles = (files) => evaluate(`(() => {
  const dt = new DataTransfer();
  for (const f of ${lit(files)}) dt.items.add(new File([f.body], f.name, { type: f.type || 'application/json' }));
  window.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
  const shown = !document.querySelector('#drop-overlay').hidden;
  window.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  return shown;
})()`);

const postmanCollection = (name) => JSON.stringify({
  info: { name, _postman_id: 'x' },
  item: [{ name: 'ping', request: { method: 'GET', url: 'https://example.com/ping' } }],
});
const postmanEnvironment = (name) => JSON.stringify({
  name, values: [{ key: 'host', value: 'example.com', enabled: true }], _postman_variable_scope: 'environment',
});

try {
  await seed();
  await settle();
  assert.deepEqual(await names(), ['Alpha', 'Beta', 'Gamma'], 'seed order');

  /* ------------------------------------------------ markup + affordances */
  await check('collection heads are draggable', `[...document.querySelectorAll('#collections > .node[data-kind="collection"] > .node-head')].every(h=>h.getAttribute('draggable')==='true')`);
  await check('each collection head carries a grip', `[...document.querySelectorAll('#collections > .node[data-kind="collection"] > .node-head')].every(h=>h.querySelector('.drag-grip'))`);
  await check('folder heads and request rows are draggable', `[...document.querySelectorAll('#collections .node[data-kind="folder"] > .node-head, #collections .node.request')].every(h=>h.getAttribute('draggable')==='true')`);
  await check('folders and requests carry grips too', `[...document.querySelectorAll('#collections .node[data-kind="folder"] > .node-head, #collections .node.request')].every(h=>h.querySelector('.drag-grip'))`);
  await check('request rows are tabbable for keyboard reorder', `[...document.querySelectorAll('#collections .node.request')].every(r=>r.getAttribute('tabindex')==='0')`);
  await check('empty-state copy mentions dropping', `(() => { const c=__verify.state.collections; __verify.state.collections=[]; __verify.render(); const t=document.querySelector('#collections .empty span').textContent; __verify.state.collections=c; __verify.render(); return /drop/i.test(t); })()`);

  /* ------------------------------------------------ collection reordering */
  let a = await idOf('Alpha'), g = await idOf('Gamma');
  await dragReorder(g, a, true);           // Gamma before Alpha -> Gamma,Alpha,Beta
  await settle();
  assert.deepEqual(await names(), ['Gamma', 'Alpha', 'Beta'], 'drag Gamma to top');
  passed++; console.log('PASS drag moves a collection to the top');
  await check('DOM order matches state after drag', `JSON.stringify([...document.querySelectorAll('#collections > .node[data-kind="collection"] > .node-head .node-name')].map(n=>n.textContent))===JSON.stringify(__verify.state.collections.map(c=>c.name))`);
  await check('drop line is cleaned up after drop', `!document.querySelector('#tree-drop-line')`);
  await check('no node keeps the dragging class', `!document.querySelector('#collections .node.is-dragging')`);

  g = await idOf('Gamma'); const b = await idOf('Beta');
  await dragReorder(g, b, false);          // Gamma after Beta -> Alpha,Beta,Gamma
  await settle();
  assert.deepEqual(await names(), ['Alpha', 'Beta', 'Gamma'], 'drag Gamma to bottom');
  passed++; console.log('PASS drag moves a collection to the bottom');

  const before = await names();
  a = await idOf('Alpha');
  await dragReorder(a, a, true);           // onto itself -> no change
  await settle();
  assert.deepEqual(await names(), before, 'self-drop is a no-op');
  passed++; console.log('PASS dropping a collection on itself changes nothing');

  /* live insertion line appears mid-drag */
  a = await idOf('Alpha'); const b2 = await idOf('Beta');
  await evaluate(`(() => {
    const host=document.querySelector('#collections');
    const src=host.querySelector('.node[data-id="${a}"] > .node-head');
    const tgt=host.querySelector('.node[data-id="${b2}"] > .node-head');
    const dt=new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));
    host.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientY:tgt.getBoundingClientRect().top+2}));
    return true;
  })()`);
  await wait(60);
  await check('insertion line is visible mid-drag', `!!document.querySelector('#tree-drop-line') && !document.querySelector('#tree-drop-line').hidden`);
  await check('source node is marked dragging mid-drag', `!!document.querySelector('#collections .node.is-dragging')`);
  await shot('tier2c-reorder-line.png');
  await evaluate(`document.querySelector('#collections .node[data-id="${a}"] > .node-head').dispatchEvent(new DragEvent('dragend',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer()}))`);
  await settle();

  /* keyboard reorder */
  await evaluate(`(() => { const id=__verify.state.collections[0].id; document.querySelector('#collections .node[data-id="'+id+'"] .caret').focus(); return true; })()`);
  await evaluate(`(() => { const el=document.activeElement; el.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true,cancelable:true})); return true; })()`);
  await settle();
  assert.deepEqual(await names(), ['Beta', 'Alpha', 'Gamma'], 'Alt+ArrowDown moves first collection down');
  passed++; console.log('PASS Alt+ArrowDown reorders from the keyboard');
  await evaluate(`(() => { const id=__verify.state.collections[1].id; document.querySelector('#collections .node[data-id="'+id+'"] .caret').focus(); document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',altKey:true,bubbles:true,cancelable:true})); return true; })()`);
  await settle();
  assert.deepEqual(await names(), ['Alpha', 'Beta', 'Gamma'], 'Alt+ArrowUp restores order');
  passed++; console.log('PASS Alt+ArrowUp reorders from the keyboard');

  /* reorder stays correct while a filter is active */
  await evaluate(`(() => { __verify.state.filter='a'; document.querySelector('#tree-search').value='a'; __verify.render(); return true; })()`);
  await settle();
  a = await idOf('Alpha'); g = await idOf('Gamma');
  await dragReorder(g, a, true);
  await settle();
  await evaluate(`(() => { __verify.state.filter=''; document.querySelector('#tree-search').value=''; __verify.render(); return true; })()`);
  await settle();
  assert.deepEqual(await names(), ['Gamma', 'Alpha', 'Beta'], 'filtered drag maps onto the master list');
  passed++; console.log('PASS reordering while filtered targets the master list');
  await dragReorder(await idOf('Gamma'), await idOf('Beta'), false);
  await settle();

  /* persistence across a real reload */
  await evaluate(`__verify.flushWorkspace()`);
  await reload();
  await settle();
  assert.deepEqual(await names(), ['Alpha', 'Beta', 'Gamma'], 'order survives reload');
  passed++; console.log('PASS collection order persists across reload');

  /* ------------------------------------------------ nested tree reordering */
  /* Tree: [R1, Sub[N1, Deep[D1, D2], N2], R2, Empty[]], all expanded. */
  await evaluate(`(() => {
    const v = __verify;
    const deep = v.newFolder({ name: 'Deep', items: [v.newRequest({ name: 'D1' }), v.newRequest({ name: 'D2' })] });
    const sub = v.newFolder({ name: 'Sub', items: [v.newRequest({ name: 'N1' }), deep, v.newRequest({ name: 'N2' })] });
    const c = v.newCollection('Tree', { items: [v.newRequest({ name: 'R1' }), sub, v.newRequest({ name: 'R2' }), v.newFolder({ name: 'Empty' })] });
    v.state.collections = [c];
    v.state.filter = '';
    document.querySelector('#tree-search').value = '';
    v.state.expanded = new Set([c.id, sub.id, deep.id]);
    v.persist(); v.render();
    return true;
  })()`);
  await settle();
  const tree = await itemId('Tree'), sub = await itemId('Sub'), deep = await itemId('Deep');
  const r1 = await itemId('R1'), r2 = await itemId('R2'), empty = await itemId('Empty');
  const n1 = await itemId('N1'), n2 = await itemId('N2'), d1 = await itemId('D1'), d2 = await itemId('D2');

  await dragReorder(r2, r1, true);
  await settle();
  assert.deepEqual(await orderUnder(tree), ['R2', 'R1', 'Sub', 'Empty'], 'request dragged before its sibling');
  ok('requests reorder at the collection root', true);

  await dragReorder(empty, sub, true);
  await settle();
  assert.deepEqual(await orderUnder(tree), ['R2', 'R1', 'Empty', 'Sub'], 'folder dragged among its siblings');
  ok('folders reorder at the collection root', true);

  await dragReorder(n2, n1, true);
  await settle();
  assert.deepEqual(await orderUnder(sub), ['N2', 'N1', 'Deep'], 'request dragged inside a folder');
  ok('requests reorder inside a folder', true);

  await dragReorder(d2, d1, true);
  await settle();
  assert.deepEqual(await orderUnder(deep), ['D2', 'D1'], 'request dragged inside a subfolder');
  ok('requests reorder inside a subfolder', true);

  const domUnderSub = await evaluate(`[...document.querySelectorAll('#collections .node[data-id="${sub}"] > .node-body > .node')].map(n=>(n.querySelector(':scope > .node-head .node-name') ?? n.querySelector(':scope > .node-name')).textContent)`);
  assert.deepEqual(domUnderSub, await orderUnder(sub), 'nested DOM order matches state');
  ok('nested DOM order matches state', true);

  /* dropping over a foreign parent never reparents: the item stays with its siblings */
  await dragReorder(d1, r2, true);
  await settle();
  await check('cross-parent drop keeps the item in its own parent', `__verify.siblingArray(${lit(d1)}).some(i=>i.id===${lit(d1)}) && __verify.siblingArray(${lit(d1)}).every(i=>['D1','D2'].includes(i.name)) && !__verify.siblingArray(${lit(tree)}).some(i=>i.id===${lit(d1)})`);

  /* live line works at depth */
  await evaluate(`(() => {
    const host=document.querySelector('#collections');
    const src=host.querySelector('.node[data-id="${d1}"]');
    const tgt=host.querySelector('.node[data-id="${d2}"]');
    const dt=new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));
    host.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientY:tgt.getBoundingClientRect().top+2}));
    return true;
  })()`);
  await wait(60);
  await check('insertion line is visible mid-drag at depth', `(() => { const l=document.querySelector('#tree-drop-line'); return !!l && !l.hidden && parseFloat(l.style.top)>=0; })()`);
  await check('nested source row is marked dragging', `document.querySelector('#collections .node[data-id="${d1}"]').classList.contains('is-dragging')`);
  await shot('tier2c-nested-line.png');
  await evaluate(`document.querySelector('#collections .node[data-id="${d1}"]').dispatchEvent(new DragEvent('dragend',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer()}))`);
  await settle();
  await check('nested drag cleans up line and class', `!document.querySelector('#tree-drop-line') && !document.querySelector('#collections .node.is-dragging')`);

  /* keyboard reorder on request rows and folder carets */
  await evaluate(`(() => { document.querySelector('#collections .node[data-id="${n1}"]').focus(); document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true,cancelable:true})); return true; })()`);
  await settle();
  assert.deepEqual(await orderUnder(sub), ['N2', 'Deep', 'N1'], 'Alt+ArrowDown moves a request row');
  ok('Alt+ArrowDown reorders a request from the keyboard', true);
  await check('focus follows the moved request row', `document.activeElement?.dataset?.id===${lit(n1)}`);
  await evaluate(`(() => { document.querySelector('#collections .node[data-id="${n1}"]').focus(); document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',altKey:true,bubbles:true,cancelable:true})); return true; })()`);
  await settle();
  assert.deepEqual(await orderUnder(sub), ['N2', 'N1', 'Deep'], 'Alt+ArrowUp restores the request');
  ok('Alt+ArrowUp reorders a request from the keyboard', true);
  await evaluate(`(() => { document.querySelector('#collections .node[data-id="${deep}"] .caret').focus(); document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',altKey:true,bubbles:true,cancelable:true})); return true; })()`);
  await settle();
  assert.deepEqual(await orderUnder(sub), ['N2', 'Deep', 'N1'], 'Alt+ArrowUp moves a subfolder');
  ok('Alt+ArrowUp reorders a subfolder from the keyboard', true);

  /* Enter on a focused request row opens it */
  const tabsBeforeEnter = await evaluate(`__verify.state.tabs.length`);
  await evaluate(`(() => { document.querySelector('#collections .node[data-id="${r1}"]').focus(); document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})); return true; })()`);
  await settle();
  await check('Enter on a focused request opens its tab', `__verify.state.tabs.length===${tabsBeforeEnter + 1} && __verify.state.tabs.find(t=>t.id===__verify.state.activeTabId).req.name==='R1'`);

  /* filtered nested reorder still targets the master array */
  await evaluate(`(() => { __verify.state.filter='d'; document.querySelector('#tree-search').value='d'; __verify.render(); return true; })()`);
  await settle();
  await dragReorder(d1, d2, false);
  await settle();
  await evaluate(`(() => { __verify.state.filter=''; document.querySelector('#tree-search').value=''; __verify.render(); return true; })()`);
  await settle();
  assert.deepEqual(await orderUnder(deep), ['D2', 'D1'], 'filtered nested drag maps onto the master array');
  ok('nested reordering while filtered targets the master array', true);

  /* nested order survives a real reload */
  await evaluate(`__verify.flushWorkspace()`);
  await reload();
  await settle();
  assert.deepEqual(await orderUnder(tree), ['R2', 'R1', 'Empty', 'Sub'], 'root order survives reload');
  assert.deepEqual(await orderUnder(sub), ['N2', 'Deep', 'N1'], 'folder order survives reload');
  assert.deepEqual(await orderUnder(deep), ['D2', 'D1'], 'subfolder order survives reload');
  ok('nested tree order persists across reload', true);

  /* ------------------------------------------------ file import overlay */
  await check('overlay starts hidden', `document.querySelector('#drop-overlay').hidden`);
  const lit1 = await dropFiles([{ name: 'x.postman_collection.json', body: postmanCollection('Dropped') }]);
  assert.equal(lit1, true, 'overlay lights on file dragenter');
  passed++; console.log('PASS overlay lights while a file is over the window');
  await settle();
  await check('overlay hides after drop', `document.querySelector('#drop-overlay').hidden`);

  /* Postman collection */
  assert.ok((await names()).includes('Dropped'), 'dropped collection imported');
  passed++; console.log('PASS dropped Postman collection is imported');
  await check('dropped collection renders in the tree', `[...document.querySelectorAll('#collections > .node[data-kind="collection"] .node-name')].some(n=>n.textContent==='Dropped')`);
  await check('import note confirms the collection', `/Imported 1 collection/.test(document.querySelector('#tool-note').textContent)`);

  /* Postman environment */
  await dropFiles([{ name: 'x.postman_environment.json', body: postmanEnvironment('DroppedEnv') }]);
  await settle();
  await check('dropped Postman environment is imported', `__verify.state.environments.some(e=>e.name==='DroppedEnv')`);

  /* cURL script */
  const tabsBefore = await evaluate(`__verify.state.tabs.length`);
  await dropFiles([{ name: 'req.curl', body: 'curl -X POST https://example.com/api -H "Content-Type: application/json" -d \'{"a":1}\'', type: 'text/plain' }]);
  await settle();
  await check('dropped cURL opens a new tab', `__verify.state.tabs.length===${tabsBefore + 1}`);
  await check('dropped cURL carries method and url', `(() => { const t=__verify.state.tabs.find(t=>t.id===__verify.state.activeTabId); return t.req.method==='POST' && t.req.url==='https://example.com/api'; })()`);

  /* postlite settings */
  await dropFiles([{ name: 'postlite.settings.json', body: JSON.stringify({ kind: 'postlite.settings', version: 1, settings: { general: { theme: 'light' } } }) }]);
  await settle();
  await check('dropped settings file applies the theme', `document.documentElement.dataset.theme==='light'`);
  await shot('tier2c-overlay-light.png');
  await dropFiles([{ name: 'postlite.settings.json', body: JSON.stringify({ kind: 'postlite.settings', version: 1, settings: { general: { theme: 'dark' } } }) }]);
  await settle();

  /* backup opens the restore dialog, not an silent merge */
  const wsCount = await evaluate(`__verify.state.workspaces.length`);
  await dropFiles([{ name: 'postlite.backup.json', body: JSON.stringify({ kind: 'postlite.backup', version: 1, exportedAt: 'now', payload: { workspaces: [{ id: 'w9', name: 'FromBackup', collections: [], environments: [], tabs: [] }] } }) }]);
  await settle();
  await check('dropped backup opens the restore dialog', `document.querySelector('#restore-dialog').open`);
  await check('backup did not auto-merge', `__verify.state.workspaces.length===${wsCount}`);
  await evaluate(`document.querySelector('#restore-cancel').click()`);
  await settle();
  await check('restore dialog cancels cleanly', `!document.querySelector('#restore-dialog').open`);

  /* unsupported + malformed files report, never throw */
  await dropFiles([{ name: 'notes.txt', body: 'just some prose, not curl', type: 'text/plain' }]);
  await settle();
  await check('unsupported file reports an import error', `/unsupported|unrecognized/i.test(document.querySelector('#error').textContent)`);
  const colsNow = await names();
  await dropFiles([{ name: 'broken.json', body: '{"item": [', type: 'application/json' }]);
  await settle();
  assert.deepEqual(await names(), colsNow, 'malformed JSON changes nothing');
  passed++; console.log('PASS malformed JSON is rejected without side effects');

  /* multi-file drop imports each */
  const beforeMulti = await evaluate(`__verify.state.collections.length`);
  await dropFiles([
    { name: 'one.postman_collection.json', body: postmanCollection('MultiOne') },
    { name: 'two.postman_collection.json', body: postmanCollection('MultiTwo') },
  ]);
  await settle();
  await check('multi-file drop imports every collection', `__verify.state.collections.length===${beforeMulti + 2} && __verify.state.collections.some(c=>c.name==='MultiOne') && __verify.state.collections.some(c=>c.name==='MultiTwo')`);

  /* a real modal suppresses the overlay and the import */
  await evaluate(`__verify.openAppSettings()`);
  await settle();
  const colsModal = await names();
  const litModal = await dropFiles([{ name: 'x.postman_collection.json', body: postmanCollection('ShouldNotImport') }]);
  await settle();
  assert.equal(litModal, false, 'overlay stays hidden behind a modal');
  passed++; console.log('PASS overlay stays hidden while a modal is open');
  assert.deepEqual(await names(), colsModal, 'no import behind a modal');
  passed++; console.log('PASS drops are ignored while a modal is open');
  await evaluate(`document.querySelector('#app-settings-dialog').close()`);
  await settle();

  await shot('tier2c-final.png');
  console.log(`\n${passed} checks passed`);
} finally {
  close();
}