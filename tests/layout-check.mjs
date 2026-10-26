// Run against tests/preview-server.mjs through playwright-cli run-code --filename.
// Uses synthetic replies and browser geometry; no account or model requests.
async page => {
  const checks = [];
  // WebKit automation cannot perform a native pinch. Use an EventTarget viewport
  // for deterministic magnification/panning geometry and resize/scroll delivery.
  await page.addInitScript(() => {
    if (!new URLSearchParams(location.search).has('viewport')) return;
    const viewport = new EventTarget();
    Object.assign(viewport, { width: 470, height: 460, offsetLeft: 120, offsetTop: 40, scale: 2 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  });
  const inspect = () => page.evaluate(() => {
    const root = window.paperchatTestRoots.at(-1), host = root.host, pane = root.querySelector('.pane');
    const viewport = window.visualViewport;
    const bounds = { left: viewport.offsetLeft, right: viewport.offsetLeft + viewport.width, top: viewport.offsetTop, bottom: viewport.offsetTop + viewport.height };
    const outside = r => r.left < bounds.left - 1 || r.right > bounds.right + 1 || r.top < bounds.top - 1 || r.bottom > bounds.bottom + 1;
    const errors = [];
    if (outside(host.getBoundingClientRect())) errors.push('Panel extends beyond visible viewport');
    if (parseFloat(getComputedStyle(host).height) >= 400 && outside(root.getElementById('effort').getBoundingClientRect())) errors.push('Footer needs scrolling at normal panel height');
    if (pane.scrollWidth > pane.clientWidth + 1 || root.getElementById('chat').scrollWidth > root.getElementById('chat').clientWidth + 1) errors.push('Reply or pane overflows horizontally');
    for (const id of ['close', 'question', 'select', 'attach', 'send', 'model', 'effort']) {
      const node = root.getElementById(id); node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (outside(node.getBoundingClientRect())) errors.push(id + ' is cut off');
    }
    const hostRect = host.getBoundingClientRect(), divider = document.querySelector('[data-paperchat="resize"]') || document.getElementById('divider');
    const dividerRect = divider.getBoundingClientRect();
    if (Math.abs(dividerRect.left + dividerRect.width / 2 - hostRect.left) > 2) errors.push('Divider is detached from panel');
    return { width: viewport.width, height: viewport.height, panelWidth: hostRect.width, errors };
  });
  for (const path of ['ui.html', 'reader.html']) {
    for (const scenario of [
      { width: 1400, height: 900 }, { width: 900, height: 600 }, { width: 600, height: 400 }, { width: 280, height: 600 },
      { width: 900, height: 600, zoom: 1.5 }, { width: 600, height: 400, zoom: 2 },
      { width: 900, height: 600, viewport: true }, { width: 900, height: 600, pageStyle: true }
    ]) {
      if (scenario.pageStyle && path === 'reader.html') continue; // The extension reader has its own stylesheet.
      await page.setViewportSize({ width: scenario.width, height: scenario.height });
      await page.goto('http://127.0.0.1:47831/' + path + '?stress' + (scenario.viewport ? '&viewport' : ''));
      await page.waitForFunction(() => window.paperchatTestRoots?.at(-1)?.getElementById('send').disabled === false);
      if (scenario.zoom) await page.evaluate(zoom => { document.documentElement.style.zoom = String(zoom); window.dispatchEvent(new Event('resize')); }, scenario.zoom);
      if (scenario.pageStyle) await page.addStyleTag({ content: 'div{min-width:600px;padding:30px;margin:20px}*{box-sizing:content-box}' });
      checks.push({ path, scenario, ...await inspect() });
      if (scenario.viewport) {
        await page.evaluate(() => {
          Object.assign(window.visualViewport, { width: 280, height: 360, offsetLeft: 260, offsetTop: 120 });
          window.visualViewport.dispatchEvent(new Event('resize'));
          window.visualViewport.dispatchEvent(new Event('scroll'));
        });
        checks.push({ path, scenario: 'magnification and pan', ...await inspect() });
      }
    }
    // A narrow window must not permanently discard the user's wider setting.
    await page.goto('http://127.0.0.1:47831/' + path + '?stress');
    await page.waitForFunction(() => window.paperchatTestRoots?.at(-1)?.getElementById('send').disabled === false);
    await page.setViewportSize({ width: 600, height: 600 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    checks.push({ path, scenario: 'window shrink', ...await inspect() });
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const expanded = await inspect();
    if (Math.abs(expanded.panelWidth - 400) > 1) expanded.errors.push('Preferred width was lost on resize');
    checks.push({ path, scenario: 'window expansion', ...expanded });
  }
  const failures = checks.filter(check => check.errors.length);
  if (failures.length) throw new Error(JSON.stringify(failures));
  return checks;
}
