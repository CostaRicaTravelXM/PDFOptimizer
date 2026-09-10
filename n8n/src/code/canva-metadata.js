// Metadatos Canva — runs once. Keeps the downloaded PPTX binary and adds the
// `Import-Metadata` header value Canva wants: base64 of a JSON object whose title is itself
// base64.
const ctx = $('Contexto').first().json;
const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
const importMeta = b64(
  JSON.stringify({
    title_base64: b64(ctx.title),
    mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }),
);
const item = $input.first();
return [{ json: { importMeta }, binary: item.binary }];
