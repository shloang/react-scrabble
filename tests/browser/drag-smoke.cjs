const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const postcss = require('postcss');
const tailwindcss = require('tailwindcss');
const loadConfig = require('tailwindcss/loadConfig');

module.exports = async ({ chromium }) => {
  const root = path.resolve(__dirname, '../..');
  const bundle = await esbuild.build({
    entryPoints: [path.join(__dirname, 'drag-fixture.tsx')], bundle: true, write: false,
    format: 'iife', platform: 'browser', jsx: 'automatic', tsconfig: path.join(root, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  const css = await postcss([tailwindcss(loadConfig(path.join(root, 'tailwind.config.ts')))])
    .process(fs.readFileSync(path.join(root, 'client/src/index.css'), 'utf8'), { from: path.join(root, 'client/src/index.css') });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => route.abort());
    await page.setContent('<html><head></head><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: css.css });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const rack = page.getByTestId('tile-rack');
    const tileA = rack.getByTestId('tile-a');
    const board = page.getByTestId('square-7-7');
    await tileA.waitFor();

    for (let i = 0; i < 5; i++) {
      await tileA.dragTo(board);
      await board.getByTestId('tile-a').waitFor();
      await board.click();
      await tileA.waitFor();
    }
    console.log('PASS: repeated rack-to-board drops and click recall');

    await tileA.dragTo(board);
    await board.getByTestId('tile-a').dragTo(rack.getByTestId('tile-empty'));
    await tileA.waitFor();
    console.log('PASS: board-to-rack drag');

    const firstTileNode = await tileA.elementHandle();
    const start = await tileA.boundingBox();
    const end = await rack.getByTestId('tile-g').boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(start.x + 10, start.y + 10, { steps: 4 });
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 });
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
    assert.equal(await firstTileNode.evaluate(node => node.isConnected), true);
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('#rack-state').textContent === '["B","C","D","E","F","G","A"]');
    console.log('PASS: smooth rack reorder retains the native drag source');

    for (const eventName of ['blur', 'dragend', 'drop', 'mouseup']) {
      await tileA.evaluate((element, name) => {
        element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
        window.dispatchEvent(new Event(name));
      }, eventName);
      await page.waitForFunction(() => !document.body.classList.contains('dragging'));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await tileA.evaluate(element => getComputedStyle(element).opacity), '1');
    }
    console.log('PASS: cancellation before the preview frame cannot leave a hidden tile');

    await tileA.evaluate(element => element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.body.classList.contains('dragging'));
    await tileA.evaluate(element => element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })));
    await page.locator('#next-turn').evaluate(element => element.click());
    await page.waitForFunction(() => !document.body.classList.contains('dragging'));
    await tileA.evaluate(element => {
      element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
      window.dispatchEvent(new PointerEvent('pointermove', { buttons: 0 }));
    });
    await page.waitForFunction(() => !document.body.classList.contains('dragging'));
    console.log('PASS: turn change and missed pointer release clear the drag state');
    await page.locator('#selection').click();
    assert.equal(await tileA.getAttribute('draggable'), 'false');
    await page.locator('#selection').click();
    await page.locator('#pause').click();
    assert.equal(await tileA.getAttribute('draggable'), 'false');
    await page.locator('#pause').click();
    await tileA.dragTo(board);
    await board.getByTestId('tile-a').waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: Escape, pause, exchange selection and resumed dragging; no React errors');
  } finally {
    await browser.close();
  }
};
