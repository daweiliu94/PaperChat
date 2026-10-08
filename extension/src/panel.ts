import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Attachment, Message, ModelChoice, Paper, historyPayload, newMessage, reasoningLevels, requestBody, selectContext } from './core';
import { native, openHistory } from './client';
import { renderSourceReferences } from './citations';

export interface ReadingHost {
  paper: () => Promise<Paper>;
  selection: () => string;
  jump: (id: string) => void;
  attach: () => Promise<Attachment | null>;
  close: () => void;
}
const css = `
:host{all:initial;display:block;height:100%;color:#173331;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;line-height:1.5;color-scheme:light dark}
*{box-sizing:border-box}button,select,textarea{font:inherit}button{cursor:pointer;border:1px solid #c9d6d3;border-radius:8px;background:#fff;color:#183f3a;padding:6px 10px}button:hover{background:#edf4f1}button:disabled{opacity:.5;cursor:default}a{color:#08756c}select{max-width:100%;background:#fff;color:#173331;border:1px solid #c9d6d3;border-radius:6px;padding:5px}
.pane{height:100%;display:flex;flex-direction:column;background:#f7faf8;border-left:1px solid #d5dfdb;box-shadow:-4px 0 16px #15382a0a}.head{display:flex;align-items:center;gap:8px;padding:15px 16px;border-bottom:1px solid #d5dfdb}.brand{font-weight:750;font-size:17px;flex:1}.head button{border:0;background:transparent;font-size:15px}.source{padding:12px 16px;background:#edf4f1;border-bottom:1px solid #d5dfdb}.title{font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.detail{font-size:12px;color:#49635b;margin-top:4px}.tools{display:flex;flex-wrap:wrap;gap:5px;padding:10px 14px}.tools button{font-size:12px;padding:4px 10px;border-color:transparent;border-radius:16px;background:transparent}.chat{flex:1;min-height:100px;overflow:auto;overscroll-behavior:contain;padding:10px 16px}.welcome{padding:20px 5px;color:#61776e}.message{margin:0 0 17px}.role{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#5b7268;margin-bottom:5px}.user{background:#e5efea;border-radius:10px;padding:10px 12px;white-space:pre-wrap;overflow-wrap:anywhere}.answer{overflow-wrap:anywhere}.answer p{margin:7px 0}.answer pre{padding:10px;background:#e7eeea;border-radius:7px;overflow:auto}.answer code{font-size:12px}.answer table{border-collapse:collapse;font-size:12px}.answer td,.answer th{padding:5px;border:1px solid #cad8d0}.refs{white-space:nowrap;vertical-align:super;font-size:11px;line-height:0;margin-left:2px;color:#08756c}.ref{min-width:14px;padding:2px 3px;line-height:1.25;font-size:11px;border:0;background:transparent;color:#08756c}.ref:hover{background:#e6f1ea}.sources{margin-top:12px;font-size:12px;color:#49635b}.sources summary{cursor:pointer;font-weight:600}.sources ul{list-style:none;margin:6px 0 0;padding:0}.sources li{display:flex;align-items:baseline;gap:8px;padding:5px 0}.source-label{flex:1;min-width:0}.source-links{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px;max-width:40%}.source-ref{font-size:11px;padding:2px 6px;border:0;background:#edf4f1}.state{font-size:11px;color:#805934}.status{padding:0 16px 8px;min-height:25px;font-size:12px;color:#62786f;overflow-wrap:anywhere}.status.error{color:#aa3832}.composer{padding:12px 14px 14px;border-top:1px solid #d5dfdb}.selection{font-size:12px;background:#e6efe9;border-left:3px solid #4d8a74;padding:8px;margin-bottom:8px;max-height:100px;overflow:auto}.preview{display:flex;gap:8px;align-items:center;font-size:12px;margin-bottom:8px}.preview img{max-height:80px;max-width:110px;border:1px solid #c6d8ce}.preview button{margin-left:auto}.question{display:block;resize:vertical;width:100%;min-height:64px;max-height:180px;border:1px solid #c4d5cc;border-radius:9px;padding:10px;background:#fff;color:#173331}.actions{display:flex;align-items:center;gap:6px;margin-top:8px}.actions button{font-size:12px}.send{margin-left:auto;background:#12675d;color:#fff;border:0;padding:8px 14px}.send:hover{background:#17574f}.account{display:flex;flex-direction:column;gap:8px;padding:10px 14px;border-top:1px solid #d5dfdb;font-size:12px}.model-controls{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.8fr);gap:8px;width:100%}.model-controls label{display:flex;flex-direction:column;gap:4px}.model-controls select{width:100%;min-width:0}.saved{padding:12px;background:#eef4f0;border-bottom:1px solid #d5dfdb;max-height:230px;overflow:auto}.saved button{display:block;width:100%;text-align:left;font-size:12px;margin:5px 0}.hidden{display:none!important}
.options{position:relative}.options>summary{list-style:none;cursor:pointer;padding:3px 8px;font-size:22px;line-height:1.2;border-radius:6px}.options>summary::-webkit-details-marker{display:none}.options>summary:hover{background:#edf4f1}.option-list{position:absolute;right:0;top:calc(100% + 6px);z-index:2;width:174px;padding:6px;background:#fff;border:1px solid #d5dfdb;border-radius:10px;box-shadow:0 6px 20px #15382a1a}.head .option-list button,.option-list a{display:block;width:100%;text-align:left;padding:8px 10px;border:0;border-radius:6px;font-size:13px;text-decoration:none}.head .option-list button:hover,.option-list a:hover{background:#edf4f1}button:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid #08756c;outline-offset:2px}
@media(prefers-color-scheme:dark){:host{color:#e0eae3}.pane{background:#17251f;border-color:#34483c}.source,.saved{background:#21352b;border-color:#34483c}.head,.composer,.account{border-color:#34483c}.detail,.status,.role,.welcome{color:#a2b6a9}button,select,.question{color:#e0eae3;background:#253b30;border-color:#456051}button:hover{background:#33503f}.user,.selection,.answer pre{background:#2a4436}.refs,.ref{color:#9cd5bf}.ref{background:transparent}.ref:hover,.source-ref{background:#264b3a}.sources{color:#a2b6a9}.option-list{background:#21352b;border-color:#456051}.options>summary:hover,.head .option-list button:hover,.option-list a:hover{background:#33503f}a{color:#91d0b7}.status.error{color:#ffaaa2}}
`;

