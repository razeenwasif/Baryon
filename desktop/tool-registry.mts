import { responseText, type OpenAIResponsePayload, type ProviderSettings } from './core.mjs';
import { OUTCOMES, checkArguments, checkSchema, type ToolOutcome } from './tool-arguments.mjs';
import { isOutsideWriteTool, type GuardAndRunOptions, type GuardAndRunResult, type OutsideWriteContext } from './outside-writes.mjs';

export { OUTCOMES };
export type { ToolOutcome };

// One way to give a model tools. Each tool is defined once: its name, description and input schema, how risky it is,
// and what it does. A request builds a toolset from the tools it allows, and every provider then gets the same tools
// under the same rules: a limit on calls per request, a write that may be tried only once tried only once, a check a
// tool needs before it runs, and the same errors. A tool returns a plain result, and the toolset hands it to the CLI
// providers and to the OpenAI API in the form each expects.
//
// A result may carry pictures ({ url, caption }), such as a page of a PDF to look at; they go to each provider as
// pictures beside the text, never inside it. A tool may say what the person sees while it runs (progress) and what it
// found (detail), and a toolset may hold a request to a budget of characters read, as well as a number of calls.
export const RISKS = Object.freeze(['read', 'write'] as const);
const NAME = /^[a-z][a-z0-9_]{1,63}$/;

export type ToolRisk = (typeof RISKS)[number];
export type ArgumentCheckMode = 'enforce' | 'report';

export interface InvalidArgumentEvent {
  mode: ArgumentCheckMode;
  path: string;
  tool: string;
  problem: string;
}

export type InvalidArgumentReporter = (event: InvalidArgumentEvent) => void;

export interface ArgumentCheckConfig {
  mode: ArgumentCheckMode;
  onInvalid: InvalidArgumentReporter | null;
}

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required: readonly string[];
  additionalProperties: false;
}

export interface ToolPicture {
  url: string;
  caption?: string;
}

export interface ToolLabelObject {
  text: string;
  status?: string;
  done?: string;
}

export type ToolProgressLabel = string | ToolLabelObject | null | undefined;

export interface ToolScope extends OutsideWriteContext {
  signal?: AbortSignal;
  state: Record<string, unknown>;
  outsideWriteClientId?: string;
}

export interface DefineToolOptions {
  name: string;
  description: string;
  properties?: Record<string, unknown>;
  required?: readonly string[];
  risk?: ToolRisk;
  once?: string;
  guard?: ((args: Record<string, unknown>, scope: ToolScope) => string | Promise<string> | null | undefined | void) | null;
  run: (args: Record<string, unknown>, scope: ToolScope) => unknown;
  progress?: ((args: Record<string, unknown>, context: Record<string, unknown>) => ToolProgressLabel) | null;
  detail?: ((result: Record<string, unknown>) => string) | null;
  counts?: boolean;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolInputSchema;
  readonly risk: ToolRisk;
  readonly once: string;
  readonly guard: ((args: Record<string, unknown>, scope: ToolScope) => string | Promise<string> | null | undefined | void) | null;
  readonly run: (args: Record<string, unknown>, scope: ToolScope) => unknown;
  readonly progress: ((args: Record<string, unknown>, context: Record<string, unknown>) => ToolProgressLabel) | null;
  readonly detail: ((result: Record<string, unknown>) => string) | null;
  readonly counts: boolean;
}

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
}

export interface ChatFunctionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ToolInputSchema;
  };
}

export interface OpenAIResponsesFunctionTool {
  type: 'function';
  name: string;
  description: string;
  parameters: ToolInputSchema;
  strict: false;
}

export interface ToolStepEvent {
  id: number;
  text: string;
  status?: string;
  state: 'running' | 'done' | 'failed';
  detail?: string;
}

export interface ToolCallLogEntry {
  name: string;
  risk: ToolRisk | null;
  outcome: ToolOutcome;
  ms: number;
}

