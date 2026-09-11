// Resultado Canva — runs once. Reads what the Canva node returned, or the error item it
// produced when the import failed or timed out, into one shape.
//
// It never throws. A Canva failure is not a failed job: the deck is already built and in the
// bucket, so the job ends as "done" with a warning and the PowerPoint to download, which is
// what the business rules ask for.
const r = $input.first().json || {};
const job = r.job || {};
const design = (job.result && Array.isArray(job.result.designs) && job.result.designs[0]) || {};
const urls = design.urls || {};
const ok = job.status === 'success' && !!design.id;

// n8n puts a string here for some failures and an object for others.
const text = (e) => (!e ? '' : typeof e === 'string' ? e : e.message || e.description || e.code || '');

return [
  {
    json: {
      ok,
      designId: design.id || '',
      editUrl: urls.edit_url || '',
      viewUrl: urls.view_url || '',
      error: ok ? '' : text(r.error) || text(job.error) || 'Canva did not return a design',
    },
  },
];
