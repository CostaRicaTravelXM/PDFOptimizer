// Can it run? — runs once. A job that is already running or finished is not run
// again unless the caller says `force`; re-posting a webhook must be harmless.
const job = $input.first().json;
const ctx = $('Context').first().json;
const run = ['queued', 'failed'].includes(job.status) || ctx.force === true;
return [{ json: { run, status: job.status } }];
