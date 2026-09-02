# TravelXM PDF Optimizer

Drop oversized PDFs in, get back files small enough to email. Built for itineraries and
proposals exported from design tools, which routinely come out at 100 MB or more.

Everything runs in the browser. Nothing is uploaded, there is no backend, and client
documents never leave the machine they were opened on.

**Measured on a reference itinerary** — a 13-page Canva export carrying 183 images and
348 megapixels, most of it stored uncompressed:

| | Before | After |
|---|---|---|
| Size | 121.0 MB | **15.3 MB** (87% smaller) |
| Pages | 13 | 13 |
| Text characters | 3969 | 3969 |
| Links | 1 | 1 |
| Time | — | ~6 s in Chrome |

Text stays selectable and searchable. At normal viewing size the two documents are
indistinguishable.

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # static export to ./out — deploy anywhere, no server needed
```

## How it works

Two engines, behind one decision.

**Smart** (default) rewrites only the embedded image streams: it decodes each one, caps its
resolution to what the page can actually show, re-encodes as JPEG, and collapses duplicate
images onto a single shared object. Text, fonts, vectors, links and page structure are never
touched. Images whose encoding cannot be converted with confidence — CMYK, indexed palettes,
JPEG 2000, CCITT — are left byte-identical rather than guessed at.

**Flatten** renders each page to an image and rebuilds the document. It is the guaranteed
floor for files Smart cannot help, and it costs the text layer, so it is a last resort.

`workers/engine/orchestrate.ts` spends quality before it spends the text layer: Smart at the
chosen preset, then Smart at a lower one if the size target was missed, and only then
Flatten. On the reference file it never gets past the first step.

### The one number that mattered

Design tools declare enormous page boxes — the reference file is a 20-inch-wide slide.
Budgeting image resolution against that literal size is the obvious implementation and it is
wrong twice over: it reserves detail for a print nobody makes, and it barely shrinks the
file. Clamping the assumed page to a realistic sheet of paper
(`MAX_ASSUMED_PAGE_INCHES` in `workers/engine/budget.ts`) is the difference between 41 MB
and 15 MB on identical settings.

### Layout

```
app/                 one screen: layout, page, brand tokens
components/          dropzone, file rows, comparison view, quality menu
lib/                 queue + worker pool, formatting, zip, page previews
workers/
  optimize.worker.ts message loop and error classification
  engine/
    smart.ts         image-substitution engine (pdf-lib)
    raster.ts        page-rasterizing fallback (pdf.js + pdf-lib)
    images.ts        inflate, PNG predictors, resampling, JPEG encoding
    budget.ts        how many pixels a page is worth
    orchestrate.ts   the fallback ladder
    presets.ts       quality presets and size targets
```

Concurrency is governed by bytes in flight rather than file count
(`lib/usePdfQueue.ts`): a worker decoding a 20-megapixel photograph holds far more memory
than the file size suggests, so large files are given the machine to themselves.

## Verification

The engine is checked two ways: numerically from Node, and end to end in real Chrome.

```bash
npm run acceptance -- <baseUrl> "<reference.pdf>"   # 16 checks through the real UI
npm run bench -- "<file.pdf>" balanced   # size, timing and per-image statistics
npm run quality -- "<a.pdf>" "<b.pdf>" 13 # PSNR per page, rendered in Chrome
npm run crop -- "<a.pdf>" "<b.pdf>" 2 .check/crop.png 2600 0.05 0.18 0.45 0.30
npm run diagnose -- "<file.pdf>"      # what every image is and whether Smart can touch it
npm run verify -- "<file.pdf>"        # pages, text characters, links and image draws
npm run compare-ui -- <baseUrl> "<file.pdf>"  # 7 checks on the comparison view
npm run hydration -- <baseUrl>        # replays the extension that causes hydration warnings
npm run typecheck
```

`scripts/acceptance.mjs` covers the reference file, the comparison view, re-running on a
quality change, bulk processing, the zip download, keyboard access, and four awkward inputs:
password-protected, already-small, not-actually-a-PDF, and a CMYK file that forces the
flatten fallback. Regenerate the fixtures with:

```bash
python scripts/fixtures.py "<reference.pdf>" .check/fixtures   # any large image-heavy PDF
python scripts/cmyk_fixture.py .check/fixtures/cmyk-brochure.pdf 6
```

`npm run quality` reports PSNR, but read it alongside `npm run crop`. On the reference file
the mean is ~34 dB, which sounds mediocre and is not: the difference only becomes visible
past roughly 150% zoom, and a proposal is read at page width. The crop tool renders both
files at a chosen size so that judgement is made by eye rather than by a proxy.

The verification harness needs `@napi-rs/canvas`, `esbuild` and `puppeteer-core`
(devDependencies). Puppeteer drives the Chrome already installed on the machine; no browser
is downloaded. Adjust the `CHROME` constant at the top of the scripts if yours lives
elsewhere.

## Browser extensions and hydration

Bitdefender Anti-tracker (`eppiocemhmnlbhjplcgkofciie`) stamps `bis_skin_checked`,
`bis_register` and `__processed_<uuid>__` onto elements as the page parses; Grammarly and
several password managers do the equivalent. React then compares the server HTML against
what it renders, finds the extras and reports a hydration mismatch it "won't patch up".

`suppressHydrationWarning` on `<html>` and `<body>` covers those two elements, but the
attributes also land on ordinary `<div>`s — including one Next.js renders for metadata —
where that opt-out cannot reach. So `app/layout.tsx` also carries a small inline script that
strips the attributes until hydration finishes, then disconnects. It has to be a raw
`<script>` tag: `next/script` with `strategy="beforeInteractive"` defers the source into
Next's own bootstrap queue (`self.__next_s`), which runs too late.

`npm run hydration` replays the extension in a clean browser so the fix can be shown to
actually silence the warning rather than assumed to.

## Brand

Design tokens, fonts and component styles are taken from travelxm.com's live stylesheet so
the tool reads as part of the same product. Colours are defined once in `app/globals.css`;
the four families (DM Sans, Cormorant Garamond, Playfair Display, Caveat) are the same ones
the site loads.
