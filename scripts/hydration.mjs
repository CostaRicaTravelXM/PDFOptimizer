/**
 * Reproduce the Bitdefender hydration mismatch.
 *
 *   node scripts/hydration.mjs [baseUrl]
 *
 * The Bitdefender Anti-tracker extension (id eppiocemhmnlbhjplcgkofciie) stamps
 * `bis_skin_checked`, `bis_register` and `__processed_<uuid>__` onto elements of the
 * server-rendered HTML before React hydrates, which React then reports as a mismatch.
 *
 * This installs a stand-in for that extension so the warning can be reproduced in a clean
 * browser, and a fix can be shown to actually silence it.
 */

import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const base = process.argv[2] ?? 'http://localhost:3210';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1280, height: 900 },
});

const page = await browser.newPage();

// Stand in for the extension: stamp the same attributes onto elements as they are parsed,
// which is what puts them in place before React gets to hydrate.
await page.evaluateOnNewDocument(() => {
  const stamp = (el) => {
    if (el.nodeType !== 1) return;
    if (el.tagName === 'DIV' || el.tagName === 'SECTION' || el.tagName === 'LI') {
      el.setAttribute('bis_skin_checked', '1');
    }
    if (el.tagName === 'BODY') {
      el.setAttribute('bis_register', 'W3sibWFzdGVyIjp0cnVlfV0=');
      el.setAttribute('__processed_c89c61f1-9533-4384-af66-83ac2f9f1be2__', 'true');
    }
  };

  // Stamp each element as the parser appends it, which is how the real extension gets
  // its attributes in before React hydrates. Walking descendants here would be quadratic.
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) stamp(n);
  }).observe(document, { childList: true, subtree: true });

  // Capture console.error in full: the element diff React prints lives in later arguments
  // that the debugging protocol truncates.
  window.__hydrationLog = [];
  const original = console.error.bind(console);
  console.error = (...args) => {
    window.__hydrationLog.push(args.map((a) => String(a?.message ?? a)).join('\n'));
    original(...args);
  };
});

const messages = [];
page.on('console', (m) => messages.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => messages.push(`pageerror: ${e.message}`));

await page.goto(base, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 4000));

const stamped = await page.evaluate(() => ({
  divs: document.querySelectorAll('div[bis_skin_checked]').length,
  body: document.body.hasAttribute('bis_register'),
}));

const captured = await page.evaluate(() => window.__hydrationLog ?? []);
const hydration = captured.filter((m) => /hydrat/i.test(m));

console.log(`\nsimulated extension: ${stamped.divs} divs stamped, body=${stamped.body}`);
console.log(`hydration complaints: ${hydration.length}`);
for (const h of hydration) console.log(`\n  ${h.replace(/\n/g, '\n  ')}`);
console.log();

await browser.close();
process.exit(hydration.length === 0 ? 0 : 1);
