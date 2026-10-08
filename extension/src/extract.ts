import { Block, Paper, digest, sourceURL } from './core';

export async function extractPaper(doc: Document): Promise<{ paper: Paper; references: Map<string, Element> }> {
  const root = doc.querySelector('article') ?? doc.querySelector('main, [role="main"], #main-content, #content') ?? doc.body;
  const references = new Map<string, Element>(); const blocks: Block[] = [];
  let section = 'Article'; const seen = new Set<string>();
  for (const element of root.querySelectorAll('h1,h2,h3,h4,p,li,pre,table,figcaption')) {
    if (element.closest('nav,header,footer,aside,[aria-hidden="true"],script,style,noscript,[data-paperchat]')) continue;
    if (element.parentElement?.closest('table') && element.tagName !== 'TABLE') continue;
    const style = doc.defaultView?.getComputedStyle(element);
    if (style?.display === 'none' || style?.visibility === 'hidden') continue;
    const text = ((element as HTMLElement).innerText ?? element.textContent ?? '').replace(/\s+/g, ' ').trim();
    const heading = /^H[1-4]$/.test(element.tagName);
    if (text.length < (heading ? 2 : 8) || seen.has(text)) continue;
    seen.add(text);
    if (heading) section = text.slice(0, 160);
    // Small blocks keep local retrieval and citation jumps useful on long papers.
    for (let i = 0; i < text.length; i += 4500) {
      const id = 'S' + (blocks.length + 1); blocks.push({ id, text: text.slice(i, i + 4500), label: section }); references.set(id, element);
    }
  }
  if (!blocks.length) {
    const text = (root.innerText ?? root.textContent ?? '').trim();
    for (let i = 0; i < Math.min(text.length, 1_000_000); i += 4500) blocks.push({ id: 'S' + (blocks.length + 1), text: text.slice(i, i + 4500), label: 'Page text' });
  }
  const canonical = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? doc.location.href;
  const url = sourceURL(canonical);
  const title = doc.querySelector<HTMLMetaElement>('meta[name="citation_title"]')?.content ?? doc.querySelector('h1')?.textContent?.trim() ?? doc.title;
  return { paper: { id: await digest(url || doc.location.href), title, url, blocks, kind: 'html' }, references };
}
