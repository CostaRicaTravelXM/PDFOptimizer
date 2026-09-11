// Context — runs once. Everything later nodes need about this job, in one place, so
// expressions read `$('Context').first().json.x` instead of digging into the webhook body.
const body = $('Webhook').first().json.body || {};
const cfg = $('Config').first().json;
const s = (v) => (typeof v === 'string' ? v.trim() : '');
const canvaEnabled = String(cfg.CANVA_ENABLED).toLowerCase() === 'true';

return [
  {
    json: {
      jobId: s(body.jobId),
      title: s(body.title),
      style: body.style,
      audience: body.audience,
      language: body.language,
      destination: s(body.destination),
      clientName: s(body.clientName),
      travelDates: s(body.travelDates),
      travelers: s(body.travelers),
      notes: s(body.notes),
      textLow: body.textLow === true,
      pageCount: Number(body.pageCount) || 0,
      textChars: Number(body.textChars) || 0,
      textLength: s(body.text).length,
      // dryRun skips Canva; the app never sends it, curl tests and the kill switch do.
      dryRun: body.dryRun === true || !canvaEnabled,
      force: body.force === true,
      appUrl: String(cfg.TOOLS_APP_URL || '').replace(/\/+$/, ''),
      anthropicUrl: String(cfg.ANTHROPIC_URL || 'https://api.anthropic.com/v1/messages'),
      pexelsUrl: String(cfg.PEXELS_URL || 'https://api.pexels.com/v1/search'),
      canvaUrl: String(cfg.CANVA_URL || 'https://api.canva.com/rest/v1'),
      model: String(cfg.CLAUDE_MODEL || 'claude-opus-5'),
      effort: String(cfg.CLAUDE_EFFORT || 'medium'),
    },
  },
];
