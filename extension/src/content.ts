import { extractPaper } from './extract';
import { native } from './client';
import { ChatPanel } from './panel';
import { cropImage, chooseRegion } from './crop';
import { dockPanel } from './layout';

const key = '__paperchatInstalled';
const scope = globalThis as any;
if (!scope[key]) {
  scope[key] = true;
  const documentToken = crypto.randomUUID();
  let panel: ChatPanel | null = null;
  let references = new Map<string, Element>();
  let lastSelection = '';
  let width = 400;
  const html = document.documentElement;
  let originalWidth = '', originalPriority = '';
  let resize: HTMLDivElement | null = null;
  let placement: ReturnType<typeof dockPanel> | null = null;
  const selected = () => window.getSelection()?.toString().trim() || lastSelection;
  document.addEventListener('selectionchange', () => { const text = window.getSelection()?.toString().trim(); if (text) lastSelection = text; });
  const read = async () => { const result = await extractPaper(document); references = result.references; return result.paper; };
  const restore = () => {
    if (originalWidth) html.style.setProperty('width', originalWidth, originalPriority); else html.style.removeProperty('width');
    resize?.remove(); resize = null; panel?.element.remove(); panel = null; placement = null;
  };
  const layout = () => {
    if (!panel) return;
    placement = dockPanel(panel.element, width);
    html.style.setProperty('width', `calc(100% - ${placement.width}px)`, 'important');
    if (resize) Object.assign(resize.style, { right: placement.right + placement.width - 3 + 'px', top: placement.top + 'px', height: placement.height + 'px' });
  };
  window.addEventListener('resize', layout);
  window.visualViewport?.addEventListener('resize', layout);
  window.visualViewport?.addEventListener('scroll', layout);
  browser.runtime.onMessage.addListener(async (message: any) => {
    if (message.type === 'paperchat.document') return { documentToken };
    if (message.type !== 'paperchat.toggle') return;
    if (message.documentToken && message.documentToken !== documentToken) return { ok: false, pageChanged: true };
    if (document.contentType === 'application/pdf' || document.querySelector('embed[type="application/pdf"]')) return { needsReader: true };
    if (message.expectedPaperId && (await read()).id !== message.expectedPaperId) return { ok: false, pageChanged: true };
    if (panel) {
      if (message.selection) panel.useSelection(message.selection); else if (!message.openOnly) await panel.close();
      return { ok: true };
    }
    originalWidth = html.style.getPropertyValue('width'); originalPriority = html.style.getPropertyPriority('width');
    panel = new ChatPanel({
      paper: read, selection: selected,
      jump: id => { const element = references.get(id); if (element) { element.scrollIntoView({ behavior: 'smooth', block: 'center' }); const before = (element as HTMLElement).style.outline; (element as HTMLElement).style.outline = '3px solid #319b76'; setTimeout(() => { (element as HTMLElement).style.outline = before; }, 2000); } },
      attach: async () => {
        const current = panel; if (!current) return null;
        current.element.style.visibility = 'hidden';
        if (resize) resize.style.visibility = 'hidden';
        try {
          const rect = await chooseRegion(); if (!rect) return null;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const reply = await browser.runtime.sendMessage({ type: 'paperchat.capture' });
          if (!reply?.ok) throw new Error(reply?.error || 'Could not capture the visible figure.');
          return await cropImage(reply.dataURL, rect, window.innerWidth, 'Selected webpage figure');
        } finally { current.element.style.visibility = ''; if (resize) resize.style.visibility = ''; }
      }, close: restore
    });
    panel.element.style.zIndex = '2147483646';
    html.append(panel.element);
    resize = document.createElement('div'); resize.dataset.paperchat = 'resize';
    Object.assign(resize.style, { all: 'initial', position: 'fixed', width: '7px', cursor: 'col-resize', zIndex: '2147483647', background: 'transparent' });
    resize.onpointerdown = event => { resize!.setPointerCapture(event.pointerId); event.preventDefault(); };
    resize.onpointermove = event => { if (resize?.hasPointerCapture(event.pointerId) && placement) { width = (placement.edge - event.clientX) / placement.scale; layout(); } };
    html.append(resize); layout();
    if (message.selection) panel.useSelection(message.selection);
    return { ok: true };
  });
}