export interface OutsideWritesGuard {
  guardAndRun: (options: GuardAndRunOptions) => Promise<GuardAndRunResult>;
}

export interface ToolsetOptions {
  context?: Record<string, unknown>;
  signal?: AbortSignal;
  limit?: number;
  characters?: number;
  refuse?: boolean;
  limitMessage?: string;
  unknown?: string;
  invalid?: string;
  audit?: ((entry: { tool: string; result: unknown }) => void) | null;
  check?: () => void;
  onStep?: ((step: ToolStepEvent) => void) | null;
  argumentsMode?: ArgumentCheckMode | null;
  onInvalidArgument?: InvalidArgumentReporter | null;
  checkArgs?: boolean;
  outsideWrites?: OutsideWritesGuard | null;
  chat?: string;
  turn?: string;
  beforeIntent?: ((name: string, args: Record<string, unknown>) => unknown) | null;
}

export interface ToolCallResult {
  result: unknown;
  outcome: ToolOutcome;
  ms: number;
  output: string;
  pictures: ToolPicture[];
  whenRead: (() => void) | null;
}

export type ToolHandlerContentItem =
  | { type: 'inputText'; text: string }
  | { type: 'inputImage'; imageUrl: string };

export interface ToolHandlerResult {
  success: boolean;
  outcome: ToolOutcome;
  contentItems: ToolHandlerContentItem[];
  whenRead?: () => void;
}

export type ToolHandlerFn = (request: { tool: string; arguments: unknown }, options?: { hold?: boolean }) => Promise<ToolHandlerResult>;

export interface Toolset {
  tools: ToolSchema[];
  execute: (name: string, args: unknown) => Promise<unknown>;
  call: (name: string, args: unknown, options?: { hold?: boolean }) => Promise<ToolCallResult>;
  finish: () => void;
  used: () => { calls: number; characters: number };
  toolHandler: ToolHandlerFn;
  functions: OpenAIResponsesFunctionTool[];
  calls: () => ToolCallLogEntry[];
}

export interface ToolTurnProvider {
  turn?: (options: {
    settings: ProviderSettings;
    signal: AbortSignal;
    instructions: string;
    input: Array<{ type: 'text'; text: string; text_elements: unknown[] }>;
    tools: ToolSchema[];
    toolHandler: ToolHandlerFn;
  }) => Promise<unknown>;
  response?: (body: Record<string, unknown>, signal?: AbortSignal | null) => Promise<OpenAIResponsePayload>;
}

export interface RunToolTurnOptions {
  provider: ToolTurnProvider;
  settings: ProviderSettings;
  signal: AbortSignal;
  instructions: string;
  label: string;
  recent: readonly unknown[];
  set: Toolset;
  rounds?: number;
  maxOutputTokens?: number;
}

// Process-level fallback for argument validation mode ('enforce' by default, or 'report' for one installed build before
// enforcing). Per-toolset and per-WorkTools options always override this.
let argumentCheckConfig: ArgumentCheckConfig = { mode: 'enforce', onInvalid: null };
export function configureArgumentChecks({ mode = 'enforce', onInvalid = null }: { mode?: string; onInvalid?: InvalidArgumentReporter | null } = {}): void {
  argumentCheckConfig = { mode: mode === 'report' ? 'report' : 'enforce', onInvalid: typeof onInvalid === 'function' ? onInvalid : null };
}
export const getArgumentCheckConfig = (): ArgumentCheckConfig => ({ ...argumentCheckConfig });

