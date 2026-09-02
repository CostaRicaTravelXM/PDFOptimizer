/** Structural check: parse an optimized PDF and confirm pages, text and links survived. */
import { readFileSync } from 'node:fs';
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const file = process.argv[2];
const doc = await pdfjs.getDocument({
  data: new Uint8Array(readFileSync(file)),
  disableWorker: true,
  isEvalSupported: false,
}).promise;

let chars = 0, links = 0, images = 0;
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const tc = await page.getTextContent();
  chars += tc.items.reduce((s, it) => s + (it.str?.length ?? 0), 0);
  links += (await page.getAnnotations()).filter((a) => a.subtype === 'Link').length;
  const ops = await page.getOperatorList();
  images += ops.fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject).length;
  page.cleanup();
}
console.log(`${file.split(/[\/]/).pop()}`);
console.log(`  pages=${doc.numPages} textChars=${chars} links=${links} imageDraws=${images}`);
await doc.destroy();
