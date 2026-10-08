import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
const script = (await build({ entryPoints: ['extension/src/background.ts'], bundle: true, format: 'iife', write: false })).outputFiles[0].text;
function fixture({ missingReceiver = false, missingTabURL = false, missingQueryURL = false, lookupGate, storageGate, writeGate, createGate, injectionGate, savedPaper, historyReadGate, createError = false, scriptError = false, createdStatus = 'complete', session = {}, tabs = new Map() } = {}) {
  const listeners = {}, calls = [], tabCalls = [];
  let version = 'version-1', writes = 1, nextTab = 2;
  const event = name => ({ addListener: callback => { listeners[name] = callback; } });
  const browser = {
    runtime: { onMessage: event('rpc'), onInstalled: event('installed'), getURL: path => 'extension://paperchat/' + path,
      connectNative: () => ({ onMessage: event('native'), onDisconnect: event('disconnect') }),
      sendNativeMessage: async (id, payload) => { calls.push(structuredClone(payload)); if (payload.action === 'readHistory') { if (historyReadGate?.wait) await historyReadGate.wait; return { ok: true, conversation: savedPaper ? { paper: savedPaper, messages: [] } : null }; } if (missingReceiver && payload.action === 'saveHistory') { assert.equal(payload.expectedRevision, version); return { ok: true, revision: (version = 'version-' + ++writes) }; } return { ok: true }; }, sendMessage: async () => {} },
    storage: { session: { get: async key => { const snapshot = { [key]: structuredClone(session[key]) }; if (storageGate?.wait && key.startsWith('paperchat.reader-token.')) await storageGate.wait; return snapshot; }, set: async values => { Object.assign(session, structuredClone(values)); if (writeGate?.wait) await writeGate.wait; }, remove: async key => { delete session[key]; } } },
    tabs: { onRemoved: event('removed'), onUpdated: event('updated'), sendMessage: async (id, message) => { tabCalls.push({ action: 'message', id, message }); if (missingReceiver) throw Error('No receiver'); return message.type === 'paperchat.document' ? { documentToken: 'fixture-document' } : { ok: true }; }, create: async value => { tabCalls.push({ action: 'create', ...value }); if (createError) throw Error('Tab creation failed'); const id = nextTab++; tabs.set(id, { id, status: createdStatus, ...value }); if (createGate?.wait) await createGate.wait; return tabs.get(id); }, update: async (id, value) => { tabs.set(id, { id, ...value }); }, get: async id => { const snapshot = missingTabURL ? { id } : lookupGate?.status ? { ...tabs.get(id), status: lookupGate.status } : tabs.get(id); if (lookupGate?.wait) await lookupGate.wait; return snapshot; }, query: async () => [missingQueryURL ? { id: 2 } : tabs.get(2) ?? { id: 1 }] },
    contextMenus: { onClicked: event('context'), create: () => {} }, action: { onClicked: event('toolbar') }, scripting: { executeScript: async value => { tabCalls.push({ action: 'inject', ...value }); if (injectionGate?.wait) await injectionGate.wait; if (scriptError) throw Error('Access not granted'); } }
  };
  vm.runInNewContext(script, { browser, console, URL, TextEncoder, crypto, setTimeout, clearTimeout });
  return { listeners, calls, tabCalls, session, tabs };
}
const savedId = 'b'.repeat(64), historySender = { tab: { id: 1 }, url: 'https://example.org/current', frameId: 0 };
test('History resolves its saved source and opens the article sidebar once its new tab loads', async () => {
  const f = fixture({ savedPaper: { id: savedId, url: 'https://example.org/saved' }, createdStatus: 'loading' });
  const opening = f.listeners.rpc({ type: 'paperchat.open-history', id: savedId, url: 'https://untrusted.example/wrong' }, historySender);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.tabs.get(2)?.url, 'https://example.org/saved');
  assert.equal(f.tabCalls.some(call => call.action === 'inject'), false);
  f.tabs.set(2, { id: 2, status: 'complete', url: 'https://example.org/saved' }); f.listeners.updated(2, { status: 'complete' }, f.tabs.get(2));
  const result = await opening; assert.equal(result.ok, true);
  assert.equal(f.tabCalls.filter(call => call.message?.type === 'paperchat.toggle').length, 1);
  assert.equal(f.tabCalls.find(call => call.message?.type === 'paperchat.toggle').message.documentToken, 'fixture-document');
  assert.equal(f.tabCalls.find(call => call.message?.type === 'paperchat.toggle').message.openOnly, true);
  f.listeners.updated(2, { status: 'complete' }, f.tabs.get(2)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.tabCalls.filter(call => call.message?.type === 'paperchat.toggle').length, 1);
});
test('History uses the memory-only PDF reader and local-file guidance without opening unsafe or missing sources', async () => {
  const f = fixture({ savedPaper: { id: savedId, url: 'https://example.org/saved.pdf' } });
  assert.equal((await f.listeners.rpc({ type: 'paperchat.open-history', id: savedId }, historySender)).ok, true);
  assert.match(f.tabs.get(2).url, /^extension:\/\/paperchat\/reader.html#/);
  const token = new URL(f.tabs.get(2).url).hash.slice(1);
  assert.equal(f.session['paperchat.reader-token.' + token].source, 'https://example.org/saved.pdf');
  for (const url of ['', 'javascript:alert(1)', 'file:///private/source.pdf']) {
    const local = fixture({ savedPaper: { id: savedId, url } });
    const result = await local.listeners.rpc({ type: 'paperchat.open-history', id: savedId }, historySender);
    assert.equal(local.tabCalls.length, 0);
    if (!url) { assert.equal(result.ok, true); assert.match(result.note, /original local PDF/); }
    else assert.equal(result.ok, false);
  }
  const missing = fixture(); assert.equal((await missing.listeners.rpc({ type: 'paperchat.open-history', id: savedId }, historySender)).ok, false);
});
test('History reports blocked injection and creation failures, and cancels late opening when its source tab closes', async () => {
  const savedPaper = { id: savedId, url: 'https://example.org/saved' };
  const denied = fixture({ savedPaper, scriptError: true });
  const fallback = await denied.listeners.rpc({ type: 'paperchat.open-history', id: savedId }, historySender);
  assert.equal(fallback.ok, true); assert.match(fallback.note, /toolbar/); assert.equal(denied.tabCalls.filter(call => call.action === 'create').length, 1);
  const failed = fixture({ savedPaper, createError: true });
  assert.equal((await failed.listeners.rpc({ type: 'paperchat.open-history', id: savedId }, historySender)).ok, false);
  let release; const historyReadGate = { wait: new Promise(resolve => { release = resolve; }) }, late = fixture({ savedPaper, historyReadGate });
  const opening = late.listeners.rpc({ type: 'paperchat.open-history', id: savedId }, historySender);
  await new Promise(resolve => setImmediate(resolve)); await late.listeners.removed(1); release();
  assert.equal((await opening).ok, false); assert.equal(late.tabCalls.length, 0);
  const closed = fixture({ savedPaper, createdStatus: 'loading' });
  const load = closed.listeners.rpc({ type: 'paperchat.open-history', id: savedId }, historySender);
  await new Promise(resolve => setImmediate(resolve)); await closed.listeners.removed(2);
  assert.equal((await load).ok, false); assert.equal(closed.tabCalls.some(call => call.action === 'inject'), false);
});
test('History rejects invalid IDs, unknown callers and forged reader bindings before reading saved data', async () => {
  const f = fixture();
  for (const [message, sender] of [[{ type: 'paperchat.open-history', id: '../private' }, historySender], [{ type: 'paperchat.open-history', id: savedId }, {}], [{ type: 'paperchat.open-history', id: savedId, readerToken: crypto.randomUUID() }, historySender], [{ type: 'paperchat.open-history', id: savedId }, { ...historySender, frameId: 1 }]]) {
    assert.equal((await f.listeners.rpc(message, sender)).ok, false);
  }
  assert.equal(f.calls.length, 0); assert.equal(f.tabCalls.length, 0);
});
test('History handles early page completion and a verified PDF reader caller with missing Safari metadata', async () => {
  let release; const createGate = { wait: new Promise(resolve => { release = resolve; }) };
  const early = fixture({ savedPaper: { id: savedId, url: 'https://example.org/saved' }, createdStatus: 'loading', createGate });
  const opening = early.listeners.rpc({ type: 'paperchat.open-history', id: savedId }, historySender);
  await new Promise(resolve => setImmediate(resolve));
  early.tabs.set(2, { id: 2, status: 'complete', url: 'https://example.org/saved' }); early.listeners.updated(2, { status: 'complete' }, early.tabs.get(2)); release();
  assert.equal((await opening).ok, true); assert.equal(early.tabCalls.filter(call => call.message?.type === 'paperchat.toggle').length, 1);
  const reader = fixture({ savedPaper: { id: savedId, url: 'https://example.org/saved' } });
  await reader.listeners.toolbar({ id: 1, url: 'https://example.org/current.pdf' }); await new Promise(resolve => setImmediate(resolve));
  const readerToken = new URL(reader.tabs.get(2).url).hash.slice(1);
  await reader.listeners.rpc({ type: 'paperchat.reader-source', readerToken }, {});
  const result = await reader.listeners.rpc({ type: 'paperchat.open-history', id: savedId, readerTab: 2, readerToken }, {});
  assert.equal(result.ok, true); assert.equal(reader.tabs.get(3).url, 'https://example.org/saved');
  assert.equal(reader.tabCalls.find(call => call.action === 'message').id, 3);
});
test('History never toggles a replacement page or opens a PDF after the caller leaves during asynchronous work', async () => {
  for (const action of ['caller-close', 'caller-navigate', 'target-close', 'target-navigate']) {
    let release; const injectionGate = { wait: new Promise(resolve => { release = resolve; }) };
    const f = fixture({ savedPaper: { id: savedId, url: 'https://example.org/saved' }, injectionGate });
    const opening = f.listeners.rpc({ type: 'paperchat.open-history', id: savedId }, historySender);
    await new Promise(resolve => setImmediate(resolve));
    const tab = action.startsWith('caller') ? 1 : 2;
    if (action.endsWith('close')) await f.listeners.removed(tab); else f.listeners.updated(tab, { status: 'loading' });
    release(); const result = await opening; assert.equal(result.ok, false); assert.match(result.error, /changed/);
    assert.equal(f.tabCalls.some(call => call.message?.type === 'paperchat.toggle'), false);
  }
  let release; const writeGate = { wait: new Promise(resolve => { release = resolve; }) };
  const pdf = fixture({ savedPaper: { id: savedId, url: 'https://example.org/saved.pdf' }, writeGate });
  const opening = pdf.listeners.rpc({ type: 'paperchat.open-history', id: savedId }, historySender);
  await new Promise(resolve => setImmediate(resolve)); await pdf.listeners.removed(1); release();
  assert.equal((await opening).ok, false); assert.equal(pdf.tabCalls.length, 0); assert.equal(Object.keys(pdf.session).length, 0);
});
test('History ignores a stale complete lookup after a new navigation and waits for the current page', async () => {
  let release; const lookupGate = { status: 'complete', wait: new Promise(resolve => { release = resolve; }) };
  const f = fixture({ savedPaper: { id: savedId, url: 'https://example.org/saved' }, createdStatus: 'loading', lookupGate });
  const opening = f.listeners.rpc({ type: 'paperchat.open-history', id: savedId }, historySender);
  await new Promise(resolve => setImmediate(resolve)); f.listeners.updated(2, { status: 'loading' }); release();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.tabCalls.some(call => call.action === 'inject'), false);
  f.tabs.set(2, { id: 2, status: 'complete', url: 'https://example.org/saved' }); f.listeners.updated(2, { status: 'complete' }, f.tabs.get(2));
  assert.equal((await opening).ok, true);
});
test('navigating cancels the old request and preserves received text without paper context', async () => {
  const f = fixture(); const id = 'fixture-request';
  const recovery = { action: 'saveHistory', expectedRevision: 'version-1', paper: { id: 'a'.repeat(64), title: 'Fixture', url: 'https://example.org/paper' }, messages: [{ role: 'user', text: 'Explain', state: 'complete' }, { role: 'assistant', text: '', state: 'incomplete' }] };
  await f.listeners.rpc({ type: 'paperchat.native', payload: { action: 'chat', requestId: id, body: { input: 'PAPER_CONTEXT' }, recovery } }, { tab: { id: 1 }, url: 'https://example.org/paper' });
  await f.listeners.native({ requestId: id, event: { type: 'delta', text: 'Received partial explanation' } });
  f.listeners.updated(1, { status: 'loading' }); await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.calls.some(call => call.action === 'cancel' && call.requestId === id));
  const saved = f.calls.find(call => call.action === 'saveHistory');
  assert.equal(saved.messages[1].text, 'Received partial explanation'); assert.equal(saved.messages[1].state, 'incomplete');
  assert.equal(JSON.stringify(saved).includes('PAPER_CONTEXT'), false); assert.equal(saved.expectedRevision, 'version-1');
});
test('fallback recovery serializes saves and advances versions through the final reply', async () => {
  const f = fixture({ missingReceiver: true }); const id = 'fixture-request';
  const recovery = { action: 'saveHistory', expectedRevision: 'version-1', paper: { id: 'a'.repeat(64), title: 'Fixture', url: 'https://example.org/paper' }, messages: [{ role: 'assistant', text: '', state: 'incomplete' }] };
  await f.listeners.rpc({ type: 'paperchat.native', payload: { action: 'chat', requestId: id, body: {}, recovery } }, { tab: { id: 1 }, url: 'https://example.org/paper' });
  await Promise.all([f.listeners.native({ requestId: id, event: { type: 'delta', text: 'A' } }), f.listeners.native({ requestId: id, event: { type: 'delta', text: 'B' } }), f.listeners.native({ requestId: id, event: { type: 'completed' } })]);
  const saved = f.calls.filter(call => call.action === 'saveHistory'); assert.equal(saved.length, 3);
  assert.equal(saved.at(-1).messages[0].text, 'AB'); assert.equal(saved.at(-1).messages[0].state, 'complete'); assert.equal(saved.at(-1).expectedRevision, 'version-3');
});
test('PDF source survives background suspension and missing Safari sender metadata, then is delivered once', async () => {
  const f = fixture();
  await f.listeners.toolbar({ id: 1, url: 'https://example.org/paper.pdf' });
  await new Promise(resolve => setImmediate(resolve));
  f.listeners.updated(2, { status: 'loading' });
  const resumed = fixture({ session: f.session, tabs: f.tabs, missingTabURL: true, missingQueryURL: true });
  const readerToken = new URL(f.tabs.get(2).url).hash.slice(1);
  const message = { type: 'paperchat.reader-source', readerToken };
  const source = await resumed.listeners.rpc(message, {});
  assert.equal(source.source, 'https://example.org/paper.pdf');
  assert.equal(source.readerTab, 2);
  assert.equal(f.tabs.get(2).url.includes('example.org'), false);
  const second = await resumed.listeners.rpc(message, {}); assert.equal(second.source, '');
  assert.equal(JSON.stringify(f.session).includes('example.org'), false);
});
test('a webpage sender or wrong reader token cannot claim the PDF source', async () => {
  const f = fixture(); await f.listeners.toolbar({ id: 1, url: 'https://example.org/private.pdf?temporary=secret' });
  await new Promise(resolve => setImmediate(resolve));
  const readerToken = new URL(f.tabs.get(2).url).hash.slice(1);
  const denied = await f.listeners.rpc({ type: 'paperchat.reader-source', readerTab: 2, readerToken }, { tab: { id: 1 }, url: 'https://example.org/page' });
  assert.ok(!denied?.source);
  const wrong = await f.listeners.rpc({ type: 'paperchat.reader-source', readerTab: 2, readerToken: crypto.randomUUID() }, {});
  assert.ok(!wrong?.source);
  const valid = await f.listeners.rpc({ type: 'paperchat.reader-source', readerTab: 2, readerToken }, {});
  assert.equal(valid.source, 'https://example.org/private.pdf?temporary=secret');
  await f.listeners.removed(2);
  assert.equal(Object.keys(f.session).length, 0);
});
test('closing or navigating a reader during its tab lookup prevents late inference', async () => {
  for (const change of ['close', 'navigate']) {
    const lookupGate = {}, f = fixture({ lookupGate });
    await f.listeners.toolbar({ id: 1, url: 'https://example.org/paper.pdf' });
    await new Promise(resolve => setImmediate(resolve));
    const url = f.tabs.get(2).url, readerToken = new URL(url).hash.slice(1);
    let release; lookupGate.wait = new Promise(resolve => { release = resolve; });
    const pending = f.listeners.rpc({ type: 'paperchat.native', readerTab: 2, readerToken, payload: { action: 'chat', requestId: 'late-request', body: {} } }, { url, tab: { id: 2 } });
    await new Promise(resolve => setImmediate(resolve));
    if (change === 'close') await f.listeners.removed(2); else f.listeners.updated(2, { status: 'loading' });
    release(); const reply = await pending;
    assert.equal(reply.ok, false); assert.equal(f.calls.some(call => call.action === 'chat'), false);
  }
});
test('navigation during the first token lookup prevents inference even when Safari omits tab URLs', async () => {
  const storageGate = {}, f = fixture({ storageGate, missingTabURL: true });
  await f.listeners.toolbar({ id: 1, url: 'https://example.org/paper.pdf' });
  await new Promise(resolve => setImmediate(resolve));
  const readerToken = new URL(f.tabs.get(2).url).hash.slice(1);
  const resumed = fixture({ storageGate, missingTabURL: true, session: f.session, tabs: f.tabs });
  let release; storageGate.wait = new Promise(resolve => { release = resolve; });
  const pending = resumed.listeners.rpc({ type: 'paperchat.native', readerToken, payload: { action: 'chat', requestId: 'late-token-request', body: {} } }, {});
  await new Promise(resolve => setImmediate(resolve));
  resumed.listeners.updated(2, { status: 'loading' }); release();
  const reply = await pending;
  assert.equal(reply.ok, false); assert.equal(resumed.calls.some(call => call.action === 'chat'), false);
});
test('reader can claim its source before Safari finishes creating the tab without restoring a consumed source', async () => {
  let release; const createGate = { wait: new Promise(resolve => { release = resolve; }) }, f = fixture({ createGate });
  await f.listeners.toolbar({ id: 1, url: 'https://example.org/paper.pdf' });
  await new Promise(resolve => setImmediate(resolve));
  const url = f.tabs.get(2).url, readerToken = new URL(url).hash.slice(1), message = { type: 'paperchat.reader-source', readerToken };
  const first = await f.listeners.rpc(message, { url, tab: { id: 2 } });
  assert.equal(first.source, 'https://example.org/paper.pdf'); assert.equal(first.readerTab, 2);
  release(); await new Promise(resolve => setImmediate(resolve));
  const second = await f.listeners.rpc(message, { url, tab: { id: 2 } });
  assert.equal(second.source, ''); assert.equal(JSON.stringify(f.session).includes('example.org'), false);
});
test('concurrent early source claims cannot replace the reader that first owns the nonce', async () => {
  let release; const createGate = { wait: new Promise(resolve => { release = resolve; }) }, f = fixture({ createGate });
  await f.listeners.toolbar({ id: 1, url: 'https://example.org/paper.pdf' });
  await new Promise(resolve => setImmediate(resolve));
  const url = f.tabs.get(2).url, readerToken = new URL(url).hash.slice(1), message = { type: 'paperchat.reader-source', readerToken };
  f.tabs.set(3, { id: 3, url });
  const [first, second] = await Promise.all([f.listeners.rpc(message, { url, tab: { id: 2 } }), f.listeners.rpc(message, { url, tab: { id: 3 } })]);
  assert.equal(first.source, 'https://example.org/paper.pdf'); assert.equal(first.readerTab, 2);
  assert.equal(second.source, ''); assert.notEqual(second.readerTab, 3);
  release(); await new Promise(resolve => setImmediate(resolve));
  const original = await f.listeners.rpc(message, { url, tab: { id: 2 } }); assert.equal(original.readerTab, 2);
});
test('creation cleanup preserves an early owner in another live reader', async () => {
  for (const change of ['close', 'fail']) {
    let release, reject; const createGate = { wait: new Promise((resolve, fail) => { release = resolve; reject = fail; }) }, f = fixture({ createGate });
    await f.listeners.toolbar({ id: 1, url: 'https://example.org/paper.pdf' });
    await new Promise(resolve => setImmediate(resolve));
    const url = f.tabs.get(2).url, readerToken = new URL(url).hash.slice(1), message = { type: 'paperchat.reader-source', readerToken };
    f.tabs.set(3, { id: 3, url });
    const early = await f.listeners.rpc(message, { url, tab: { id: 3 } }); assert.equal(early.readerTab, 3);
    if (change === 'close') { await f.listeners.removed(2); release(); } else reject(Error('Creation failed'));
    await new Promise(resolve => setImmediate(resolve));
    const owner = await f.listeners.rpc(message, { url, tab: { id: 3 } }); assert.equal(owner.readerTab, 3);
    await f.listeners.removed(3); assert.equal(Object.keys(f.session).length, 0);
  }
});
test('reader reload during source consumption retains its binding but closing removes it', async () => {
  for (const change of ['navigate', 'close']) {
    const writeGate = {}, f = fixture({ writeGate });
    await f.listeners.toolbar({ id: 1, url: 'https://example.org/paper.pdf' });
    await new Promise(resolve => setImmediate(resolve));
    const readerToken = new URL(f.tabs.get(2).url).hash.slice(1), message = { type: 'paperchat.reader-source', readerToken };
    let release; writeGate.wait = new Promise(resolve => { release = resolve; });
    const pending = f.listeners.rpc(message, {});
    await new Promise(resolve => setImmediate(resolve));
    if (change === 'close') await f.listeners.removed(2); else f.listeners.updated(2, { status: 'loading' });
    release(); const old = await pending; assert.equal(old.source, '');
    writeGate.wait = undefined;
    const fresh = await f.listeners.rpc(message, {});
    if (change === 'close') assert.equal(Object.keys(f.session).length, 0);
    else { assert.equal(fresh.readerTab, 2); assert.equal(fresh.source, ''); }
  }
});
