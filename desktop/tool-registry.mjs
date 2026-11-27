import { responseText } from './core.mjs';
import { OUTCOMES, checkArguments, checkSchema } from './tool-arguments.mjs';
import { isOutsideWriteTool } from './outside-writes.mjs';

export { OUTCOMES };

// One way to give a model tools. Each tool is defined once: its name, description and input schema, how risky it is,
// and what it does. A request builds a toolset from the tools it allows, and every provider then gets the same tools
// under the same rules: a limit on calls per request, a write that may be tried only once tried only once, a check a
// tool needs before it runs, and the same errors. A tool returns a plain result, and the toolset hands it to the CLI
// providers and to the OpenAI API in the form each expects.
//
// A result may carry pictures ({ url, caption }), such as a page of a PDF to look at; they go to each provider as
// pictures beside the text, never inside it. A tool may say what the person sees while it runs (progress) and what it
// found (detail), and a toolset may hold a request to a budget of characters read, as well as a number of calls.
export const RISKS = Object.freeze(['read', 'write']);
const NAME = /^[a-z][a-z0-9_]{1,63}$/;

// Process-level fallback for argument validation mode ('enforce' by default, or 'report' for one installed build before
// enforcing). Per-toolset and per-WorkTools options always override this.
let argumentCheckConfig = { mode: 'enforce', onInvalid: null };
export function configureArgumentChecks({ mode = 'enforce', onInvalid = null } = {}) {
  argumentCheckConfig = { mode: mode === 'report' ? 'report' : 'enforce', onInvalid: typeof onInvalid === 'function' ? onInvalid : null };
}
export const getArgumentCheckConfig = () => ({ ...argumentCheckConfig });

export function defineTool({ name, description, properties = {}, required = [], risk = 'read', once = '', guard = null, run, progress = null, detail = null, counts = true }) {
  if (!NAME.test(name)) throw new Error(`A tool needs a lower-case name of letters, digits and underscores, not ${JSON.stringify(name)}.`);
  if (typeof description !== 'string' || !description.trim()) throw new Error(`${name} needs a description.`);
  if (!RISKS.includes(risk)) throw new Error(`${name} has an unknown risk, ${JSON.stringify(risk)}.`);
  if (once && risk !== 'write') throw new Error(`${name} reads, so it can't be limited to one attempt.`);
  if (typeof run !== 'function') throw new Error(`${name} needs a run function.`);
  if ((progress && typeof progress !== 'function') || (detail && typeof detail !== 'function')) throw new Error(`${name}'s progress and detail are functions.`);
  const inputSchema = { type: 'object', properties, required, additionalProperties: false };
  checkSchema(inputSchema, name);
  return Object.freeze({ name, description, inputSchema, risk, once, guard, run, progress, detail, counts: Boolean(counts) });
}

// The part of a tool a model sees.
export const toolSchema = tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema });
// Chat Completions (DeepSeek) takes the same tools in its own shape.
export const chatFunction = tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } });
const labelOf = value => (!value ? null : typeof value === 'string' ? { text: value, status: '' } : value);

