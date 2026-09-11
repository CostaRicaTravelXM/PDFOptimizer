// Find job — runs once in the error-handler workflow. The Error Trigger only knows the
// execution; the job id is dug out of the failed execution's data so the app can be told.
const err = $('Error Trigger').first().json;
const exec = $input.first().json || {};
const runData = (((exec.data || {}).resultData || {}).runData) || {};

function firstJson(nodeName) {
  const runs = runData[nodeName];
  if (!Array.isArray(runs) || !runs[0]) return null;
  const main = ((runs[0].data || {}).main || [])[0] || [];
  return (main[0] || {}).json || null;
}

let jobId = '';
const ctx = firstJson('Context');
if (ctx && ctx.jobId) jobId = ctx.jobId;
if (!jobId) {
  const wh = firstJson('Webhook');
  if (wh && wh.body && wh.body.jobId) jobId = wh.body.jobId;
}

const message = (err.execution && err.execution.error && err.execution.error.message) || 'The workflow stopped unexpectedly.';
const node = (err.execution && err.execution.lastNodeExecuted) || 'unknown';

return [{ json: { found: /^\d{8}-\d{6}-[0-9a-f]{6}$/.test(jobId), jobId, node, message: String(message).slice(0, 500), executionId: (err.execution || {}).id || '' } }];
