# TravelXM Tools Suite

A small suite of tools for the jobs that come up every day.

| Tool | Route | What it does |
|---|---|---|
| **PDF Optimizer** | `/tools/pdf-optimizer` | Shrinks oversized PDFs so they can be emailed. Entirely in the browser. |
| **Email Image Hosting** | `/tools/email-images` | Takes an email-builder `.zip`, uploads the images to Cloudflare R2, and rewrites the HTML to point at them. |
| **AI Itinerary Presentation** | `/tools/itinerary-presentation` | Turns an itinerary PDF into an editable Canva deck: the slides are planned and written by Claude, photos come from the approved library or Pexels, and the deck is built as PowerPoint and imported into Canva. |

Adding a tool is one entry in `lib/tools.ts` plus a route under `app/tools/`.

---

## PDF Optimizer

Drop oversized PDFs in, get back files small enough to email. Built for itineraries and
proposals exported from design tools, which routinely come out at 100 MB or more.

Everything runs in the browser. Nothing is uploaded, and client documents never leave the
machine they were opened on.

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
npm run build        # production build; deploys to Vercel as-is
npm run typecheck
```

The PDF Optimizer needs no configuration. The Email Image Hosting tool needs the R2
credentials below — without them it says so plainly rather than failing at upload time.

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

---

## Email Image Hosting

Email builders (Beefree, Stripo, Mailchimp) export a `.zip` holding one HTML file and an
`images/` folder, with the images referenced by relative paths. That only works while the
folder travels with the HTML — paste the HTML into a sending platform on its own and every
image breaks.

This tool optimizes the images, uploads them to a Cloudflare R2 bucket, and rewrites every
reference to the public URL, then offers the HTML on its own or the whole archive with only
the HTML changed.

### Image optimization

Before upload, each image is re-encoded to WebP and capped to a maximum edge (1200px by
default — email bodies are ~600px wide, so that covers a retina display). On the reference
export this takes 1.30 MB down to 0.76 MB, 42% smaller, with no visible difference.

Both are optional. Turn WebP off to keep the original formats and only resize.

> **WebP and Outlook.** Outlook for Windows uses the Word rendering engine and cannot display
> WebP — recipients on it see a broken image. Gmail, Apple Mail and Outlook.com are all fine.
> If your list skews corporate, turn WebP off and let the resize do the work.

SVG and GIF are never converted: SVG is vector, and a canvas only sees a GIF's first frame,
so converting would silently drop the animation. Anything the browser cannot decode, or that
comes out larger as WebP, is uploaded unchanged with a note saying why.

### How the upload works

The `.zip` is never sent to the server. The browser unpacks it, asks `/api/r2/presign` for
short-lived signed `PUT` URLs, and uploads each image straight to R2. The bucket credentials
stay server-side, and the file bytes never pass through the serverless function — which
matters, because Vercel caps a function request body at 4.5 MB and these archives are bigger
than that.

Rewriting is by pattern over attribute values (`src`, `href`, `srcset`, CSS `url(...)`), and
a value is only substituted when it resolves to a file that was actually in the archive. That
is what keeps `mailto:`, `tel:`, `#`, absolute URLs and `{{ merge_tags }}` untouched: none of
them can ever resolve to an archive entry.

### Cloudflare R2 setup

1. **Create the bucket.** Cloudflare dashboard → R2 → *Create bucket*, e.g.
   `travelxm-email-assets`.

2. **Make it publicly readable.** Bucket → Settings → Public access → enable the **r2.dev
   subdomain**, which gives you `https://pub-<hash>.r2.dev`. For production, prefer
   *Custom Domain* (e.g. `assets.travelxm.com`) — r2.dev is rate-limited and not meant for
   production traffic. Email images must be publicly readable or recipients see nothing.

