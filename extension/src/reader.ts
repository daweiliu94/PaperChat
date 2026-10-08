import { getDocument, GlobalWorkerOptions, TextLayer, PDFDocumentProxy } from 'pdfjs-dist';
import { Block, Paper, digest, sourceURL } from './core';
import { ChatPanel } from './panel';
import { bindReaderTab } from './client';
import { chooseRegion, cropImage } from './crop';

GlobalWorkerOptions.workerSrc = browser.runtime.getURL('pdf.worker.mjs');
const el = (id: string) => document.getElementById(id)!;
const urlInput = el('url') as HTMLInputElement, pageInput = el('page') as HTMLInputElement;
const pages = el('pages');
let pdf: PDFDocumentProxy | null = null, paper: Paper | null = null, panel: ChatPanel | null = null;
let source = '', scale = 1, width = 400, owner: number | undefined;
let generation = 0, lastSelection = '', observer: IntersectionObserver | null = null;
let loadGeneration = 0, downloading: AbortController | null = null;
let viewGeneration = 0;
type PageText = Awaited<ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['getTextContent']>>;
let textByPage = new Map<number, PageText>();
const renderTasks = new Set<{ cancel: () => void }>();
function status(message: string) { el('status').textContent = message; }
function handle(action: () => Promise<unknown>) { void action().catch(error => status(error.message)); }

async function openBytes(bytes: Uint8Array, title: string, sourceLink: string) {
  if (bytes.length > 50_000_000) throw new Error('This PDF is larger than the 50 MB reader limit. Open a smaller paper or its journal webpage.');
  const epoch = ++generation;
  ++viewGeneration;
  if (panel) await panel.close();
  observer?.disconnect(); for (const task of renderTasks) task.cancel(); renderTasks.clear();
  if (pdf) await pdf.loadingTask.destroy(); pdf = null; paper = null; lastSelection = '';
  const id = await digest(bytes);
  const loading = getDocument({ data: bytes, cMapUrl: browser.runtime.getURL('cmaps/'), cMapPacked: true,
    standardFontDataUrl: browser.runtime.getURL('standard_fonts/'), wasmUrl: browser.runtime.getURL('wasm/'), disableAutoFetch: true });
  const documentPDF = await loading.promise;
  if (epoch !== generation) { await loading.destroy(); return; }
  pdf = documentPDF;
  const metadata = await pdf.getMetadata();
  const info = metadata.info as { Title?: string };
  const blocks: Block[] = []; textByPage = new Map();
  let scanned = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    status(`Reading PDF text · page ${n} of ${pdf.numPages}…`);
    const page = await pdf.getPage(n), content = await page.getTextContent();
    if (epoch !== generation) return;
    textByPage.set(n, content);
    const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').replace(/[ \t]+/g, ' ').trim();
    if (text.length < 20) scanned++;
    for (let offset = 0, b = 1; offset < text.length; offset += 4500, b++) blocks.push({ id: `P${n}B${b}`, text: text.slice(offset, offset + 4500), page: n, label: `PDF page ${n}` });
  }
  paper = { id, title: info.Title?.trim() || title, url: sourceURL(sourceLink), blocks, currentPage: 1, kind: 'pdf' };
  document.title = paper.title + ' · PaperChat';
  el('count').textContent = '/ ' + pdf.numPages; pageInput.max = String(pdf.numPages); pageInput.value = '1';
  showChat();
  await renderPages();
  status(scanned ? `PDF ready · ${scanned} page(s) have little selectable text. Attach a page region for visual questions.` : `PDF ready · ${pdf.numPages} pages`);
}