export function defineTool({ name, description, properties = {}, required = [], risk = 'read', once = '', guard = null, run, progress = null, detail = null, counts = true }: DefineToolOptions): ToolDefinition {
  if (!NAME.test(name)) throw new Error(`A tool needs a lower-case name of letters, digits and underscores, not ${JSON.stringify(name)}.`);
  if (typeof description !== 'string' || !description.trim()) throw new Error(`${name} needs a description.`);
  if (!RISKS.includes(risk)) throw new Error(`${name} has an unknown risk, ${JSON.stringify(risk)}.`);
  if (once && risk !== 'write') throw new Error(`${name} reads, so it can't be limited to one attempt.`);
  if (typeof run !== 'function') throw new Error(`${name} needs a run function.`);
  if ((progress && typeof progress !== 'function') || (detail && typeof detail !== 'function')) throw new Error(`${name}'s progress and detail are functions.`);
  const inputSchema: ToolInputSchema = { type: 'object', properties, required, additionalProperties: false };
  checkSchema(inputSchema, name);
  return Object.freeze({ name, description, inputSchema, risk, once, guard, run, progress, detail, counts: Boolean(counts) });
}

// The part of a tool a model sees.
export const toolSchema = (tool: ToolDefinition): ToolSchema => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema });
// Chat Completions (DeepSeek) takes the same tools in its own shape.
export const chatFunction = (tool: ToolDefinition): ChatFunctionTool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } });
const labelOf = (value: ToolProgressLabel): ToolLabelObject | null => (!value ? null : typeof value === 'string' ? { text: value, status: '' } : value);

