# n8n — Itinerary Presentation

Two workflows that turn an itinerary brief into an editable Canva deck. The Tools Suite app
(`/tools/itinerary-presentation`) uploads the PDF, extracts its text and calls the webhook;
n8n plans the slides with Claude, resolves the photographs, asks the app to compile a PPTX,
and imports it into Canva.

**The app owns the job record.** n8n never writes to the bucket. Every step reports progress
with `PATCH /api/presentations/jobs/:id`, so there is one writer, one merge policy, and the
workflow needs no storage credentials.

Deployed on `blocktxm.app.n8n.cloud`, project *Personal* → folder *TravelXM Workflows*:

| Workflow | Id | Link |
|---|---|---|
| TravelXM — Itinerary Presentation · Main | `VympOEgV8uXSA6LL` | https://blocktxm.app.n8n.cloud/workflow/VympOEgV8uXSA6LL |
| TravelXM — Itinerary Presentation · Error handler | `4tRHOBX8n0SuFGC2` | https://blocktxm.app.n8n.cloud/workflow/4tRHOBX8n0SuFGC2 |

## The files are generated — do not edit inside n8n

```
npm run n8n:build     # sources  ->  workflows/*.json
npm run n8n:test      # run every Code node outside n8n
npm run n8n:deploy    # push to the instance
```

| Path | What it is |
|---|---|
| `src/system-prompt.md` | The planner's system prompt, with `{{PLACEHOLDERS}}` filled at build time |
| `src/code/*.js` | One file per Code node, real JavaScript you can read and diff |
| `src/constants-entry.ts` | Re-exports the app constants the build injects |
| `build.mjs` | Assembles the workflow JSON: node list, wiring, layout, injections |
| `deploy.mjs` | Creates or updates the workflows through the n8n public API |
| `create-secrets.mjs` | One-off: generates the two shared-secret credentials |
| `test-code.mjs` | Offline harness with a fake n8n context |
| `workflows/*.json` | Build output. Importable, but regenerated on every build |
| `fixtures/` | A sample webhook body and a valid Claude response for pinning |

Anything typed into a node in the n8n editor is overwritten on the next deploy. Credentials
you select by hand are the exception — `deploy.mjs` keeps those.

Copy limits, layout ids, brand colours and the manifest JSON Schema are injected from
`lib/presentations/` and `lib/server/presentations/brand.ts`, so the prompt, the validator and
the compiler cannot drift apart.

## Main workflow, node by node

```
Webhook ─ Validate payload ─ Payload valid? ─┬─ no ─ Respond 400
                                             └─ yes ─ Respond 202 (everything below runs after the reply)
Config ─ Context ─ Read job ─ Can it run? ─ Run?
  Status: planning
  Asset index                         (stub until WorkDrive exists)
  Build Claude request ─ Claude — plan ─ Validate manifest ─ Manifest valid?
        └─ no ─ Build retry ─ Claude — retry ─ Validate manifest (2) ─ Manifest valid (2)?
  Final manifest ─ Status: resolving assets
  Flatten requirements ─ Route assets ─ Search Pexels? ─ Pexels — search
  Merge ─ Select assets ─ Status: compiling
  Compile ─ Status: importing ─ Import to Canva?
        ├─ no  ─ Status: done (no Canva)
        └─ yes ─ Canva — import ─ Canva result ─ Canva OK? ─┬─ Status: done (with Canva)
                                                            └─ Status: done (Canva failed)
any error output ───────────────────────────────► Failure ─ Status: failed
```

