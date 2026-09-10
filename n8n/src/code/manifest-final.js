// Manifest final — runs once. Whichever validation produced a usable manifest wins: the
// second attempt if it ran, otherwise the first. Later nodes read
// `$('Manifest final').first().json.manifest` and never care which path was taken.
let v = null;
try {
  v = $('Validar manifest (2)').first().json;
} catch (e) {
  v = null;
}
if (!v || !v.valid) v = $('Validar manifest').first().json;
if (!v.valid) throw new Error('No valid manifest: ' + v.errors.join('; '));

const usage = v.usage || {};
return [
  {
    json: {
      manifest: v.manifest,
      warnings: v.warnings || [],
      meta: {
        model: v.model || $('Contexto').first().json.model,
        usage,
        cacheRead: usage.cache_read_input_tokens || 0,
        attempts: v.attempt,
      },
    },
  },
];