// The tools one request offers, with its context (connections, approve, signal) and limits. state is shared by the
// request's tools, for rules such as Gmail's that a draft answers a thread read in this request.
// audit, when given, hears how each write came out, for Fairy's approvals log.
// Calls to tools that count (all, unless a tool says otherwise) are held to limit, and their results to characters;
// past either, a call throws limitMessage, or with refuse: true comes back refused with it. finish() ends reading early.
// check, when given, runs before and after each call and stops the whole request if it throws (folders changed, say).
// onStep hears each call start and end, with the tool's progress words, for what the person sees.
export function toolset(definitions: readonly ToolDefinition[], { context = {}, signal, limit = 12, characters = Infinity, refuse = false, limitMessage = 'Tool limit reached. Narrow the request.', unknown = 'This tool is not enabled for this request.', invalid = 'Invalid arguments.', audit = null, check = () => {}, onStep = null, argumentsMode = null, onInvalidArgument = null, checkArgs = true, outsideWrites = null, chat = '', turn = '', beforeIntent = null }: ToolsetOptions = {}): Toolset {
  const tools = new Map<string, ToolDefinition>();
  for (const tool of definitions) { if (tools.has(tool.name)) throw new Error(`${tool.name} is offered twice.`); tools.set(tool.name, tool); }
  const state: Record<string, unknown> = {}, attempted = new Set<string>(), log: ToolCallLogEntry[] = [];
  let calls = 0, read = 0, finished = false, steps = 0;
  const finish = (entry: ToolCallLogEntry, started: number, outcome: ToolOutcome, result: unknown) => { entry.outcome = outcome; entry.ms = Date.now() - started; return { result, outcome, ms: entry.ms }; };
  async function run(name: string, args: unknown): Promise<{ result: unknown; outcome: ToolOutcome; ms: number }> {
    const started = Date.now();
    signal?.throwIfAborted(); check();
    const tool = tools.get(name);
    if (tool?.counts !== false) {
      if (finished || calls >= limit || read >= characters) {
        if (!refuse) throw new Error(limitMessage);
        const entry: ToolCallLogEntry = { name, risk: tool?.risk ?? null, outcome: 'refused', ms: 0 };
        log.push(entry);
        return finish(entry, started, 'refused', { error: limitMessage });
      }
      calls++;
    }
    const entry: ToolCallLogEntry = { name, risk: tool?.risk ?? null, outcome: 'failed', ms: 0 };
    log.push(entry);
    if (!tool) return finish(entry, started, 'refused', { error: unknown });
    if (!args || typeof args !== 'object' || Array.isArray(args)) return finish(entry, started, 'invalid', { error: invalid });
    const recordArgs = args as Record<string, unknown>;
    if (checkArgs) {
      const problem = checkArguments(tool.inputSchema, recordArgs);
      if (problem) {
        const fallback = getArgumentCheckConfig();
        const mode = argumentsMode ?? fallback.mode, report = onInvalidArgument ?? fallback.onInvalid;
        try { report?.({ mode, path: 'registry', tool: name, problem }); } catch {}
        if (mode !== 'report') return finish(entry, started, 'invalid', { error: problem });
      }
    }
    const scope: ToolScope = { ...context, signal, state };
    try {
      const refused = tool.guard ? await tool.guard(recordArgs, scope) : '';
      if (refused) return finish(entry, started, 'refused', { error: refused });
      if (tool.once && attempted.has(name)) return finish(entry, started, 'refused', { error: tool.once });
      let result: unknown;
      if (outsideWrites && isOutsideWriteTool(name)) {
        const guarded = await outsideWrites.guardAndRun({
          chat, turn, tool: name, args: recordArgs, context: scope, signal,
          beforeIntent: typeof beforeIntent === 'function' ? () => beforeIntent(name, recordArgs) : null,
          run: ({ clientId }) => {
            if (tool.once) attempted.add(name);
            return tool.run(recordArgs, clientId ? { ...scope, outsideWriteClientId: clientId } : scope);
          },
        });
        if (guarded.blocked) {
          return finish(entry, started, guarded.outcome, {
            error: guarded.error,
            outcome: guarded.outcome,
            ...('alreadyLanded' in guarded && guarded.alreadyLanded ? { alreadyLanded: true, outsideId: guarded.outsideId } : {}),
          });
        }
        result = guarded.result;
      } else {
        if (tool.once) attempted.add(name);
        result = await tool.run(recordArgs, scope);
      }
      check();
      if (tool.risk === 'write') audit?.({ tool: name, result });
      const resultObj = result && typeof result === 'object' ? (result as { outcome?: unknown; cancelled?: unknown; error?: unknown }) : null;
      const outcome: ToolOutcome = (OUTCOMES as readonly unknown[]).includes(resultObj?.outcome)
        ? (resultObj!.outcome as ToolOutcome)
        : resultObj?.cancelled === true
          ? 'refused'
          : (result && typeof result === 'object' && resultObj?.error)
            ? 'failed'
            : 'ok';
      return finish(entry, started, outcome, result);
    } catch (error) {
      entry.ms = Date.now() - started;
      signal?.throwIfAborted(); check();
      const errObj = error && typeof error === 'object' ? (error as { message?: unknown; outcome?: unknown }) : null;
      const errMessage = error instanceof Error ? error.message : (errObj && 'message' in errObj ? String(errObj.message) : String(error));
      if (tool.risk === 'write') audit?.({ tool: name, result: { error: errMessage } });
      const outcome: ToolOutcome = (OUTCOMES as readonly unknown[]).includes(errObj?.outcome)
        ? (errObj!.outcome as ToolOutcome)
        : 'failed';
      return finish(entry, started, outcome, { error: errMessage });
    }
  }
  // A call's result as text for the model, its pictures beside it, and the step the person sees. hold keeps the step
  // open until the provider has the pictures (whenRead).
  async function call(name: string, args: unknown, { hold = false }: { hold?: boolean } = {}): Promise<ToolCallResult> {
    const tool = tools.get(name), label = labelOf(tool?.progress?.(args && typeof args === 'object' ? (args as Record<string, unknown>) : {}, { ...context }));
    const id = ++steps;
    if (onStep && label) onStep({ id, text: label.text, status: label.status, state: 'running' });
    let ran: { result: unknown; outcome: ToolOutcome; ms: number };
    try { ran = await run(name, args); }
    catch (error) { if (onStep && label) onStep({ id, text: label.text, state: 'failed' }); throw error; }
    const { result, outcome, ms } = ran;
    const isObjectResult = Boolean(result && typeof result === 'object' && !Array.isArray(result));
    const { pictures = [], ...rest } = (isObjectResult ? result : { value: result }) as { pictures?: unknown } & Record<string, unknown>;
    const output = JSON.stringify(isObjectResult ? rest : result) ?? 'null';
    if (tool?.counts !== false) read += output.length;
    const done = (): void => { if (onStep && label) onStep({ id, text: label.done ?? label.text, state: outcome === 'ok' ? 'done' : 'failed', detail: outcome === 'ok' ? (tool?.detail?.(rest) || '') : '' }); };
    const held = Boolean(hold && (pictures as unknown[] | undefined)?.length);
    if (!held) done();
    return {
      result,
      outcome,
      ms,
      output,
      pictures: Array.isArray(pictures) ? (pictures as Array<ToolPicture | null | undefined>).filter((picture): picture is ToolPicture => Boolean(picture?.url)) : [],
      whenRead: held ? done : null,
    };
  }
  const execute = async (name: string, args: unknown): Promise<unknown> => (await call(name, args)).result;
  return {
    tools: definitions.map(toolSchema),
    execute, call,
    finish: () => { finished = true; },
    used: () => ({ calls, characters: read }),
    // Claude Code, Antigravity and Codex take a result as text in their dynamic-tool shape, pictures as inputImage.
    toolHandler: async (request, { hold = false } = {}) => {
      const { outcome, output, pictures, whenRead } = await call(request.tool, request.arguments, { hold });
      return { success: outcome === 'ok', outcome, contentItems: [{ type: 'inputText', text: output }, ...pictures.flatMap(picture => [...(picture.caption ? [{ type: 'inputText' as const, text: picture.caption }] : []), { type: 'inputImage' as const, imageUrl: picture.url }])], ...(whenRead ? { whenRead } : {}) };
    },
    // The OpenAI Responses API takes function tools.
    functions: definitions.map(tool => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.inputSchema, strict: false })),
    // What the request called, with each tool's risk, outcome and duration, for an audit later on.
    calls: () => log.map(entry => ({ ...entry })),
  };
}

