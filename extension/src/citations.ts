import { Block, Paper } from './core';

// Run on sanitized answer HTML. Source labels are added through textContent only.
export function renderSourceReferences(body: HTMLElement, paper: Paper, jump: (id: string) => void): HTMLDetailsElement | null {
  const doc = body.ownerDocument;
  const blocks = new Map(paper.blocks.map(block => [block.id, block]));
  const sources = new Map<string, { number: number; block: Block; label: string }>();
  const walker = doc.createTreeWalker(body, doc.defaultView!.NodeFilter.SHOW_TEXT), nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const id = '(?:S\\d+|P\\d+B\\d+)';
  const reference = `\\[${id}(?:\\s*,\\s*${id})*\\]`;
  const cluster = new RegExp(`${reference}(?:[\\s,]*${reference})*`, 'g');
  const button = (source: { number: number; block: Block; label: string }, className: string) => {
    const link = doc.createElement('button'); link.className = className;
    link.textContent = String(source.number); link.dataset.sourceId = source.block.id;
    link.title = `Source ${source.number}: ${source.label}`; link.setAttribute('aria-label', link.title);
    link.onclick = () => jump(source.block.id); return link;
  };
  for (const node of nodes) {
    if (node.parentElement?.closest('code,pre,a')) continue;
    const matches = [...node.data.matchAll(cluster)]; if (!matches.length) continue;
    const fragment = doc.createDocumentFragment(); let offset = 0;
    for (const match of matches) {
      fragment.append(doc.createTextNode(node.data.slice(offset, match.index)));
      const group = doc.createElement('sup'); group.className = 'refs';
      group.append(doc.createTextNode('['));
      const seen = new Set<string>();
      for (const referenceID of match[0].match(/S\d+|P\d+B\d+/g)!) {
        const block = blocks.get(referenceID);
        const key = paper.kind === 'pdf' && block?.page !== undefined ? `page:${block.page}` : referenceID;
        if (seen.has(key)) continue;
        if (seen.size) group.append(doc.createTextNode(','));
        seen.add(key);
        if (!block) { group.append(doc.createTextNode(referenceID)); continue; }
        let source = sources.get(key);
        if (!source) {
          source = { number: sources.size + 1, block, label: paper.kind === 'pdf' && block.page !== undefined ? `Page ${block.page}` : block.label };
          sources.set(key, source);
        }
        group.append(button(source, 'ref'));
      }
      group.append(doc.createTextNode(']')); fragment.append(group);
      offset = match.index! + match[0].length;
    }
    fragment.append(doc.createTextNode(node.data.slice(offset))); node.replaceWith(fragment);
  }
  if (!sources.size) return null;
  const details = doc.createElement('details'); details.className = 'sources';
  const summary = doc.createElement('summary'); summary.textContent = `Sources (${sources.size})`;
  const list = doc.createElement('ul');
  const sections = new Map<string, HTMLElement>();
  for (const source of sources.values()) {
    let links = sections.get(source.label);
    if (!links) {
      const item = doc.createElement('li'), label = doc.createElement('span'); label.className = 'source-label'; label.textContent = source.label;
      links = doc.createElement('span'); links.className = 'source-links';
      item.append(label, links); list.append(item); sections.set(source.label, links);
    }
    links.append(button(source, 'source-ref'));
  }
  details.append(summary, list); return details;
}
