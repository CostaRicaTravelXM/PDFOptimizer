/**
 * Exercise the before/after comparison view.
 *
 *   node scripts/compare-ui.mjs <baseUrl> <file.pdf>
 *
 * Checks the things that make it usable for judging quality: it fills the screen, it pages
 * through the document, it zooms to real pixels, and both sides scroll together.
 */

import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const [, , base = 'http://localhost:3210', file] = process.argv;
if (!file) {
  console.error('usage: node scripts/compare-ui.mjs <baseUrl> <file.pdf>');
  process.exit(1);
}
mkdirSync('.check', { recursive: true });

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push(pass);
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=4096'],
  defaultViewport: { width: 1440, height: 900 },
  protocolTimeout: 900_000,
});

const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(base, { waitUntil: 'networkidle0' });
  const input = await page.waitForSelector('input[type=file]');
  await input.uploadFile(resolve(file));
  await page.waitForFunction(
    () => document.querySelector('li a[download]') !== null,
    { timeout: 480_000, polling: 500 },
  );

  await (await page.$('li button ::-p-text(Compare)')).click();
  await page.waitForFunction(
    () => document.querySelectorAll('[role=dialog] img').length >= 2,
    { timeout: 240_000, polling: 400 },
  );
  await new Promise((r) => setTimeout(r, 700));

  /* fills the screen */
  const box = await page.evaluate(() => {
    const panel = document.querySelector('[role=dialog] > div');
    const r = panel.getBoundingClientRect();
    return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight };
  });
  check(
    'panel fills the viewport',
    box.w > box.vw * 0.9 && box.h > box.vh * 0.9,
    `${Math.round(box.w)}x${Math.round(box.h)} of ${box.vw}x${box.vh}`,
  );

  /* page navigation */
  const pager = await page.evaluate(() =>
    [...document.querySelectorAll('[role=dialog] span')]
      .map((s) => s.textContent.trim())
      .find((t) => /^\d+ \/ \d+$/.test(t)),
  );
  check('shows a page counter', !!pager, pager ?? 'none');

  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(
    () => document.querySelectorAll('[role=dialog] img').length >= 2 &&
          [...document.querySelectorAll('[role=dialog] img')].every((i) => /page 2/.test(i.alt)),
    { timeout: 240_000, polling: 400 },
  ).catch(() => {});
  const onPage2 = await page.evaluate(() =>
    [...document.querySelectorAll('[role=dialog] span')]
      .map((s) => s.textContent.trim())
      .some((t) => /^2 \//.test(t)),
  );
  check('arrow key turns the page', onPage2);
  await page.screenshot({ path: '.check/compare-page2.png' });

  /* zoom to real pixels */
  const beforeZoom = await page.evaluate(
    () => document.querySelector('[role=dialog] img').getBoundingClientRect().width,
  );
  await (await page.$('[role=dialog] button ::-p-text(200%)')).click();
  await page.waitForFunction(
    (w) => {
      const img = document.querySelector('[role=dialog] img');
      return img && img.getBoundingClientRect().width > w * 1.5;
    },
    { timeout: 240_000, polling: 400 },
    beforeZoom,
  ).catch(() => {});
  const afterZoom = await page.evaluate(
    () => document.querySelector('[role=dialog] img').getBoundingClientRect().width,
  );
  check('200% enlarges the page', afterZoom > beforeZoom * 1.5,
    `${Math.round(beforeZoom)} → ${Math.round(afterZoom)} px`);

  /* the pane actually scrolls at that zoom */
  const scrollable = await page.evaluate(() => {
    const panes = [...document.querySelectorAll('[data-compare-pane]')];
    const pane = panes.find((p) => p.scrollHeight > p.clientHeight + 10 || p.scrollWidth > p.clientWidth + 10);
    return pane ? { h: pane.scrollHeight, ch: pane.clientHeight, w: pane.scrollWidth, cw: pane.clientWidth } : null;
  });
  check('zoomed pane is scrollable', !!scrollable,
    scrollable ? `content ${scrollable.w}x${scrollable.h} in ${scrollable.cw}x${scrollable.ch}` : 'not scrollable');

  /* both sides move together */
  const synced = await page.evaluate(async () => {
    const panes = [...document.querySelectorAll('[data-compare-pane]')];
    if (panes.length < 2) return null;
    panes[0].scrollTop = 260;
    panes[0].dispatchEvent(new Event('scroll', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    // Both must have actually moved; 0 vs 0 would mean nothing scrolled at all.
    return { a: panes[0].scrollTop, b: panes[1].scrollTop, moved: panes[0].scrollTop > 0 };
  });
  check('scrolling one side moves the other', synced && synced.moved && Math.abs(synced.a - synced.b) < 4,
    synced ? `${synced.a} vs ${synced.b}` : 'no panes');

  await page.screenshot({ path: '.check/compare-zoom.png' });

  const real = errors.filter((e) => !/DevTools|React DevTools/i.test(e));
  check('no console errors', real.length === 0, real.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed\n`);
process.exit(failed === 0 ? 0 : 1);
