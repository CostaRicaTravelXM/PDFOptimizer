// Índice de activos — runs once. Today a stub: no approved library exists yet, so the
// planner is told there are no assets and the resolver never finds a match.
//
// When the Zoho WorkDrive indexer lands, this node reads
// `presentations/index/workdrive-assets.json` from the bucket (or calls the app for it) and
// returns the same shape, filtered to the job's destination and capped at 300 entries:
//   { assets: [{ id, filename, destination, entity_type, entities, tags, orientation, url }] }
// Nothing downstream changes.
const ctx = $('Contexto').first().json;
return [{ json: { assets: [], source: 'stub', destination: ctx.destination, generatedAt: new Date().toISOString() } }];