| Node | What it does |
|---|---|
| **Webhook** | `POST /itinerary-presentation`, header auth. A wrong secret is rejected as 403 before an execution is even created. |
| **Validate payload** | Checks the enums, the required fields, the job id format and that the brief has at least 200 characters. |
| **Respond 202 / 400** | Answers the app immediately; the rest of the workflow runs after the response. |
| **Config** | The only per-environment settings: app URL, model, effort, Canva on/off, and the three API base URLs. |
| **Context** | Flattens everything later nodes need into one item, so expressions read `$('Context').first().json.x`. |
| **Read job** | Fetches the job record from the app. Doubles as a reachability check. |
| **Can it run? / Run?** | Idempotency: a job that is already running or finished is skipped unless the body says `force`. |
| **Status: …** | Nine `PATCH` calls that move the job through the timeline the page shows. |
| **Asset index** | Today returns an empty list. When the WorkDrive indexer lands it returns the approved assets and nothing downstream changes. |
| **Build Claude request** | Assembles the Messages API body: cached system prompt, cached brief, job parameters, asset index, and `output_config.format` with the manifest schema. |
| **Claude — plan / retry** | The planning call, and one retry that receives its own answer plus the list of validation errors. |
| **Validate manifest (1 / 2)** | The business rules the schema cannot express. Pass 1 is strict and reports errors for the retry; pass 2 repairs what it safely can and only fails on what it cannot. |
| **Final manifest** | Picks whichever pass produced a usable manifest and carries the token usage. |
| **Flatten requirements** | One item per image the plan asks for, with the orientation and minimum width its layout needs. |
| **Route assets** | The pluggable WorkDrive step: approved match wins; a named property or brand element without one gets a placeholder, never a stock photo; anything generic goes to Pexels. |
| **Pexels — search** | Batched 5 per 1.2 s to respect the rate limit. A failure here degrades to a placeholder rather than failing the job. |
| **Select assets** | Scores, filters and de-duplicates the results, then builds the asset map and the licensing audit records. |
| **Compile** | `POST /api/presentations/compile` on the app, which renders the PPTX and writes it to the bucket. |
| **Canva — import** | The official Canva node, *Design Import → Import From URL*. It takes the public PPTX URL and polls the import job itself. |
| **Canva result / Canva OK?** | Normalises success and failure into one shape. A Canva problem is not a failed job. |
| **Failure / Status: failed** | Every error output lands here; it names the node and maps it to the timeline row the page should mark red. |

### Design decisions worth knowing

- **One execution per job.** No sub-workflows: n8n Cloud bills per execution.
- **`Respond 202` comes early** so the app is never left waiting on a 2–6 minute run.
- **Everything degrades rather than fails.** No photo becomes a branded placeholder; no Canva
  becomes a PowerPoint download. The deck is never lost after it has been built.
- **A named hotel never gets a stock photo.** The rule is enforced twice: in the prompt, and
  again in `Route assets`, which overrides the planner if it tries.

## The planning call

- `claude-opus-5`, `max_tokens: 32000`, `output_config.effort: medium`. No `temperature` —
  it is rejected on this model.
- **Structured outputs** with the manifest JSON Schema, so the answer is schema-valid JSON.
  Two API rules shaped that schema: an `enum` may not sit on a nullable type, and a schema may
  carry at most 16 union-typed parameters. Nothing is nullable as a result — an unused text
  field is `""` and an unused list is `[]`, and `Validate manifest` strips both.
- **Prompt caching** on the system prompt and on the brief, so the retry re-reads both from
  cache. Check `usage.cache_read_input_tokens` in `job.meta`.
- Roughly **$0.25 per deck**; a retry adds little because the input is cached.

## Setup

### Credentials

Referenced by name; `deploy.mjs` wires them automatically when the names match.

| Name | Type | Notes |
|---|---|---|
| `Tools Suite → n8n (x-tools-secret)` | Header Auth | Name `x-tools-secret`; same value as the app's `N8N_SHARED_SECRET` |
| `n8n → Tools Suite (bearer)` | Header Auth | Name `Authorization`, value `Bearer <PRESENTATIONS_COMPILE_SECRET>` |
| `Anthropic account TravelXM` | Anthropic | API key |
| `Pexels` | Header Auth | **Name must be exactly `Authorization`**; value is the raw key, no `Bearer` |
| `Canva account` | Canva OAuth2 API | Only Client ID and Secret; the node supplies the rest |
| `n8n API` | n8n API | Error handler only |

The first two were generated by `node n8n/create-secrets.mjs`; their values must match Vercel.

### Canva