async function renderPages() {
  if (!pdf) return;
  const documentPDF = pdf, epoch = ++viewGeneration;
  observer?.disconnect(); for (const task of renderTasks) task.cancel(); renderTasks.clear();
  pages.replaceChildren();
  const wrappers = new Map<number, HTMLElement>();
  for (let n = 1; n <= documentPDF.numPages; n++) {
    const shell = document.createElement('section'); shell.dataset.page = String(n);
    const label = document.createElement('div'); label.className = 'page-label'; label.textContent = 'Page ' + n;
    const wrap = document.createElement('div'); wrap.className = 'page-wrap'; wrap.id = 'pdf-page-' + n;
    const page = await documentPDF.getPage(n); if (epoch !== viewGeneration) return; const viewport = page.getViewport({ scale });
    wrap.style.width = viewport.width + 'px'; wrap.style.height = viewport.height + 'px';
    shell.append(label, wrap); pages.append(shell); wrappers.set(n, wrap);
  }
  const rendered = new Set<number>();
  async function render(n: number) {
    if (rendered.has(n) || epoch !== viewGeneration || !pdf) return;
    rendered.add(n);
    const page = await documentPDF.getPage(n), viewport = page.getViewport({ scale });
    const wrap = wrappers.get(n)!; const canvas = document.createElement('canvas'); const pixelRatio = Math.min(window.devicePixelRatio, 2);
    canvas.width = Math.ceil(viewport.width * pixelRatio); canvas.height = Math.ceil(viewport.height * pixelRatio);
    canvas.style.width = viewport.width + 'px'; canvas.style.height = viewport.height + 'px'; wrap.append(canvas);
    // Static page canvases must render even when Safari pauses animation frames in an extension tab.
    const task = page.render({ canvas, viewport, intent: 'print', transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] });
    renderTasks.add(task);
    try { await task.promise; } catch (error) { if ((error as Error).name !== 'RenderingCancelledException') throw error; } finally { renderTasks.delete(task); }
    if (epoch !== viewGeneration) return;
    const layer = document.createElement('div'); layer.className = 'textLayer'; wrap.append(layer);
    const text = new TextLayer({ textContentSource: textByPage.get(n)!, container: layer, viewport });
    await text.render();
  }
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const n = Number((entry.target as HTMLElement).dataset.page);
        handle(() => render(n));
      }
    }
  }, { root: pages, rootMargin: '600px 0px' });
  for (const shell of pages.children) observer.observe(shell);
  pages.onscroll = () => {
    if (!paper) return;
    const bounds = pages.getBoundingClientRect(); let nearest = 1, distance = Infinity;
    for (const shell of pages.children) { const value = Math.abs(shell.getBoundingClientRect().top - bounds.top); if (value < distance) { nearest = Number((shell as HTMLElement).dataset.page); distance = value; } }
    paper.currentPage = nearest; pageInput.value = String(nearest); panel?.updateSource();
  };
  await render(paper?.currentPage ?? 1);
}

