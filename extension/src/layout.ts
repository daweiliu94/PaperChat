// Fixed panels follow the visible viewport, including Safari magnification/panning.
export function dockPanel(element: HTMLElement, preferredWidth: number) {
  const viewport = window.visualViewport;
  const visibleWidth = viewport?.width ?? window.innerWidth;
  const edge = (viewport?.offsetLeft ?? 0) + visibleWidth;
  // Page CSS zoom also scales fixed descendants; DOM rectangles use viewport units.
  const cssWidth = parseFloat(getComputedStyle(element).width);
  const scale = cssWidth > 0 ? element.getBoundingClientRect().width / cssWidth || 1 : 1;
  const available = visibleWidth / scale;
  const width = Math.min(available, Math.max(320, Math.min(preferredWidth, 600, available - 300)));
  const right = (window.innerWidth - edge) / scale;
  const top = (viewport?.offsetTop ?? 0) / scale;
  const height = (viewport?.height ?? window.innerHeight) / scale;
  Object.assign(element.style, { position: 'fixed', right: right + 'px', top: top + 'px', bottom: 'auto', width: width + 'px', height: height + 'px' });
  return { width, right, top, height, scale, edge };
}
