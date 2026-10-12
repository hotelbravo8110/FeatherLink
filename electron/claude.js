'use strict';
/*
 * The story desk's Claude calls, through the Claude API with the user's own
 * key. Stands in for the claude.ai "sample" capability: json(prompt, opts)
 * resolves to the parsed JSON Claude returns, and failures carry the same
 * error codes the page already understands.
 */
const Anthropic = require('@anthropic-ai/sdk');

// The page asks for a tier; the tier sets how hard the model thinks.
const TIERS = {
  quick: { effort: 'low', maxTokens: 8000 },      // crew replies, ratings
  default: { effort: 'medium', maxTokens: 64000 }, // briefs, crew briefing
  complex: { effort: 'high', maxTokens: 64000 }    // "Best, slower" briefs
};
// Server-side refusal fallback is offered on these models only.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

const SYSTEM = 'You write in-world content for FEATHER NET, a flight simulator companion app that runs a fictional private-jet tour. ' +
  'Reply with exactly one JSON value in the shape the request describes. No prose, notes or code fences around it.';

const running = new Map();

function fail(code, message) { return Object.assign(new Error(message || code), { code }); }

// Claude is asked for bare JSON, but take it out of a fence or a sentence if one slips in.
function parseJson(text) {
  let t = String(text || '').trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch (e) { /* look inside */ }
  const starts = [t.indexOf('{'), t.indexOf('[')].filter(i => i >= 0);
  if (!starts.length) throw fail('invalid_json', 'no JSON in the reply');
  const a = Math.min(...starts);
  const b = t.lastIndexOf(t[a] === '{' ? '}' : ']');
  if (b <= a) throw fail('invalid_json', 'the reply was cut off');
  try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { throw fail('invalid_json', 'the reply was not clean JSON'); }
}

function mapError(e) {
  if (e && e.code && !(e instanceof Anthropic.APIError)) return e;
  if (e instanceof Anthropic.APIUserAbortError) return fail('cancelled', 'Stopped.');
  if (e instanceof Anthropic.AuthenticationError) return fail('session_expired', 'The Claude API key was rejected.');
  if (e instanceof Anthropic.PermissionDeniedError) return fail('sampling_disabled', e.message);
  if (e instanceof Anthropic.RateLimitError) return fail('rate_limited', e.message);
  if (e instanceof Anthropic.APIConnectionError) return fail('offline', 'Couldn’t reach the Claude API. Check the internet connection.');
  if (e instanceof Anthropic.APIError) {
    if (e.status === 413 || /prompt is too long/i.test(e.message || '')) return fail('prompt_too_large', e.message);
    if (e.status === 529 || e.status === 503) return fail('rate_limited', e.message);
    if (/credit balance/i.test(e.message || '')) return fail('no_credit', 'Your Claude API account is out of credit. Top it up at console.anthropic.com.');
    return fail('api_' + (e.status || 'error'), e.message);
  }
  return fail('error', (e && e.message) || String(e));
}

/**
 * @param {object} p  { id, prompt, tier, apiKey, model, onText(text) }
 */
async function json(p) {
  if (!p.apiKey) throw fail('not_granted', 'No Claude API key set.');
  const tier = TIERS[p.tier] || TIERS.default;
  const client = new Anthropic({ apiKey: p.apiKey });
  const ctl = new AbortController();
  running.set(p.id, ctl);
  try {
    const params = {
      model: p.model,
      max_tokens: tier.maxTokens,
      output_config: { effort: tier.effort },
      system: SYSTEM,
      messages: [{ role: 'user', content: String(p.prompt || '') }]
    };
    let stream;
    if (FALLBACK_MODELS.has(p.model)) {
      // On a policy decline the API re-runs the request on a suitable model instead of refusing.
      stream = client.beta.messages.stream(Object.assign(params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }), { signal: ctl.signal });
    } else {
      stream = client.messages.stream(params, { signal: ctl.signal });
    }
    let text = '', last = 0;
    stream.on('text', d => {
      text += d;
      const now = Date.now();
      if (p.onText && now - last > 200) { last = now; p.onText(text); }
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw fail('refused', (msg.stop_details && msg.stop_details.explanation) || 'Claude declined.');
    const out = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
    if (p.onText) p.onText(out);
    if (!out.trim()) throw fail('empty_completion', 'Claude returned nothing.');
    try { return parseJson(out); }
    catch (e) {
      if (msg.stop_reason === 'max_tokens') throw fail('invalid_json', 'The reply ran past the length limit and was cut off.');
      throw e;
    }
  } catch (e) {
    throw mapError(e);
  } finally {
    running.delete(p.id);
  }
}

function cancel(id) { const c = running.get(id); if (c) c.abort(); }

// A tiny request to check a key works.
async function test(apiKey, model) {
  try {
    const client = new Anthropic({ apiKey, maxRetries: 0 });
    await client.messages.create({ model, max_tokens: 16, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'Reply with OK.' }] });
    return { ok: true };
  } catch (e) {
    const m = mapError(e);
    return { ok: false, code: m.code, message: m.message };
  }
}

module.exports = { json, cancel, test, parseJson };
