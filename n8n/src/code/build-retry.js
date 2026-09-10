// Construir reintento — runs once. One more chance for the planner: the same request plus
// its own answer and the list of what was wrong. System prompt and brief are unchanged so
// both come back from the prompt cache.
const prev = $('Construir petición Claude').first().json.request;
const v = $('Validar manifest').first().json;

const messages = [
  ...prev.messages,
  { role: 'assistant', content: v.raw || '{}' },
  {
    role: 'user',
    content:
      'Your manifest failed validation. Fix ONLY the issues below and return the complete manifest again, following the same schema:\n- ' +
      v.errors.join('\n- '),
  },
];

return [{ json: { request: { ...prev, messages } } }];
