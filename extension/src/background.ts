import { NativeReply, historyPayload, sourceURL } from './core';

interface Route { tab: number; reader: boolean; recovery?: ReturnType<typeof historyPayload> & { expectedRevision: string }; recoveryChain?: Promise<void> }
const routes = new Map<string, Route>();
interface ReaderSource { tab?: number; source?: string }
const readerSources = new Map<string, ReaderSource>();
const readerTabs = new Map<number, string>();
const readerKey = (tab: number) => 'paperchat.reader.' + tab;
const tokenKey = (token: string) => 'paperchat.reader-token.' + token;
let sourceClaims: Promise<unknown> = Promise.resolve();
function sourceTask<T>(action: () => Promise<T>) {
  const task = sourceClaims.then(action); sourceClaims = task.catch(() => {}); return task;
}
const tabVersions = new Map<number, number>();
const closedTabs = new Set<number>();
const historyLoads = new Map<number, { complete: (tab: browser.tabs.Tab) => void; fail: (error: Error) => void }>();
let lifecycleSerial = 0;
const tabVersion = (tab: number) => tabVersions.get(tab) ?? 0;
const stillOpen = (tab: number, version: number) => !closedTabs.has(tab) && tabVersion(tab) === version;
function isReaderPage(value?: string) {
  try {
    const actual = new URL(value ?? ''), expected = new URL(browser.runtime.getURL('reader.html'));
    return actual.protocol === expected.protocol && actual.host.toLowerCase() === expected.host.toLowerCase() && actual.pathname === expected.pathname;
  } catch { return false; }
}
async function readerSource(token: string) {
  const cached = readerSources.get(token); if (cached) return cached;
  const stored = (await browser.storage.session?.get(tokenKey(token)))?.[tokenKey(token)] as ReaderSource | undefined;
  if (stored) readerSources.set(token, stored); return stored;
}
async function rememberReader(token: string, value: ReaderSource) {
  readerSources.set(token, value);
  // storage.session is RAM-only and survives a suspended MV3 background page.
  if (value.tab !== undefined) readerTabs.set(value.tab, token);
  await browser.storage.session?.set({ [tokenKey(token)]: value, ...(value.tab === undefined ? {} : { [readerKey(value.tab)]: token }) });
}
async function forgetReader(tab: number) {
  const token = readerTabs.get(tab) ?? (await browser.storage.session?.get(readerKey(tab)))?.[readerKey(tab)];
  readerTabs.delete(tab); await browser.storage.session?.remove(readerKey(tab));
  if (typeof token !== 'string') return;
  const value = await readerSource(token);
  if (value?.tab !== undefined && value.tab !== tab) return;
  readerSources.delete(token); await browser.storage.session?.remove(tokenKey(token));
}
async function discardUnclaimed(token: string) {
  if ((await readerSource(token))?.tab !== undefined) return;
  readerSources.delete(token); await browser.storage.session?.remove(tokenKey(token));
}
async function readerOwner(message: any, sender: browser.runtime.MessageSender, startedAt: number, failed: (reason: string) => void) {
  const trustedURL = isReaderPage(sender.url);
  if (sender.url && !trustedURL) { failed('Safari reported a different sender page.'); return; }
  const token = typeof message.readerToken === 'string' ? message.readerToken : '';
  if (!trustedURL && !/^[a-f0-9-]{36}$/i.test(token)) { failed('The reader token is missing.'); return; }
  const sourceBinding = await readerSource(token);
  if (!sourceBinding) { failed('The source handoff is no longer available.'); return; }
  let tabId = sender.tab?.id ?? (Number.isInteger(message.readerTab) ? message.readerTab : sourceBinding.tab);
  let activeTab: browser.tabs.Tab | undefined;
  if (tabId === undefined) { activeTab = (await browser.tabs.query({ active: true, currentWindow: true }))[0]; tabId = activeTab?.id; }
  if (tabId === undefined) { failed('Safari did not identify the reader tab.'); return; }
  const version = tabVersion(tabId);
  if (closedTabs.has(tabId) || version > startedAt) return;
  const tab = await browser.tabs.get(tabId).catch(() => undefined);
  if (!tab || (tab.url && !isReaderPage(tab.url))) { failed('Safari has not identified this tab as the PDF reader.'); return; }
  if (tab.url && token !== new URL(tab.url).hash.slice(1)) { failed('The reader tab token did not match.'); return; }
  // Safari can omit both sender.url and sender.tab for an extension page.
  // An unguessable token, its actual reader tab, and RAM-only binding are required then.
  if (sourceBinding.tab !== undefined && sourceBinding.tab !== tabId) return;
  const visibleURL = tab.url ?? activeTab?.url;
  if (sourceBinding.tab === undefined && !trustedURL && (!isReaderPage(visibleURL) || new URL(visibleURL!).hash.slice(1) !== token)) return;
  if (!stillOpen(tabId, version)) return;
  return { tabId, version, token };
}
async function preserve(route: Route, state: 'incomplete' | 'complete' = 'incomplete') {
  if (!route.recovery) return;
  const recovery = route.recovery;
  const messages = recovery.messages.map(message => ({ ...message }));
  const last = messages.at(-1); if (last?.role === 'assistant') last.state = state;
  const task = (route.recoveryChain ?? Promise.resolve()).then(async () => {
    const reply = await browser.runtime.sendNativeMessage('local.paperchat.PaperChat', { ...recovery, messages, expectedRevision: recovery.expectedRevision }) as NativeReply;
    if (reply?.ok && typeof reply.revision === 'string') recovery.expectedRevision = reply.revision;
  });
  route.recoveryChain = task.catch(() => {}); await route.recoveryChain;
}
function leaveTab(tab: number) {
  tabVersions.set(tab, ++lifecycleSerial);
  for (const [id, route] of routes) if (route.tab === tab) {
    routes.delete(id);
    void browser.runtime.sendNativeMessage('local.paperchat.PaperChat', { action: 'cancel', requestId: id }).catch(() => {});
    void preserve(route);
  }
}
async function publish(route: Route, value: any) {
  if (route.reader) await browser.runtime.sendMessage(value);
  else await browser.tabs.sendMessage(route.tab, value);
}
async function openReader(source: string, current = () => true) {
  const token = crypto.randomUUID();
  await rememberReader(token, { source });
  try {
    if (!current()) { await sourceTask(() => discardUnclaimed(token)); return false; }
    const tab = await browser.tabs.create({ url: browser.runtime.getURL('reader.html') + '#' + token });
    if (tab.id === undefined) { await sourceTask(() => discardUnclaimed(token)); return false; }
    const tabId = tab.id;
    return await sourceTask(async () => {
      if (!current()) { await discardUnclaimed(token); return false; }
      if (closedTabs.has(tabId)) { await forgetReader(tabId); await discardUnclaimed(token); return false; }
      const value = await readerSource(token);
      if (value && value.tab === undefined) await rememberReader(token, { ...value, tab: tabId });
      if (closedTabs.has(tabId)) await forgetReader(tabId);
      return !closedTabs.has(tabId);
    });
  } catch { await sourceTask(() => discardUnclaimed(token)); return false; }
}
function loadedHistoryTab(tab: browser.tabs.Tab): Promise<{ tab: browser.tabs.Tab; version: number }> {
  if (tab.id === undefined || closedTabs.has(tab.id)) return Promise.reject(new Error('The saved paper tab was closed.'));
  if (tab.status === 'complete') return Promise.resolve({ tab, version: tabVersion(tab.id) });
  const id = tab.id;
  return new Promise((resolve, reject) => {
    const finish = (current?: browser.tabs.Tab, error?: Error) => { clearTimeout(timer); historyLoads.delete(id); if (error) reject(error); else resolve({ tab: current!, version: tabVersion(id) }); };
    const timer = setTimeout(() => finish(undefined, new Error('The paper is still loading. Click the PaperChat toolbar button in its new tab when it finishes.')), 30000);
    historyLoads.set(id, { complete: current => finish(current), fail: error => finish(undefined, error) });
    // Safari can finish loading before tabs.create returns; recheck after registering.
    const lookupVersion = tabVersion(id);
    void browser.tabs.get(id).then(current => { if (stillOpen(id, lookupVersion) && current.status === 'complete') historyLoads.get(id)?.complete(current); }).catch(() => historyLoads.get(id)?.fail(new Error('The saved paper tab was closed.')));
  });
}
async function openSavedPaper(id: string, owner: number, version: number): Promise<NativeReply> {
  try {
    const reply = await browser.runtime.sendNativeMessage('local.paperchat.PaperChat', { action: 'readHistory', id }) as NativeReply;
    if (!reply?.ok) throw new Error(reply?.error || 'The saved chat could not be read.');
    if (!stillOpen(owner, version)) throw new Error('The paper tab changed. Open History again.');
    const paper = reply.conversation?.paper;
    if (!paper || paper.id !== id) throw new Error('This saved chat is no longer available.');
    if (!paper.url) return { ok: true, note: 'Reopen the original local PDF in the reader to resume that conversation.' };
    const url = sourceURL(paper.url);
    if (!url) throw new Error('This saved source has no supported web link. Reopen the original paper.');
    if (/\.pdf(?:[?#]|$)/i.test(url)) {
      const opened = await openReader(url, () => stillOpen(owner, version));
      if (!stillOpen(owner, version)) throw new Error('The paper tab changed. Open History again.');
      if (!opened) throw new Error('The saved PDF reader could not be opened.');
    } else {
      const created = await browser.tabs.create({ url });
      if (!stillOpen(owner, version)) throw new Error('The paper tab changed. Open History again.');
      const loaded = await loadedHistoryTab(created), tab = loaded.tab, target = tab.id!, targetVersion = loaded.version;
      const current = () => {
        if (!stillOpen(owner, version)) throw new Error('The paper tab changed. Open History again.');
        if (!stillOpen(target, targetVersion)) throw new Error('The saved paper tab changed. Select it in History again.');
      };
      current(); let result: any;
      try {
        await browser.scripting.executeScript({ target: { tabId: target }, files: ['content.js'] }); current();
        const document = await browser.tabs.sendMessage(target, { type: 'paperchat.document' }); current();
        if (typeof document?.documentToken !== 'string') throw new Error('The paper sidebar is not available.');
        result = await browser.tabs.sendMessage(target, { type: 'paperchat.toggle', openOnly: true, documentToken: document.documentToken, expectedPaperId: id }); current();
      } catch {
        current();
        return { ok: true, note: 'Opened the paper in a new tab. Click the PaperChat toolbar button there to resume its chat.' };
      }
      if (result?.pageChanged) throw new Error('The saved paper tab changed. Select it in History again.');
      if (result?.needsReader) {
        const opened = await openReader(tab.url || url, () => stillOpen(owner, version) && stillOpen(target, targetVersion)); current();
        if (!opened) throw new Error('The PDF reader could not be opened.');
      }
    }
    return { ok: true };
  } catch (error) { return { ok: false, error: (error as Error).message || 'The saved paper could not be opened.' }; }
}
let port: ReturnType<typeof browser.runtime.connectNative> | null = null;
function nativePort() {
  if (port) return;
  try {
    port = browser.runtime.connectNative('local.paperchat.PaperChat');
    port.onMessage.addListener(async (message: any) => {
      const payload = message.userInfo ?? message;
      const id = payload.requestId; const event = payload.event;
      const route = routes.get(id);
      if (!route || !event) return;
      if (event.type === 'delta' && route.recovery?.messages.at(-1)?.role === 'assistant') route.recovery.messages.at(-1)!.text += event.text;
      try { await publish(route, { type: 'paperchat.event', requestId: id, event }); }
      catch { await preserve(route, event.type === 'completed' ? 'complete' : 'incomplete'); }
      if (['completed', 'error', 'cancelled'].includes(event.type)) routes.delete(id);
    });
    port.onDisconnect.addListener(() => {
      port = null;
      for (const [id, route] of routes) {
        void publish(route, { type: 'paperchat.event', requestId: id, event: { type: 'error', message: 'The companion connection closed. The partial reply is preserved.' } }).catch(() => {});
        void browser.runtime.sendNativeMessage('local.paperchat.PaperChat', { action: 'cancel', requestId: id }).catch(() => {});
      }
      routes.clear();
    });
  } catch { port = null; }
}

async function toggle(tab: browser.tabs.Tab, selection?: string) {
  if (tab.id === undefined) return;
  const url = tab.url ?? '';
  if (isReaderPage(url)) {
    await browser.runtime.sendMessage({ type: 'paperchat.reader-toggle', tabId: tab.id, selection }); return;
  }
  if (/\.pdf(?:[?#]|$)/i.test(url) || url.startsWith('file:')) {
    await openReader(url); return;
  }
  try {
    await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    const result = await browser.tabs.sendMessage(tab.id, { type: 'paperchat.toggle', selection });
    if (result?.needsReader) await openReader(url);
  } catch {
    // The native PDF viewer cannot host injected UI. A reader tab also offers local import.
    await openReader(url);
  }
}
browser.action.onClicked.addListener(tab => { void toggle(tab); });
browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({ id: 'paperchat-selection', title: 'Ask PaperChat about selection', contexts: ['selection'] });
});
browser.contextMenus.onClicked.addListener((info, tab) => { if (tab && info.menuItemId === 'paperchat-selection') void toggle(tab, info.selectionText); });
browser.tabs.onRemoved.addListener(async tab => { closedTabs.add(tab); historyLoads.get(tab)?.fail(new Error('The saved paper tab was closed.')); leaveTab(tab); await forgetReader(tab); });
browser.tabs.onUpdated.addListener((tab, change, current) => { if (change.status === 'loading') leaveTab(tab); if (change.status === 'complete') historyLoads.get(tab)?.complete(current); });
browser.runtime.onMessage.addListener(async (message: any, sender) => {
  const startedAt = lifecycleSerial;
  const receivedVersion = sender.tab?.id === undefined ? 0 : tabVersion(sender.tab.id);
  let readerError = '';
  const binding = await readerOwner(message, sender, startedAt, reason => { readerError = reason; });
  const isReader = binding !== undefined;
  const owner = binding?.tabId ?? sender.tab?.id;
  const version = binding?.version ?? receivedVersion;
  if (owner !== undefined && !stillOpen(owner, version)) return { ok: false, error: 'The paper tab changed. Open PaperChat again.' };
  if (message.type === 'paperchat.open-history') {
    if (owner === undefined || (sender.frameId !== undefined && sender.frameId !== 0)
        || ((message.readerToken || Number.isInteger(message.readerTab)) && !binding)
        || typeof message.id !== 'string' || !/^[a-f0-9]{64}$/.test(message.id)) return { ok: false, error: 'Open History from a PaperChat sidebar and select a saved paper.' };
    return openSavedPaper(message.id, owner, version);
  }
  if (message.type === 'paperchat.reader-source' && isReader && owner !== undefined) {
    return sourceTask(async () => {
      if (!stillOpen(owner, version)) return { source: '' };
      const value = await readerSource(binding.token), source = value?.source ?? '';
      if (!stillOpen(owner, version)) return { source: '' };
      if (value?.tab !== undefined && value.tab !== owner) return { source: '', error: 'This source is already attached to another reader tab.' };
      if (value) await rememberReader(binding.token, { tab: owner });
      if (!stillOpen(owner, version)) { if (closedTabs.has(owner)) await forgetReader(owner); return { source: '' }; }
      return { source, readerTab: owner };
    });
  }
  if (message.type === 'paperchat.reader-source') return { source: '', error: readerError || 'The reader tab changed.' };
  if (message.type === 'paperchat.capture') {
    if (owner === undefined) return { ok: false, error: 'This action needs a paper tab.' };
    const active = await browser.tabs.query({ active: true, currentWindow: true });
    if (active[0]?.id !== owner) return { ok: false, error: 'Keep the paper tab active while attaching a figure.' };
    return { ok: true, dataURL: await browser.tabs.captureVisibleTab({ format: 'png' }) };
  }
  if (message.type !== 'paperchat.native') return;
  if ((message.readerToken || Number.isInteger(message.readerTab)) && !binding) return { ok: false, error: 'The reader tab changed. Open PaperChat again.' };
  const payload = message.payload;
  if (!payload || typeof payload.action !== 'string') return { ok: false, error: 'Invalid PaperChat request.' };
  nativePort();
  if (payload.action === 'chat') {
    if (owner === undefined) return { ok: false, error: 'This action needs a paper tab.' };
    routes.set(payload.requestId, { tab: owner, reader: isReader, recovery: payload.recovery });
  }
  try {
    const reply = await browser.runtime.sendNativeMessage('local.paperchat.PaperChat', payload) as NativeReply;
    if (payload.action === 'chat' && reply?.ok && !routes.has(payload.requestId)) {
      void browser.runtime.sendNativeMessage('local.paperchat.PaperChat', { action: 'cancel', requestId: payload.requestId }).catch(() => {});
    }
    if (!reply?.ok && payload.action === 'chat') routes.delete(payload.requestId);
    return reply;
  } catch {
    if (payload.action === 'chat') routes.delete(payload.requestId);
    return { ok: false, error: 'Open the PaperChat companion app, then try again.' };
  }
});