// A request with tools, on whichever provider the settings choose: one turn for the CLI providers, which run their own
// loop through the tool bridge, or Fairy's own loop of up to `rounds` responses on the OpenAI API.
export async function runToolTurn({ provider, settings, signal, instructions, label, recent, set, rounds = 12, maxOutputTokens = 4096 }: RunToolTurnOptions): Promise<unknown> {
  if (settings.backend !== 'openai') {
    return provider.turn!({ settings, signal, instructions, input: [{ type: 'text', text: `${label} conversation:\n${JSON.stringify(recent)}`, text_elements: [] }], tools: set.tools, toolHandler: set.toolHandler });
  }
  const input: unknown[] = [...recent];
  for (let round = 0; round < rounds; round++) {
    signal.throwIfAborted();
    const response = await provider.response!({ model: settings.model, store: false, instructions, input, reasoning: { effort: settings.reasoning }, include: ['reasoning.encrypted_content'], max_output_tokens: maxOutputTokens, tools: set.functions }, signal);
    const calls = (response.output || []).filter(item => item.type === 'function_call');
    if (!calls.length) return responseText(response);
    input.push(...(response.output || []));
    const seen: Array<{ type: string; text?: string; image_url?: string; detail?: string }> = [];
    for (const call of calls) {
      let args: unknown; try { args = JSON.parse(call.arguments ?? ''); } catch { args = null; }
      const { output, pictures } = await set.call(call.name!, args);
      input.push({ type: 'function_call_output', call_id: call.call_id, output });
      for (const picture of pictures) seen.push(...(picture.caption ? [{ type: 'input_text', text: picture.caption }] : []), { type: 'input_image', image_url: picture.url, detail: 'original' });
    }
    // The Responses API takes pictures in a user message, not in a function's output.
    if (seen.length) input.push({ role: 'user', content: seen });
  }
  return undefined;
}