1. [Canva Developers](https://www.canva.com/developers/) → create a **private** integration.
2. Redirect URL: `https://blocktxm.app.n8n.cloud/rest/oauth2-credential/callback`.
3. Generate the client secret (shown once).
4. In n8n create a **Canva OAuth2 API** credential named `Canva account`, paste the id and
   secret, and press *Connect my account* as the user who should own the designs. PKCE, the
   OAuth URLs and the scopes (including `design:content:write`) come from the node.
5. Set `CANVA_ENABLED=true` in Config.

Canva rotates the refresh token on every renewal, so only this credential should use it.

### Deploy

```
npm run n8n:deploy -- --dry-run                       # show what would change
npm run n8n:deploy -- --app-url=https://…             # set Config's TOOLS_APP_URL
npm run n8n:deploy -- --canva=false --activate        # skip Canva, activate Main
```

Needs `N8N_BASE_URL` and `N8N_API_KEY` in the environment or `.env.local`. Workflows are
matched by name inside the *TravelXM Workflows* folder, so re-running updates them instead of
creating copies.

Afterwards, in the editor: set Settings → Error Workflow on Main, raise the workflow timeout
above 15 minutes, activate, and copy the Webhook Production URL into Vercel as
`N8N_PRESENTATION_WEBHOOK_URL`.

## Contract

The app sends:

```json
{ "jobId": "20260911-204414-f12c39", "title": "…", "style": "minimal|immersive",
  "audience": "agent|internal|client|mixed", "language": "en|es", "destination": "…",
  "clientName": "", "travelDates": "", "travelers": "", "notes": "",
  "pdfKey": "…", "pdfUrl": "…", "pageCount": 3, "textChars": 7883, "textLow": false,
  "textKey": "…", "text": "…the PDF's text…" }
```

`dryRun: true` skips Canva and `force: true` re-runs a finished job; the app sends neither.
Replies are `202 {accepted, jobId}`, `400 {accepted:false, errors}` or `403`.

What n8n sends back is `JobPatch` in `lib/presentations/types.ts` and `CompileRequest` in
`lib/presentations/manifest.ts`. See the app's README.

## Testing

Every Code node, with no n8n and no cost:

```
npm run n8n:test
```

A real run without touching Canva:

```
curl -i -X POST "https://blocktxm.app.n8n.cloud/webhook/itinerary-presentation" \
  -H "Content-Type: application/json" -H "x-tools-secret: <secret>" \
  -d @n8n/fixtures/sample-payload.json
```

The fixture's `jobId` does not exist, so `Read job` returns 404 and the run stops there. For a
full pass, create a job in the app, put its id in the body, and watch the record move through
`planning → resolving assets → compiling → importing → done`.

To exercise the validator without paying for a planning call, pin
`fixtures/sample-claude-response.json` onto *Claude — plan* and execute manually.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Job fails instantly, "The planning workflow could not be reached" | The Main workflow is not active, so the production webhook 404s. |
| Job sits at "Received" forever | n8n cannot reach `TOOLS_APP_URL`. Check the Config node; localhost is not reachable from n8n Cloud. |
| `Read job` returns 404 | The app is reachable but the job id is unknown to it — usually the app and n8n pointing at different buckets or environments. |
| Every photo is a placeholder, warning says `ERR_INVALID_HTTP_TOKEN` | The Pexels credential's **Name** field is not a valid header name. It must be exactly `Authorization`, with the key in Value. |
| Every photo is a placeholder, warning says 401 | The Pexels key itself is wrong. |
| `Bad request - please check your parameters` on a Claude node | The Messages API rejected the request. The real reason is in the execution under the node's error `description`. |
| Job ends `done` with a Canva warning | The import failed or timed out. The PowerPoint is still in the job record. |

Anthropic errors are worth opening in the execution view: n8n's message is generic, but
`error.description` carries the API's own sentence.

## Costs and limits

- Claude: about $0.25 per deck at `medium` effort.
- Pexels free tier: 200 requests an hour; a job makes 10–30. Ask them to raise it.
- n8n Cloud: one execution per job, 2–6 minutes each.