// The tools one request offers, with its context (connections, approve, signal) and limits. state is shared by the
// request's tools, for rules such as Gmail's that a draft answers a thread read in this request.
// audit, when given, hears how each write came out, for Fairy's approvals log.
// Calls to tools that count (all, unless a tool says otherwise) are held to limit, and their results to characters;
// past either, a call throws limitMessage, or with refuse: true comes back refused with it. finish() ends reading early.
// check, when given, runs before and after each call and stops the whole request if it throws (folders changed, say).
// onStep hears each call start and end, with the tool's progress words, for what the person sees.
export function toolset(definitions, { context = {}, signal, limit = 12, characters = Infinity, refuse = false, limitMessage = 'Tool limit reached. Narrow the request.', unknown = 'This tool is not enabled for this request.', invalid = 'Invalid arguments.', audit = null, check = () => {}, onStep = null, argumentsMode = null, onInvalidArgument = null, checkArgs = true, outsideWrites = null, chat = '', turn = '', beforeIntent = null } = {}) {
  const tools = new Map();
  for (const tool of definitions) { if (tools.has(tool.name)) throw new Error(`${tool.name} is offered twice.`); tools.set(tool.name, tool); }
  const state = {}, attempted = new Set(), log = [];
  let calls = 0, read = 0, finished = false, steps = 0;
  const finish = (entry, started, outcome, result) => { entry.outcome = outcome; entry.ms = Date.now() - started; return { result, outcome, ms: entry.ms }; };
  async function run(name, args) {
    const started = Date.now();
    signal?.throwIfAborted(); check();
    const tool = tools.get(name);
    if (tool?.counts !== false) {
      if (finished || calls >= limit || read >= characters) {
        if (!refuse) throw new Error(limitMessage);
        const entry = { name, risk: tool?.risk ?? null, outcome: 'refused', ms: 0 };
        log.push(entry);
        return finish(entry, started, 'refused', { error: limitMessage });
      }
      calls++;
    }
    const entry = { name, risk: tool?.risk ?? null, outcome: 'failed', ms: 0 };
    log.push(entry);
    if (!tool) return finish(entry, started, 'refused', { error: unknown });
    if (!args || typeof args !== 'object' || Array.isArray(args)) return finish(entry, started, 'invalid', { error: invalid });
    if (checkArgs) {
      const problem = checkArguments(tool.inputSchema, args);
      if (problem) {
        const fallback = getArgumentCheckConfig();
        const mode = argumentsMode ?? fallback.mode, report = onInvalidArgument ?? fallback.onInvalid;
        try { report?.({ mode, path: 'registry', tool: name, problem }); } catch {}
        if (mode !== 'report') return finish(entry, started, 'invalid', { error: problem });
      }
    }
    const scope = { ...context, signal, state };
    try {
      const refused = tool.guard ? await tool.guard(args, scope) : '';
      if (refused) return finish(entry, started, 'refused', { error: refused });
      if (tool.once && attempted.has(name)) return finish(entry, started, 'refused', { error: tool.once });
      let result;
      if (outsideWrites && isOutsideWriteTool(name)) {
        const guarded = await outsideWrites.guardAndRun({
          chat, turn, tool: name, args, context: scope, signal,
          beforeIntent: typeof beforeIntent === 'function' ? () => beforeIntent(name, args) : null,
          run: ({ clientId }) => {
            if (tool.once) attempted.add(name);
            return tool.run(args, clientId ? { ...scope, outsideWriteClientId: clientId } : scope);
          },
        });
        if (guarded.blocked) {
          return finish(entry, started, guarded.outcome, {
            error: guarded.error,
            outcome: guarded.outcome,
            ...(guarded.alreadyLanded ? { alreadyLanded: true, outsideId: guarded.outsideId } : {}),
          });
        }
        result = guarded.result;
      } else {
        if (tool.once) attempted.add(name);
        result = await tool.run(args, scope);
      }
      check();
      if (tool.risk === 'write') audit?.({ tool: name, result });
      const outcome = OUTCOMES.includes(result?.outcome) ? result.outcome : result?.cancelled === true ? 'refused' : (result && typeof result === 'object' && result.error) ? 'failed' : 'ok';
      return finish(entry, started, outcome, result);
    } catch (error) {
      entry.ms = Date.now() - started;
      signal?.throwIfAborted(); check();
      if (tool.risk === 'write') audit?.({ tool: name, result: { error: error.message } });
      const outcome = OUTCOMES.includes(error?.outcome) ? error.outcome : 'failed';
      return finish(entry, started, outcome, { error: error.message });
    }
  }
  // A call's result as text for the model, its pictures beside it, and the step the person sees. hold keeps the step
  // open until the provider has the pictures (whenRead).
  async function call(name, args, { hold = false } = {}) {
    const tool = tools.get(name), label = labelOf(tool?.progress?.(args && typeof args === 'object' ? args : {}, { ...context }));
    const id = ++steps;
    if (onStep && label) onStep({ id, text: label.text, status: label.status, state: 'running' });
    let ran;
    try { ran = await run(name, args); }
    catch (error) { if (onStep && label) onStep({ id, text: label.text, state: 'failed' }); throw error; }
    const { result, outcome, ms } = ran;
    const { pictures = [], ...rest } = result && typeof result === 'object' && !Array.isArray(result) ? result : { value: result };
    const output = JSON.stringify(result && typeof result === 'object' && !Array.isArray(result) ? rest : result) ?? 'null';
    if (tool?.counts !== false) read += output.length;
    const done = () => onStep && label && onStep({ id, text: label.done ?? label.text, state: outcome === 'ok' ? 'done' : 'failed', detail: outcome === 'ok' ? (tool?.detail?.(rest) || '') : '' });
    const held = hold && pictures.length;
    if (!held) done();
    return { result, outcome, ms, output, pictures: Array.isArray(pictures) ? pictures.filter(picture => picture?.url) : [], whenRead: held ? done : null };
  }
  const execute = async (name, args) => (await call(name, args)).result;
  return {
    tools: definitions.map(toolSchema),
    execute, call,
    finish: () => { finished = true; },
    used: () => ({ calls, characters: read }),
    // Claude Code, Antigravity and Codex take a result as text in their dynamic-tool shape, pictures as inputImage.
    toolHandler: async (request, { hold = false } = {}) => {
      const { outcome, output, pictures, whenRead } = await call(request.tool, request.arguments, { hold });
      return { success: outcome === 'ok', outcome, contentItems: [{ type: 'inputText', text: output }, ...pictures.flatMap(picture => [...(picture.caption ? [{ type: 'inputText', text: picture.caption }] : []), { type: 'inputImage', imageUrl: picture.url }])], ...(whenRead ? { whenRead } : {}) };
    },
    // The OpenAI Responses API takes function tools.
    functions: definitions.map(tool => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.inputSchema, strict: false })),
    // What the request called, with each tool's risk, outcome and duration, for an audit later on.
    calls: () => log.map(entry => ({ ...entry })),
  };
}

