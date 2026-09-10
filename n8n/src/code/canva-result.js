// Resultado Canva — runs once per poll. Reads an import job (from the create call or a
// status poll) into one of four states. It never throws: a Canva failure ends the job as
// "done without Canva", with the PowerPoint to download, per the business rules.
const MAX_POLLS = 36; // × 5 s ≈ 3 minutes
const r = $input.first().json || {};
const job = r.job || {};
const attempts = $runIndex + 1;

let state = job.status === 'success' ? 'success' : job.status === 'failed' ? 'failed' : 'pending';
// An error output item (the create call failed outright) carries `error` and no job.
if (!r.job && r.error) state = 'failed';
if (state === 'pending' && attempts >= MAX_POLLS) state = 'timeout';

const design = (job.result && Array.isArray(job.result.designs) && job.result.designs[0]) || {};
const urls = design.urls || {};

return [
  {
    json: {
      state,
      attempts,
      importJobId: job.id || '',
      designId: design.id || '',
      editUrl: urls.edit_url || '',
      viewUrl: urls.view_url || '',
      error:
        (job.error && (job.error.message || job.error.code)) ||
        (r.error && (r.error.message || r.error.code)) ||
        (state === 'timeout' ? 'Canva did not finish the import in time' : ''),
    },
  },
];
