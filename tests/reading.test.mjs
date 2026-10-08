import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { webcrypto } from 'node:crypto';

async function moduleFrom(path) {
  const result = await build({ entryPoints: [path], bundle: true, format: 'esm', platform: 'node', write: false });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const core = await moduleFrom('extension/src/core.ts');
const { extractPaper } = await moduleFrom('extension/src/extract.ts');
const { renderSourceReferences } = await moduleFrom('extension/src/citations.ts');
const content = (await build({ entryPoints: ['extension/src/content.ts'], bundle: true, format: 'iife', write: false })).outputFiles[0].text;
const paper = { id: 'a'.repeat(64), title: 'Example study', url: 'https://example.org/paper', kind: 'pdf', currentPage: 8,
  blocks: Array.from({ length: 80 }, (_, i) => ({ id: `P${i + 1}B1`, page: i + 1, label: `PDF page ${i + 1}`, text: (i === 47 ? 'enzyme perturbation result ' : 'scientific observation ') + 'x'.repeat(4200) })) };

test('long-paper retrieval includes current page and question evidence within the input budget', () => {
  const selected = core.selectContext(paper, 'Explain the enzyme perturbation result', '', 20000);
  assert.equal(selected.partial, true);
  assert.ok(selected.text.length <= 20000);
  assert.ok(selected.blocks.some(block => block.page === 8));
  assert.ok(selected.blocks.some(block => block.page === 48));
});
test('saved data excludes paper contents, images and model input while retaining chat and source links', () => {
  const messages = [core.newMessage('user', 'Why this method?')];
  const payload = core.historyPayload({ ...paper, privatePDF: 'PRIVATE_BYTES', url: 'https://name:secret@example.org/paper?doi=123&token=private#page=2' }, messages);
  assert.deepEqual(Object.keys(payload.paper).sort(), ['id', 'title', 'url']);
  assert.equal(payload.paper.url, 'https://example.org/paper?doi=123');
  assert.equal(JSON.stringify(payload).includes('PRIVATE_BYTES'), false);
  assert.equal(JSON.stringify(payload).includes('scientific observation'), false);
  assert.equal(payload.messages[0].text, 'Why this method?');
  assert.equal(core.sourceURL('file:///private/paper.pdf'), '');
});
test('request has automatic context and an explicit image but excludes incomplete previous replies', () => {
  const request = core.requestBody(paper, [core.newMessage('assistant', 'old failed draft', 'incomplete')], 'What changed?', 'selected passage', { dataURL: 'data:image/jpeg;base64,AAAA', label: 'Figure 2' }, 'account-model');
  assert.equal(request.body.store, false); assert.equal(request.body.stream, true);
  assert.equal(request.body.input.length, 2);
  assert.match(request.body.input[0].content[0].text, /Currently viewing PDF page 8/);
  assert.match(request.body.input[1].content[0].text, /selected passage/);
  assert.equal(request.body.input[1].content[1].type, 'input_image');
  assert.match(request.body.instructions, /Only part of the paper/);
});
test('reasoning selection reaches the request while model default omits the parameter', () => {
  const base = [paper, [], 'Explain the methods', '', null, 'account-model'];
  assert.equal(core.requestBody(...base).body.reasoning, undefined);
  assert.deepEqual(core.requestBody(...base, 'max').body.reasoning, { effort: 'max' });
  assert.throws(() => core.requestBody(...base, 'unsupported'), /reasoning/i);
});
test('HTML extraction finds paper sections without requiring a selection', async () => {
  const dom = new JSDOM('<head><meta name="citation_title" content="A scientific study"></head><body><nav><p>Navigation should not be sent</p></nav><article><h1>A scientific study</h1><h2>Methods</h2><p>We used a randomized experiment with 300 participants.</p><figcaption>Figure 1: Estimated response.</figcaption></article></body>', { url: 'https://example.org/study?utm_source=mail' });
  const result = await extractPaper(dom.window.document);
  assert.equal(result.paper.url, 'https://example.org/study');
  assert.equal(result.paper.title, 'A scientific study');
  assert.ok(result.paper.blocks.some(b => b.label === 'Methods' && b.text.includes('300 participants')));
  assert.ok(!result.paper.blocks.some(b => b.text.includes('Navigation')));
  assert.equal(result.paper.id.length, 64); dom.window.close();
});

function fixture({ immediateCompletion = false, holdDraft = false, models = [{ slug: 'fixture-model', name: 'Fixture model', reasoningLevels: ['low', 'medium', 'high'] }], preferences = {}, conversation = null, historyPapers = [], historyOpenReply = { ok: true }, historyOpenGate, html = '<html style="width:95%"><head><title>Study</title></head><body><article><h1>Reading fixture study</h1><p>The experiment randomized 300 participants to two treatment groups.</p></article></body></html>' } = {}) {
  const dom = new JSDOM(html, { url: 'https://example.org/fixture', runScripts: 'outside-only', pretendToBeVisual: true });
  const window = dom.window; Object.defineProperty(window, 'crypto', { value: webcrypto });
  const listeners = new Set(), calls = [], runtimeCalls = [], roots = [], stored = { 'paperchat.preferences': preferences };
  const originalShadow = window.Element.prototype.attachShadow;
  window.Element.prototype.attachShadow = function (options) { const root = originalShadow.call(this, options); roots.push(root); return root; };
  let revision = '';
  let releaseDraft; const draftGate = new Promise(resolve => { releaseDraft = resolve; }); let held = false;
  const emit = event => { for (const listener of [...listeners]) listener(event); };
  window.browser = { runtime: {
    onMessage: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) },
    sendMessage: async message => {
      runtimeCalls.push(message);
      if (message.type === 'paperchat.open-history') { if (historyOpenGate) await historyOpenGate; return historyOpenReply; }
      const payload = message.payload; calls.push(payload);
      if (payload.action === 'status') return { ok: true, connected: true, historyReady: true };
      if (payload.action === 'readHistory') return { ok: true, conversation };
      if (payload.action === 'listHistory') return { ok: true, papers: historyPapers };
      if (payload.action === 'models') return { ok: true, models };
      if (payload.action === 'saveHistory') { if (holdDraft && !held) { held = true; await draftGate; } assert.equal(payload.expectedRevision, revision); return { ok: true, revision: (revision = webcrypto.randomUUID()) }; }
      if (payload.action === 'chat' && immediateCompletion) {
        emit({ type: 'paperchat.event', requestId: payload.requestId, event: { type: 'completed' } });
      }
      return { ok: true };
    }
  }, storage: { local: { get: async key => ({ [key]: stored[key] }), set: async value => { Object.assign(stored, value); } } } };
  window.eval(content);
  return { dom, window, calls, runtimeCalls, roots, stored, emit, releaseDraft, async rpc(message) { for (const listener of [...listeners]) { const reply = await listener(message); if (reply) return reply; } }, async open() { for (const listener of [...listeners]) await listener({ type: 'paperchat.toggle' }); await until(() => roots.at(-1)?.getElementById('send').disabled === false); return roots.at(-1); } };
}
async function until(predicate) { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('UI did not reach the expected state'); }
test('History opens through the background without a content-script tabs API and prevents duplicate clicks', async () => {
  let release; const historyOpenGate = new Promise(resolve => { release = resolve; });
  const f = fixture({ historyPapers: [{ id: 'b'.repeat(64), title: 'Saved paper', url: 'https://example.org/saved' }], historyOpenGate });
  f.window.addEventListener('error', event => event.preventDefault());
  try {
    const root = await f.open(); root.getElementById('saved').click();
    await until(() => root.querySelector('#saved-list button'));
    const entry = root.querySelector('#saved-list button'); entry.click(); entry.click();
    await until(() => f.runtimeCalls.some(call => call.type === 'paperchat.open-history'));
    const requests = f.runtimeCalls.filter(call => call.type === 'paperchat.open-history');
    assert.equal(requests.length, 1); assert.equal(requests[0].id, 'b'.repeat(64));
    assert.equal(requests[0].url, undefined); assert.equal(entry.disabled, true);
    release(); await until(() => !entry.disabled);
    assert.match(root.getElementById('status').textContent, /opened/i);
  } finally { release(); f.dom.window.close(); }
});
test('History reports opening failures and gives local PDF guidance visibly', async () => {
  const f = fixture({ historyPapers: [{ id: 'b'.repeat(64), title: 'Saved paper', url: 'https://example.org/saved' }, { id: 'c'.repeat(64), title: 'Local paper', url: '' }], historyOpenReply: { ok: false, error: 'The saved source could not be opened.' } });
  f.window.addEventListener('error', event => event.preventDefault());
  try {
    const root = await f.open(); root.getElementById('saved').click(); await until(() => root.querySelector('#saved-list button'));
    const entries = root.querySelectorAll('#saved-list button'); entries[0].click();
    await until(() => root.getElementById('status').classList.contains('error'));
    assert.match(root.getElementById('status').textContent, /source could not be opened/); assert.equal(entries[0].disabled, false);
    entries[1].click(); assert.match(root.getElementById('status').textContent, /original local PDF/);
    assert.equal(f.runtimeCalls.filter(call => call.type === 'paperchat.open-history').length, 1);
  } finally { f.dom.window.close(); }
});
test('automatic History opening cannot toggle a different content-script document', async () => {
  const original = fixture(), replacement = fixture();
  try {
    const identity = await original.rpc({ type: 'paperchat.document' });
    const response = await replacement.rpc({ type: 'paperchat.toggle', documentToken: identity.documentToken });
    assert.equal(response.pageChanged, true); assert.equal(replacement.roots.length, 0);
    const own = await replacement.rpc({ type: 'paperchat.document' });
    const wrongPaper = await replacement.rpc({ type: 'paperchat.toggle', documentToken: own.documentToken, expectedPaperId: 'b'.repeat(64) });
    assert.equal(wrongPaper.pageChanged, true); assert.equal(replacement.roots.length, 0);
  } finally { original.dom.window.close(); replacement.dom.window.close(); }
});
test('automatic History opening retains an already-open sidebar and its draft while toolbar toggling still closes it', async () => {
  const f = fixture();
  try {
    const root = await f.open(); root.getElementById('question').value = 'An unsent draft';
    const identity = await f.rpc({ type: 'paperchat.document' });
    const { paper: saved } = await extractPaper(f.window.document);
    const opening = { type: 'paperchat.toggle', openOnly: true, documentToken: identity.documentToken, expectedPaperId: saved.id };
    assert.equal((await f.rpc(opening)).ok, true);
    assert.equal((await f.rpc(opening)).ok, true);
    assert.equal(f.roots.length, 1); assert.equal(root.host.isConnected, true);
    assert.equal(root.getElementById('question').value, 'An unsent draft');
    assert.equal((await f.rpc({ type: 'paperchat.toggle' })).ok, true);
    assert.equal(root.host.isConnected, false);
  } finally { f.dom.window.close(); }
});
test('citations use compact stable numbers, remove adjacent duplicates, and keep distinct passage jumps', async () => {
  const f = fixture({ html: '<article><h1>Study</h1><h2>A long methods section title</h2><p>First source passage describes random assignment.</p><p>Second source passage describes six-month follow-up.</p></article>',
    conversation: { messages: [core.newMessage('assistant', 'First claim [S3, S3, S4] [S4]. Another claim [S3]. Unknown [S999]. Code `[S3]` and [external citation](https://example.org/[S3]).')] } });
  try {
    const root = await f.open();
    const refs = [...root.querySelectorAll('.answer .ref')];
    assert.deepEqual(refs.map(b => b.textContent), ['1', '2', '1']);
    assert.deepEqual(refs.map(b => b.dataset.sourceId), ['S3', 'S4', 'S3']);
    assert.match(refs[0].getAttribute('aria-label'), /Source 1.*long methods section/);
    assert.match(root.querySelector('.answer').textContent, /\[S999\]/);
    assert.equal(root.querySelector('code').textContent, '[S3]');
    const sources = root.querySelector('details.sources');
    assert.equal(sources.open, false);
    assert.equal(sources.querySelectorAll('.source-label').length, 1);
    assert.equal(sources.querySelector('.source-label').textContent, 'A long methods section title');
    assert.deepEqual([...sources.querySelectorAll('.source-ref')].map(b => b.textContent), ['1', '2']);
    const jumps = []; const paragraphs = f.window.document.querySelectorAll('p');
    paragraphs.forEach((p, i) => { p.scrollIntoView = () => jumps.push(i); });
    refs[0].click(); refs[1].click(); sources.querySelector('.source-ref').click();
    assert.deepEqual(jumps, [0, 1, 0]);
  } finally { f.dom.window.close(); }
});
test('secondary controls live in Chat options and the model and reasoning menus remain visible', async () => {
  const f = fixture();
  try {
    const root = await f.open(), options = root.querySelector('details.options');
    assert.ok(options); assert.equal(options.open, false);
    for (const id of ['saved', 'export', 'delete', 'setup']) assert.ok(options.contains(root.getElementById(id)));
    assert.ok(options.querySelector('a[href="https://chatgpt.com/settings/usage"]'));
    assert.equal(options.contains(root.getElementById('model')), false);
    assert.equal(options.contains(root.getElementById('effort')), false);
    options.open = true; root.getElementById('methods').click(); await until(() => /methods/.test(root.getElementById('question').value));
    assert.equal(options.open, false);
    options.open = true; options.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(options.open, false);
  } finally { f.dom.window.close(); }
});
test('PDF citations consolidate page destinations without losing jumps, and source labels stay plain text', () => {
  const dom = new JSDOM('<div id="answer"><p>Methods [P1B1, P1B2] [P1B2]. Results [P2B1]. Methods again [P1B2].</p></div>');
  try {
    const answer = dom.window.document.getElementById('answer'), jumps = [];
    const pdf = { ...paper, blocks: [
      { id: 'P1B1', page: 1, text: 'First chunk', label: 'First page' },
      { id: 'P1B2', page: 1, text: 'Second chunk', label: 'First page' },
      { id: 'P2B1', page: 2, text: 'Results', label: 'Second page' }
    ] };
    const sources = renderSourceReferences(answer, pdf, id => jumps.push(id)); answer.append(sources);
    assert.deepEqual([...answer.querySelectorAll('.ref')].map(b => b.textContent), ['1', '2', '1']);
    assert.deepEqual([...sources.querySelectorAll('.source-label')].map(b => b.textContent), ['Page 1', 'Page 2']);
    assert.equal(sources.querySelectorAll('.source-ref').length, 2);
    answer.querySelectorAll('.ref')[1].click(); sources.querySelector('.source-ref').click();
    assert.deepEqual(jumps, ['P2B1', 'P1B1']);
    answer.innerHTML = '<p>Claim [S1].</p>';
    const malicious = '<img src=x onerror="window.hacked=1">';
    const safe = renderSourceReferences(answer, { ...pdf, kind: 'html', blocks: [{ id: 'S1', label: malicious, text: 'Plain source' }] }, () => {}); answer.append(safe);
    assert.equal(answer.querySelector('img'), null);
    assert.equal(safe.querySelector('.source-label').textContent, malicious);
    assert.equal(dom.window.hacked, undefined);
  } finally { dom.window.close(); }
});
test('expanded sources stay expanded as the reply streams and the existing chat text is saved unchanged', async () => {
  const f = fixture();
  try {
    const root = await f.open(); root.getElementById('question').value = 'Explain'; root.getElementById('send').click();
    await until(() => f.calls.some(call => call.action === 'chat'));
    const chat = f.calls.find(call => call.action === 'chat');
    const text = 'A finding [S2, S2].';
    f.emit({ type: 'paperchat.event', requestId: chat.requestId, event: { type: 'delta', text } });
    await until(() => root.querySelector('details.sources'));
    root.querySelector('details.sources').open = true;
    f.emit({ type: 'paperchat.event', requestId: chat.requestId, event: { type: 'delta', text: ' More detail [S2].' } });
    await until(() => root.querySelector('.answer').textContent.includes('More detail'));
    assert.equal(root.querySelector('details.sources').open, true);
    f.emit({ type: 'paperchat.event', requestId: chat.requestId, event: { type: 'completed' } });
    await until(() => f.calls.filter(call => call.action === 'saveHistory').length === 2);
    assert.equal(root.querySelector('details.sources').open, true);
    const saved = f.calls.filter(call => call.action === 'saveHistory').at(-1);
    assert.equal(saved.messages[1].text, text + ' More detail [S2].');
    assert.equal(saved.messages[1].text.includes('Sources'), false);
  } finally { f.dom.window.close(); }
});
test('sidebar offers supported reasoning, remembers only preferences, and sends the chosen level', async () => {
  const f = fixture({ preferences: { model: 'fixture-model', effort: 'high' }, models: [
    { slug: 'fixture-model', name: 'Fixture model', reasoningLevels: ['low', 'high'] },
    { slug: 'other-model', name: 'Other model', reasoningLevels: ['medium'] }
  ] });
  try {
    let root = await f.open();
    const effort = root.getElementById('effort');
    assert.ok(effort, 'A reasoning picker is visible separately from the model');
    assert.deepEqual([...effort.options].map(o => o.value), ['', 'low', 'high']);
    assert.equal(effort.value, 'high');
    effort.value = 'low'; effort.dispatchEvent(new f.window.Event('change'));
    await until(() => f.stored['paperchat.preferences'].effort === 'low');
    root.getElementById('question').value = 'Summarize'; root.getElementById('send').click();
    await until(() => f.calls.some(call => call.action === 'chat'));
    const chat = f.calls.find(call => call.action === 'chat');
    assert.equal(chat.body.reasoning.effort, 'low');
    assert.equal(effort.disabled, true);
    f.emit({ type: 'paperchat.event', requestId: chat.requestId, event: { type: 'completed' } });
    await until(() => !effort.disabled);
    root.getElementById('close').click(); await until(() => !f.window.document.querySelector('[data-paperchat="pane"]'));
    root = await f.open(); assert.equal(root.getElementById('effort').value, 'low');
    const model = root.getElementById('model'); model.value = 'other-model'; model.dispatchEvent(new f.window.Event('change'));
    await until(() => f.stored['paperchat.preferences'].model === 'other-model');
    assert.deepEqual([...root.getElementById('effort').options].map(o => o.value), ['', 'medium']);
    assert.equal(root.getElementById('effort').value, '');
    assert.deepEqual(Object.keys(f.stored['paperchat.preferences']).sort(), ['effort', 'model']);
    assert.equal(JSON.stringify(f.stored).includes('300 participants'), false);
  } finally { f.dom.window.close(); }
});
test('Safari sidebar submits page context, streams sanitized Markdown, saves only history and restores layout', async () => {
  const f = fixture();
  try {
    const root = await f.open(); assert.match(f.window.document.documentElement.style.width, /400px/);
    root.getElementById('question').value = 'How many participants?'; root.getElementById('send').click();
    await until(() => f.calls.some(call => call.action === 'chat'));
    const chat = f.calls.find(call => call.action === 'chat'); assert.match(chat.body.input[0].content[0].text, /300 participants/);
    f.emit({ type: 'paperchat.event', requestId: chat.requestId, event: { type: 'delta', text: '300 participants [S2, S1]. <script>window.hacked = 1</script> [bad](javascript:alert(1))' } });
    f.emit({ type: 'paperchat.event', requestId: chat.requestId, event: { type: 'completed' } });
    await until(() => f.calls.filter(call => call.action === 'saveHistory').length === 2);
    assert.equal(root.querySelector('script'), null); assert.equal(root.querySelector('[href^="javascript:"]'), null);
    assert.equal(f.window.hacked, undefined); assert.equal(root.querySelectorAll('.ref').length, 2);
    const saved = f.calls.filter(call => call.action === 'saveHistory').at(-1);
    assert.equal(saved.messages[1].state, 'complete'); assert.equal(saved.paper.blocks, undefined);
    root.getElementById('close').click(); await until(() => !f.window.document.querySelector('[data-paperchat="pane"]'));
    assert.equal(f.window.document.documentElement.style.width, '95%');
  } finally { f.dom.window.close(); }
});
test('reply completed before native acknowledgement does not leave the Send button stuck', async () => {
  const f = fixture({ immediateCompletion: true });
  try { const root = await f.open(); root.getElementById('question').value = 'Summarize'; root.getElementById('send').click();
    await until(() => f.calls.filter(call => call.action === 'saveHistory').length === 2);
    assert.equal(root.getElementById('send').disabled, false); assert.equal(root.getElementById('stop').classList.contains('hidden'), true);
    assert.match(root.getElementById('status').textContent, /Saved locally/);
  } finally { f.dom.window.close(); }
});
test('stopping a response saves the partial text with a cancelled state', async () => {
  const f = fixture();
  try { const root = await f.open(); root.getElementById('question').value = 'Explain'; root.getElementById('send').click(); await until(() => f.calls.some(call => call.action === 'chat'));
    const chat = f.calls.find(call => call.action === 'chat'); f.emit({ type: 'paperchat.event', requestId: chat.requestId, event: { type: 'delta', text: 'Partial explanation' } });
    root.getElementById('stop').click(); await until(() => f.calls.filter(call => call.action === 'saveHistory').length === 2);
    const last = f.calls.filter(call => call.action === 'saveHistory').at(-1); assert.equal(last.messages[1].text, 'Partial explanation'); assert.equal(last.messages[1].state, 'cancelled');
  } finally { f.dom.window.close(); }
});
test('Stop during a pending draft save never starts inference', async () => {
  const f = fixture({ holdDraft: true });
  try { const root = await f.open(); root.getElementById('question').value = 'Explain'; root.getElementById('send').click();
    await until(() => f.calls.some(call => call.action === 'saveHistory'));
    root.getElementById('stop').click(); await until(() => f.calls.some(call => call.action === 'cancel'));
    f.releaseDraft(); await until(() => f.calls.filter(call => call.action === 'saveHistory').length === 2);
    assert.equal(f.calls.some(call => call.action === 'chat'), false);
  } finally { f.releaseDraft(); f.dom.window.close(); }
});