3. **Allow the browser to upload.** Bucket → Settings → CORS policy:

   ```json
   [
     {
       "AllowedOrigins": ["https://your-app.vercel.app", "http://localhost:3000"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Miss this and every upload fails with no error body — the tool says as much when it
   happens.

4. **Create an API token.** R2 → Manage API Tokens → *Create API token*, permission
   **Object Read & Write**, scoped to that bucket. Keep the Access Key ID and Secret.

5. **Set the environment variables** in `.env.local` for development and in Vercel →
   Settings → Environment Variables for production. See `.env.example`:

   | Variable | Example |
   |---|---|
   | `R2_ACCOUNT_ID` | `a1b2c3…` (Cloudflare account ID) |
   | `R2_ACCESS_KEY_ID` | from step 4 |
   | `R2_SECRET_ACCESS_KEY` | from step 4 |
   | `R2_BUCKET` | `travelxm-email-assets` |
   | `R2_PUBLIC_BASE_URL` | `https://pub-xxxx.r2.dev` (no trailing slash) |
   | `R2_ENDPOINT` | optional; only for jurisdiction-specific buckets |

### Where files land

Under a folder named after the uploaded `.zip`, keeping the original paths:
`luxury-costa-rica/images/<name>.jpg`. The folder is an editable field in the UI, and
uploading the same name again replaces what is there.

---

## AI Itinerary Presentation

Drop an itinerary brief (PDF), choose **Minimal** (agents, operations) or **Immersive**
(clients), fill in a title and destination, and get back an editable Canva design — or the
PowerPoint file when Canva cannot import it. The business rules behind it (styles, asset
policy, slide types) live in the project's business plan; this section covers how the pieces
fit and how to run them.

### How it fits together

```
browser ── reads the PDF text (pdf.js) ──┐
   │                                     │
   ├── PUT source.pdf ──► Cloudflare R2  │
   │                                     ▼
   └── POST /api/presentations/jobs ──► job.json (queued) ──► n8n webhook (202)
                                                                 │
   GET /api/presentations/jobs/<id>  ◄── polls every 3 s         │ plans the slides (Claude),
                                                                 │ resolves photos (WorkDrive → Pexels),
   PATCH /api/presentations/jobs/<id> ◄── status updates ────────┤
   POST  /api/presentations/compile  ◄── manifest + image URLs ──┤ builds the PPTX (this app),
                                                                 │ imports it into Canva,
   PATCH … {status:"done", canva:{editUrl}} ◄────────────────────┘ reports the link
```

Three decisions shape the design:

- **The PDF never passes through a server function.** The platform caps request bodies at
  4.5 MB and briefs run past 100 MB, so the browser extracts the text with pdf.js and PUTs
  the file straight to R2 with a signed URL, in parallel.
- **This app is the only writer of the job record.** n8n reports progress through the PATCH
  route rather than touching the bucket, so there is one merge policy, one `updatedAt`, and
  the workflow needs no bucket credentials.
- **The compiler lives here, not in n8n.** n8n Cloud cannot run PptxGenJS. The compile route
  takes a slide manifest plus resolved image URLs, renders editable slides from a small
  library of layout primitives, writes the `.pptx` to R2 and returns its URL.

### The compiler

`lib/server/presentations/` turns a manifest into a deck deterministically: the planner
chooses a layout primitive and writes the copy; the compiler owns every coordinate, font
size and crop.

| Primitive | Used for |
|---|---|
| `full_bleed_hero_with_left_copy` | cover, destination intros |
| `split_photo_text` | itinerary days, overview |
| `asymmetric_two_photo_editorial` | hotel and experience showcases |
| `timeline_route` | the route at a glance (up to 7 stops) |
| `information_cards` | inclusions, logistics (cards or included/excluded lists) |
| `hotel_comparison` | up to three accommodation options |
| `closing_story` | the last slide with contact details |

Worth knowing:

- Text fitting is done here, not by PowerPoint: Canva's importer does not shrink text, so
  the compiler predicts wrapping from average glyph widths, steps sizes down to a floor, and
  finally shortens on a word boundary and says so in a warning.
- Photos are cropped with PowerPoint's own source rectangle (`sizing: cover`), so the whole
  photograph survives into Canva and can be re-framed there.
- A named hotel with no approved photo gets a branded shape composition, never a stock
  photo of some other hotel. Gradient scrims are single transparent PNG layers because
  PptxGenJS has no gradient fills.
