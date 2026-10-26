// Run against tests/preview-server.mjs with playwright-cli run-code --filename.
// Synthetic runtime events only; no account requests or real histories.
async page => {
  await page.goto('http://127.0.0.1:47831/ui.html');
  await page.waitForFunction(() => window.paperchatTestRoots?.at(-1)?.getElementById('send').disabled === false);
  const result = await page.evaluate(async () => {
    const root = window.paperchatTestRoots.at(-1), runtime = window.browser.runtime;
    const original = runtime.sendMessage;
    const saves = []; let requestId;
    runtime.sendMessage = async message => {
      if (message.payload?.action === 'saveHistory') saves.push(structuredClone(message.payload));
      if (message.payload?.action === 'chat') requestId = message.payload.requestId;
      return original(message);
    };
    root.getElementById('question').value = 'Synthetic stream replay check';
    root.getElementById('send').click();
    for (let i = 0; !requestId && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 10));
    if (!requestId) throw Error('The synthetic request did not start.');
    for (const [eventId, text] of [['1', '**Very'], ['2', ' very'], ['3', ' clear.**']]) {
      const message = { type: 'paperchat.event', requestId, event: { type: 'delta', eventId, text } };
      await window.paperchatFixtureMessage(message);
      await window.paperchatFixtureMessage(structuredClone(message));
    }
    await window.paperchatFixtureMessage({ type: 'paperchat.event', requestId, event: { type: 'completed', eventId: '4' } });
    for (let i = 0; saves.length < 2 && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 10));
    const rendered = [...root.querySelectorAll('.answer')].at(-1).textContent.trim();
    const saved = saves.at(-1)?.messages.at(-1)?.text;
    if (rendered !== 'Very very clear.' || saved !== '**Very very clear.**') throw Error(JSON.stringify({ rendered, saved }));
    return { rendered, saved, status: root.getElementById('status').textContent };
  });
  return result;
}