export class ChatPanel {
  readonly element = document.createElement('div');
  private readonly root: ShadowRoot;
  private paper!: Paper;
  private messages: Message[] = [];
  private revision = '';
  private selected = '';
  private attachment: Attachment | null = null;
  private pending: string | null = null;
  private closed = false;
  private closing = false;
  private ready = false;
  private models: ModelChoice[] = [];
  private saveChain: Promise<unknown> = Promise.resolve();
  private requestTimer: ReturnType<typeof setTimeout> | null = null;
  private frame = 0;
  private listener = (message: any) => { if (message.type === 'paperchat.event' && message.requestId === this.pending) void this.event(message.event); };

  constructor(private host: ReadingHost) {
    this.element.dataset.paperchat = 'pane';
    this.root = this.element.attachShadow({ mode: 'closed' });
    this.root.innerHTML = `<style>${css}</style><section class="pane" aria-label="PaperChat reading assistant">
      <header class="head"><span class="brand">◧ PaperChat</span><details id="options" class="options"><summary aria-label="Chat options" title="Chat options">⋯</summary><div class="option-list"><button id="saved">History</button><button id="export">Export chat</button><button id="delete">Delete chat</button><button id="setup">Setup</button><a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">Manage usage</a></div></details><button id="close" aria-label="Close PaperChat">✕</button></header>
      <div class="source"><div id="title" class="title">Reading your paper…</div><div id="detail" class="detail"></div></div>
      <div class="tools"><button id="summary" aria-label="Summarize paper">Summary</button><button id="methods" aria-label="Explain methods">Methods</button><button id="limits" aria-label="Assess limitations">Limitations</button></div>
      <div id="saved-list" class="saved hidden"></div><div id="chat" class="chat" role="log" aria-label="Conversation"></div><div id="status" class="status" aria-live="polite"></div>
      <div class="composer"><div id="selection" class="selection hidden"></div><div id="preview" class="preview hidden"></div><textarea id="question" class="question" aria-label="Question about the paper" placeholder="Ask about the paper…"></textarea>
      <div class="actions"><button id="select">Use selection</button><button id="attach">Attach figure</button><button id="stop" class="hidden">Stop</button><button id="send" class="send" disabled>Send</button></div></div>
      <footer class="account"><div class="model-controls"><label>Model<select id="model" aria-label="ChatGPT model" disabled><option value="">Connect ChatGPT</option></select></label><label>Reasoning<select id="effort" aria-label="Reasoning level" title="Higher levels can take longer and use more of your ChatGPT allowance." disabled><option value="">Model default</option></select></label></div></footer>
    </section>`;
    this.on('close', () => { void this.close(); });
    this.on('setup', async () => { await native({ action: 'openApp' }); this.setStatus('Finish setup in PaperChat, then reopen the sidebar.'); });
    this.on('send', () => this.send());
    this.on('stop', () => this.cancel());
    this.on('select', () => this.useSelection(this.host.selection()));
    this.on('attach', async () => { this.attachment = await this.host.attach(); this.renderAttachment(); });
    this.on('summary', () => { this.question.value = 'Summarize the main question, methods, findings, and limitations of this paper.'; this.question.focus(); });
    this.on('methods', () => { this.question.value = 'Explain the methods used in this paper and why the authors chose them.'; this.question.focus(); });
    this.on('limits', () => { this.question.value = 'Assess the limitations of this study. Separate limitations the authors discuss from your own critique.'; this.question.focus(); });
    this.on('export', async () => { await this.save(); await native({ action: 'export', id: this.paper.id }); });
    this.on('delete', async () => {
      if (this.pending) throw new Error('Stop the response before deleting this chat.');
      if (!confirm('Delete the saved conversation for this paper? This cannot be undone.')) return;
      await this.saveChain;
      await native({ action: 'deleteHistory', id: this.paper.id }); this.messages = []; this.revision = ''; this.renderMessages(); this.setStatus('Conversation deleted.');
    });
    this.on('saved', () => this.showHistory());
    this.model.addEventListener('change', () => { this.updateReasoning(this.effort.value); this.rememberPreferences(); });
    this.effort.addEventListener('change', () => this.rememberPreferences());
    this.root.addEventListener('click', event => { if (!(event.target as Element).closest('.options')) this.dismissOptions(); });
    this.root.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Escape' && (this.el('options') as HTMLDetailsElement).open) { this.dismissOptions(); (this.el('options').querySelector('summary') as HTMLElement).focus(); } });
    this.question.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void this.send().catch(error => this.setStatus(error.message, true)); } });
    browser.runtime.onMessage.addListener(this.listener);
    void this.initialize().catch(error => this.setStatus(error.message, true));
  }
  private get question() { return this.root.getElementById('question') as HTMLTextAreaElement; }
  private get model() { return this.root.getElementById('model') as HTMLSelectElement; }
  private get effort() { return this.root.getElementById('effort') as HTMLSelectElement; }
  private el(id: string) { return this.root.getElementById(id)!; }
  private dismissOptions() { (this.el('options') as HTMLDetailsElement).open = false; }
  private on(id: string, action: () => unknown) { this.el(id).addEventListener('click', () => { this.dismissOptions(); void Promise.resolve().then(action).catch(error => this.setStatus(error.message, true)); }); }
  private setStatus(text: string, error = false) { this.el('status').textContent = text; this.el('status').classList.toggle('error', error); }
  private async initialize() {
    this.paper = await this.host.paper(); this.updateSource(); this.renderMessages();
    const status = await native({ action: 'status' });
    if (!status.connected || !status.historyReady) { this.setStatus('Open Chat options → Setup to connect ChatGPT and choose your history folder.'); return; }
    const history = await native({ action: 'readHistory', id: this.paper.id });
    if (this.closed) return;
    this.messages = history.conversation?.messages ?? []; this.revision = history.conversation?.revision ?? ''; this.renderMessages();
    const models = await native({ action: 'models' });
    if (this.closed) return;
    this.model.replaceChildren();
    this.models = models.models;
    for (const item of this.models) this.model.add(new Option(item.name, item.slug));
    if (!this.model.value) throw new Error('Your ChatGPT account did not return any available models.');
    let preferences: { model?: string; effort?: string } = {};
    try { preferences = (await browser.storage.local.get('paperchat.preferences'))['paperchat.preferences'] ?? {}; } catch { /* Preferences are optional; paper context and history are unaffected. */ }
    if (this.closed) return;
    if (this.models.some(item => item.slug === preferences.model)) this.model.value = preferences.model!;
    this.updateReasoning(preferences.effort ?? '');
    this.ready = true; this.controls();
    this.setStatus(this.paper.blocks.length ? 'Paper ready' : 'No readable text was found. Attach a page image or open an accessible paper.');
  }
  private updateReasoning(previous: string) {
    const names: Record<string, string> = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Maximum' };
    const model = this.models.find(item => item.slug === this.model.value);
    const available = [...new Set((model?.reasoningLevels ?? []).filter(level => reasoningLevels.includes(level)))];
    this.effort.replaceChildren(new Option(model?.defaultReasoning && names[model.defaultReasoning] ? `Default (${names[model.defaultReasoning]})` : 'Model default', ''));
    for (const value of available) this.effort.add(new Option(names[value], value));
    this.effort.value = available.includes(previous) ? previous : '';
    this.controls();
  }
  private rememberPreferences() {
    void browser.storage.local.set({ 'paperchat.preferences': { model: this.model.value, effort: this.effort.value } })
      .catch(() => this.setStatus('This selection applies to the next question, but could not be remembered for other tabs.', true));
  }
  updateSource() {
    if (!this.paper) return;
    this.el('title').textContent = this.paper.title;
    const partial = selectContext(this.paper, '').partial;
    this.el('detail').textContent = `${this.paper.kind === 'pdf' ? 'PDF · page ' + (this.paper.currentPage ?? 1) : 'Web article'}${partial ? ' · relevant passages' : ''}`;
  }
  useSelection(text: string) {
    this.selected = text.trim().slice(0, 12000); this.el('selection').textContent = this.selected ? 'Selected passage: ' + this.selected.slice(0, 450) : '';
    this.el('selection').classList.toggle('hidden', !this.selected);
    if (!this.selected) this.setStatus('Highlight a passage in the paper, then click Use selection.');
    this.question.focus();
  }
  private renderAttachment() {
    const preview = this.el('preview'); preview.replaceChildren(); preview.classList.toggle('hidden', !this.attachment);
    if (!this.attachment) return;
    const img = document.createElement('img'); img.src = this.attachment.dataURL; img.alt = this.attachment.label;
    const label = document.createElement('span'); label.textContent = this.attachment.label;
    const remove = document.createElement('button'); remove.textContent = 'Remove'; remove.onclick = () => { this.attachment = null; this.renderAttachment(); };
    preview.append(img, label, remove);
  }
  private controls() {
    (this.el('send') as HTMLButtonElement).disabled = !this.ready || !!this.pending || this.closing;
    this.el('stop').classList.toggle('hidden', !this.pending);
    for (const id of ['delete', 'export', 'attach', 'select']) (this.el(id) as HTMLButtonElement).disabled = !!this.pending;
    this.model.disabled = !this.ready || !!this.pending || this.closing;
    this.effort.disabled = this.model.disabled || this.effort.options.length <= 1;
  }
  private renderMessages() {
    const chat = this.el('chat'); const nearBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 120;
    const expandedSources = new Set([...chat.querySelectorAll<HTMLDetailsElement>('details.sources[open]')].map(details => details.dataset.message));
    chat.replaceChildren();
    if (!this.messages.length) {
      const welcome = document.createElement('div'); welcome.className = 'welcome'; welcome.textContent = 'Ask about the main finding, a method, or a claim. PaperChat reads the paper automatically. Attach a figure when you want help interpreting an image.'; chat.append(welcome);
    }
    for (const [index, message] of this.messages.entries()) {
      const wrapper = document.createElement('article'); wrapper.className = 'message';
      const role = document.createElement('div'); role.className = 'role'; role.textContent = message.role === 'user' ? 'You' : 'PaperChat';
      const body = document.createElement('div'); body.className = message.role === 'user' ? 'user' : 'answer';
      if (message.role === 'user') body.textContent = message.text;
      else {
        body.innerHTML = DOMPurify.sanitize(marked.parse(message.text || (this.pending ? 'Thinking…' : '')) as string, {
          ALLOWED_TAGS: ['p','br','strong','em','code','pre','blockquote','ul','ol','li','h1','h2','h3','h4','a','table','thead','tbody','tr','th','td','hr'], ALLOWED_ATTR: ['href','title']
        });
        for (const link of body.querySelectorAll('a')) {
          if (!/^https?:/i.test(link.href)) link.removeAttribute('href'); else { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
        }
        const sources = renderSourceReferences(body, this.paper, this.host.jump);
        if (sources) { sources.dataset.message = String(index); sources.open = expandedSources.has(String(index)); body.append(sources); }
      }
      wrapper.append(role, body);
      if (message.role === 'assistant' && message.state !== 'complete' && !this.pending) { const tag = document.createElement('div'); tag.className = 'state'; tag.textContent = message.state === 'cancelled' ? 'Stopped' : 'Incomplete reply'; wrapper.append(tag); }
      chat.append(wrapper);
    }
    if (nearBottom) chat.scrollTop = chat.scrollHeight;
  }
  private save() {
    const paper = this.paper; const snapshot = this.messages.map(m => ({ ...m }));
    const task = this.saveChain.then(async () => {
      const result = await native({ ...historyPayload(paper, snapshot), expectedRevision: this.revision });
      this.revision = result.revision;
    });
    this.saveChain = task.catch(() => {}); return task;
  }
  private async send() {
    if (!this.ready || this.pending || this.closed || this.closing) return;
    const question = this.question.value.trim(); if (!question) return;
    const current = await this.host.paper();
    if (this.pending || this.closed || this.closing) return;
    if (current.id !== this.paper.id) { this.setStatus('The page changed. Reopen PaperChat to load that paper and its chat.', true); return; }
    this.paper = current; this.updateSource();
    if (!this.paper.blocks.length && !this.attachment) throw new Error('No paper text is available. Attach a figure or load an accessible paper.');
    const request = requestBody(this.paper, this.messages, question, this.selected, this.attachment, this.model.value, this.effort.value);
    const id = crypto.randomUUID(); this.pending = id;
    this.messages.push(newMessage('user', question), newMessage('assistant', '', 'incomplete'));
    this.question.value = ''; this.renderMessages(); this.controls();
    this.setStatus(request.partial ? 'Reading relevant passages from this long paper…' : 'Reading the paper…');
    try {
      await this.save();
      if (this.pending !== id || this.closed) return;
      await native({ action: 'chat', requestId: id, body: request.body,
        recovery: { ...historyPayload(this.paper, this.messages.map(m => ({ ...m }))), expectedRevision: this.revision } });
      this.selected = ''; this.el('selection').classList.add('hidden'); this.attachment = null; this.renderAttachment();
      if (this.pending !== id || this.closed) { await native({ action: 'cancel', requestId: id }); return; }
      this.setStatus('Generating an answer…');
      this.requestTimer = setTimeout(() => { if (this.pending === id) { void this.cancel(); this.setStatus('The response timed out. The partial reply is preserved.', true); } }, 600000);
    } catch (error) { if (this.pending === id && !this.closed) await this.event({ type: 'error', message: (error as Error).message }); }
  }
  private async event(event: any) {
    if (this.closed || !this.pending) return;
    const message = this.messages[this.messages.length - 1];
    if (!message || message.role !== 'assistant') return;
    if (event.type === 'delta') {
      message.text += event.text;
      if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.renderMessages(); });
      return;
    }
    if (!['completed', 'error', 'cancelled'].includes(event.type)) return;
    if (this.requestTimer) clearTimeout(this.requestTimer);
    this.pending = null; message.state = event.type === 'completed' ? 'complete' : event.type === 'cancelled' ? 'cancelled' : 'incomplete';
    this.renderMessages(); this.controls();
    this.setStatus(event.type === 'error' ? event.message : event.type === 'cancelled' ? 'Response stopped.' : 'Saved locally', event.type === 'error');
    try { await this.save(); } catch (error) { this.setStatus('The conversation is still in this tab but could not be saved: ' + (error as Error).message, true); }
  }
  private async cancel() {
    const id = this.pending; if (!id) return;
    try { await native({ action: 'cancel', requestId: id }); } finally { if (this.pending === id) await this.event({ type: 'cancelled' }); }
  }
  private async showHistory() {
    const list = this.el('saved-list'); if (!list.classList.contains('hidden')) { list.classList.add('hidden'); return; }
    const result = await native({ action: 'listHistory' }); list.replaceChildren(); list.classList.remove('hidden');
    if (!result.papers.length) list.textContent = 'No saved conversations yet.';
    for (const paper of result.papers) {
      const button = document.createElement('button'); button.textContent = paper.title || paper.url || 'Local PDF';
      button.onclick = async () => {
        if (!paper.url) { this.setStatus('Reopen the original local PDF in the reader to resume that conversation.'); return; }
        button.disabled = true; this.setStatus('Opening saved paper…');
        try { const reply = await openHistory(paper.id); this.setStatus(reply.note || 'Saved paper opened.'); }
        catch (error) { this.setStatus((error as Error).message, true); }
        finally { button.disabled = false; }
      }; list.append(button);
    }
  }
  async close() {
    if (this.closed || this.closing) return;
    this.closing = true; this.controls();
    if (this.pending) { try { await this.cancel(); } catch { /* Partial messages remain in memory. */ } }
    this.closed = true; if (this.frame) cancelAnimationFrame(this.frame); if (this.requestTimer) clearTimeout(this.requestTimer);
    browser.runtime.onMessage.removeListener(this.listener); this.attachment = null; this.selected = ''; this.host.close();
  }
}