- Brand tokens (colours, Cormorant Garamond + DM Sans) are in `brand.ts`; the logo and
  scrims are embedded as base64 by `npm run presentations:embed-assets`. Drop a
  `public/logotxm-white.png` and re-run it to get a white logo on dark slides.

### Environment variables

| Variable | Purpose |
|---|---|
| `N8N_PRESENTATION_WEBHOOK_URL` | Production URL of the n8n webhook that runs a job |
| `N8N_SHARED_SECRET` | Sent to n8n as `x-tools-secret`; the webhook rejects anything else |
| `PRESENTATIONS_COMPILE_SECRET` | n8n sends it back as `Authorization: Bearer …` on PATCH and compile |
| `TOOLS_ACCESS_CODE` | Optional. When set, the page asks for it once per browser before starting a job |

Plus the R2 variables above. The bucket's CORS policy must allow `PUT` from the site's
origin (and `http://localhost:3000` for development) — the same rule the image tool needs.

### Job record and contract

A job is `presentations/jobs/<id>/job.json` in the bucket, next to `source.pdf`,
`text.txt`, `manifest.json` and the compiled `.pptx`. The id is `YYYYMMDD-HHMMSS-xxxxxx`, so
a listing comes back in order. The shape (`JobRecord`, `JobPatch`, the manifest and the
compile request) is defined once in `lib/presentations/types.ts` and
`lib/presentations/manifest.ts`; the n8n workflows are built against exactly that.

| Call | Auth | Body → response |
|---|---|---|
| `POST /api/presentations/upload-url` | access code (optional) | `{name,size,contentType}` → `{jobId,pdfKey,pdfUrl,uploadUrl}` |
| `POST /api/presentations/jobs` | access code (optional) | form fields + `jobId,pdfKey,pageCount,textChars,textLow,text`, or `{retryOf}` → `{job}` |
| `GET /api/presentations/jobs?limit=` | – | `{jobs}` (summaries; never the PDF URL) |
| `GET /api/presentations/jobs/<id>` | – | the record |
| `PATCH /api/presentations/jobs/<id>` | bearer | partial `{status,step,manifestKey,pptxKey,pptxUrl,canva,warnings,assets,meta,error}` → merged record |
| `POST /api/presentations/compile` | bearer | `{jobId,manifest,assets}` → `{pptxKey,pptxUrl,slideCount,warnings}`; `400 {issues}` if the manifest is unusable |

The webhook n8n receives is `{jobId, …input, textKey, text}` and must answer `202` at once.
A Canva failure ends the job as `done` without `canva`, and the page offers the PowerPoint.

### Running it locally

```
npm run presentations:fixture      # builds .check/fixture-{immersive,minimal}.pptx from a manifest
                                   # that exercises every layout, a placeholder, a rejected
                                   # image and an over-long title. No server needed.
npm run presentations:mock-n8n     # a stand-in for the workflow on http://localhost:5678
npm run dev                        # with N8N_PRESENTATION_WEBHOOK_URL pointed at the mock
```

The fixture decks open in PowerPoint; with PowerPoint installed, exporting them to PNG is a
quick way to eyeball every slide. Two caveats when checking on a machine without the brand
fonts: PowerPoint substitutes them, and its PNG export occasionally repeats a word at a line
break with a substituted font. The file itself has each word once, and Canva has both fonts.

The mock accepts the webhook exactly as n8n will, walks the job through every status with
PATCH calls, has the app compile the fixture manifest restyled to the job's title and
style, and finishes without Canva. `--fail-at=compiling` (or any status) exercises the
failure path.

### Before real use

- Set `TOOLS_ACCESS_CODE`: there is no login, and a job spends Claude, Pexels and Canva
  quota. The per-connection rate limit is a deterrent only.
- The bucket is public, so briefs sit at unlisted URLs. Add an R2 lifecycle rule that
  deletes `presentations/jobs/*/source.pdf` and `text.txt` after a week.
- `maxDuration` on the compile route is 60 s (the Hobby ceiling). Raise it in the route on
  a Pro plan if large immersive decks need it.