function showChat() {
  if (!paper || panel) return;
  const selectedPaper = paper;
  panel = new ChatPanel({ paper: async () => selectedPaper, selection: () => window.getSelection()?.toString().trim() || lastSelection,
    jump: id => { const block = selectedPaper.blocks.find(b => b.id === id); if (block?.page) jump(block.page); },
    attach: async () => {
      const rect = await chooseRegion(); if (!rect || !pdf) return null;
      const wrappers = [...pages.querySelectorAll<HTMLElement>('.page-wrap')];
      const centerX = rect.x + rect.width / 2, centerY = rect.y + rect.height / 2;
      const wrap = wrappers.find(w => { const r = w.getBoundingClientRect(); return centerX >= r.left && centerX <= r.right && centerY >= r.top && centerY <= r.bottom; });
      const canvas = wrap?.querySelector('canvas'); if (!wrap || !canvas) throw new Error('Select a region inside one visible PDF page.');
      const bounds = wrap.getBoundingClientRect();
      const crop = { x: Math.max(rect.x, bounds.left) - bounds.left, y: Math.max(rect.y, bounds.top) - bounds.top,
        width: Math.min(rect.x + rect.width, bounds.right) - Math.max(rect.x, bounds.left), height: Math.min(rect.y + rect.height, bounds.bottom) - Math.max(rect.y, bounds.top) };
      return cropImage(canvas.toDataURL('image/png'), crop, bounds.width, 'Figure from PDF page ' + wrap.id.replace('pdf-page-', ''));
    }, close: () => { panel?.element.remove(); panel = null; el('app').style.gridTemplateColumns = 'minmax(0,1fr) 0'; el('divider').style.display = 'none'; el('show-chat').style.display = 'inline-block'; }
  });
  el('chat-host').append(panel.element); panel.element.style.height = '100%';
  el('app').style.gridTemplateColumns = `minmax(0,1fr) ${width}px`; el('divider').style.display = ''; el('show-chat').style.display = 'none';
}
function jump(n: number) { if (!pdf) return; n = Math.max(1, Math.min(n, pdf.numPages)); el('pdf-page-' + n)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); pageInput.value = String(n); if (paper) paper.currentPage = n; panel?.updateSource(); }
async function loadURL(requestPermission: boolean, initialSource?: string) {
  const load = ++loadGeneration; downloading?.abort(); downloading = new AbortController(); const signal = downloading.signal;
  const value = initialSource || urlInput.value.trim() || source;
  const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Select a local file with Open local PDF.');
  if (requestPermission && !(await browser.permissions.request({ origins: [url.protocol + '//' + url.hostname + '/*'] }))) throw new Error('Access to this PDF source was declined. You can open a local copy instead.');
  if (load !== loadGeneration) return;
  status('Loading PDF from its source…');
  const response = await fetch(url.href, { credentials: 'include', cache: 'no-store', signal });
  if (!response.ok) throw new Error(`The source returned HTTP ${response.status}. Open an accessible URL or select the original local PDF.`);
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > 50_000_000) throw new Error('This PDF exceeds the 50 MB reader limit.');
  const stream = response.body?.getReader(); if (!stream) throw new Error('The PDF could not be read.');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const { done, value } = await stream.read(); if (done) break; size += value.length; if (size > 50_000_000) { await stream.cancel(); throw new Error('This PDF exceeds the 50 MB reader limit.'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (load !== loadGeneration) return;
  source = url.href;
  await openBytes(bytes, decodeURIComponent(url.pathname.split('/').pop() || 'Paper'), source);
}
el('load').onclick = () => handle(() => loadURL(true));
el('open').onclick = () => (el('file') as HTMLInputElement).click();
(el('file') as HTMLInputElement).onchange = () => handle(async () => {
  const input = el('file') as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
  const load = ++loadGeneration; downloading?.abort();
  if (file.size > 50_000_000) throw new Error('This PDF exceeds the 50 MB reader limit.');
  source = ''; urlInput.value = '';
  const bytes = new Uint8Array(await file.arrayBuffer()); if (load !== loadGeneration) return;
  await openBytes(bytes, file.name, ''); input.value = '';
});
el('previous').onclick = () => jump(Number(pageInput.value) - 1); el('next').onclick = () => jump(Number(pageInput.value) + 1); pageInput.onchange = () => jump(Number(pageInput.value));
el('show-chat').onclick = showChat;
el('find').onclick = () => { const term = (el('search') as HTMLInputElement).value.trim().toLowerCase(); const found = term && paper?.blocks.find(b => b.text.toLowerCase().includes(term)); if (found && found.page) jump(found.page); else status('No match was found in the selectable text.'); };
async function zoom(delta: number) {
  if (!pdf) return;
  const page = paper?.currentPage ?? 1; scale = Math.max(0.5, Math.min(2.5, scale + delta));
  await renderPages(); jump(page);
}
el('zoom-out').onclick = () => handle(() => zoom(-0.15)); el('zoom-in').onclick = () => handle(() => zoom(0.15));
const divider = el('divider'); divider.onpointerdown = event => { divider.setPointerCapture(event.pointerId); event.preventDefault(); };
divider.onpointermove = event => { if (!divider.hasPointerCapture(event.pointerId)) return; width = Math.max(320, Math.min(600, window.innerWidth - event.clientX)); el('app').style.gridTemplateColumns = `minmax(0,1fr) ${width}px`; divider.style.right = width - 3 + 'px'; };
document.addEventListener('selectionchange', () => { const value = window.getSelection()?.toString().trim(); if (value) lastSelection = value; });
browser.runtime.onMessage.addListener((message: any) => { if (message.type === 'paperchat.reader-toggle' && message.tabId === owner) { if (message.selection) { showChat(); panel?.useSelection(message.selection); } else if (panel) void panel.close(); else showChat(); } });
handle(async () => {
  status('Connecting PDF reader…');
  const token = location.hash.slice(1);
  const reply = await browser.runtime.sendMessage({ type: 'paperchat.reader-source', readerToken: token });
  owner = reply?.readerTab ?? owner; bindReaderTab(owner, token); source = reply?.source ?? '';
  if (!source && token) status((reply?.error ? reply.error + ' ' : '') + 'The PDF source was not attached. Return to the original PDF tab and click PaperChat again, or paste its URL here.');
  if (source.startsWith('http')) {
    urlInput.value = sourceURL(source);
    try { await loadURL(false, source); } catch { urlInput.value = source; status('Click Load URL to allow access to this PDF source, or select the original local PDF.'); }
  } else if (source.startsWith('file:')) status('Choose the original file with Open local PDF. Safari does not give extensions automatic access to local files.');
});
