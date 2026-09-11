// Build Claude request — runs once. Assembles the Messages API body.
//
// The system prompt is byte-identical on every run and carries a cache breakpoint; the
// brief is the second breakpoint so the retry call reads both from cache. Job parameters
// and the asset index come last, because they change per job.
const ctx = $('Context').first().json;
const body = $('Webhook').first().json.body || {};
const index = ($('Asset index').first().json || {}).assets || [];

const SYSTEM = __SYSTEM_PROMPT__;
const SCHEMA = __MANIFEST_SCHEMA__;

const indexLines = index
  .slice(0, 300)
  .map((a) =>
    [a.id, a.filename, a.destination, a.entity_type, (a.entities || []).join(', '), (a.tags || []).join(', '), a.orientation]
      .map((v) => (v == null ? '' : String(v)))
      .join(' | '),
  );

const params = [
  'Job parameters:',
  `- title: ${ctx.title}`,
  `- style: ${ctx.style}`,
  `- audience: ${ctx.audience}`,
  `- language: ${ctx.language}`,
  `- destination: ${ctx.destination}`,
  ctx.clientName ? `- client name: ${ctx.clientName}` : null,
  ctx.travelDates ? `- travel dates: ${ctx.travelDates}` : null,
  ctx.travelers ? `- travelers: ${ctx.travelers}` : null,
  ctx.notes ? `- special instructions from the user: ${ctx.notes}` : null,
  ctx.textLow
    ? '- extraction quality: LOW. The PDF yielded little text; be conservative, keep to what is legible, and add warnings where the brief is unclear.'
    : null,
  '',
  `Available approved assets (${index.length}), as "id | filename | destination | entity_type | entities | tags | orientation":`,
  indexLines.length
    ? indexLines.join('\n')
    : 'None. Use source "placeholder" for named properties and brand elements, and "pexels" with a fallback_query for generic scenes.',
].filter((l) => l !== null);

const request = {
  model: ctx.model,
  max_tokens: 32000,
  system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: `<brief>\n${String(body.text || '')}\n</brief>`, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: params.join('\n') },
      ],
    },
  ],
  output_config: {
    effort: ctx.effort,
    format: { type: 'json_schema', schema: SCHEMA },
  },
};

return [{ json: { request } }];