// A request with tools, on whichever provider the settings choose: one turn for the CLI providers, which run their own
// loop through the tool bridge, or Fairy's own loop of up to `rounds` responses on the OpenAI API.
export async function runToolTurn({ provider, settings, signal, instructions, label, recent, set, rounds = 12, maxOutputTokens = 4096 }) {
  if (settings.backend !== 'openai') {
    return provider.turn({ settings, signal, instructions, input: [{ type: 'text', text: `${label} conversation:\n${JSON.stringify(recent)}`, text_elements: [] }], tools: set.tools, toolHandler: set.toolHandler });
  }
  const input = [...recent];
  for (let round = 0; round < rounds; round++) {
    signal.throwIfAborted();
    const response = await provider.response({ model: settings.model, store: false, instructions, input, reasoning: { effort: settings.reasoning }, include: ['reasoning.encrypted_content'], max_output_tokens: maxOutputTokens, tools: set.functions }, signal);
    const calls = (response.output || []).filter(item => item.type === 'function_call');
    if (!calls.length) return responseText(response);
    input.push(...response.output);
    const seen = [];
    for (const call of calls) {
      let args; try { args = JSON.parse(call.arguments); } catch { args = null; }
      const { output, pictures } = await set.call(call.name, args);
      input.push({ type: 'function_call_output', call_id: call.call_id, output });
      for (const picture of pictures) seen.push(...(picture.caption ? [{ type: 'input_text', text: picture.caption }] : []), { type: 'input_image', image_url: picture.url, detail: 'original' });
    }
    // The Responses API takes pictures in a user message, not in a function's output.
    if (seen.length) input.push({ role: 'user', content: seen });
  }
  return undefined;
}
