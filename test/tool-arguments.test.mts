import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { OUTCOMES, checkArguments, checkSchema } from '../desktop/tool-arguments.mjs';
import { configureArgumentChecks, defineTool, runToolTurn, toolset } from '../desktop/tool-registry.mjs';
import { EVAL_TOOLS, GOAL_OFFER_TOOLS, GOAL_TOOLS, RUN_TOOLS, WORK_DEFINITIONS, WorkTools } from '../desktop/work-tools.mjs';
import { toolBridge } from '../desktop/claude.mjs';
import { CodexConnection } from '../desktop/codex.mjs';
import { AntigravityConnection } from '../desktop/antigravity.mjs';
import { DEFAULTS } from '../desktop/core.mjs';

const ASTRA_SCHEMA = {
  type: 'object',
  properties: { count: { type: 'integer', minimum: 1 } },
  required: ['count'],
  additionalProperties: false,
};

// Minimal valid value for any schema node, so the sweep test can isolate one broken field at a time.
function validFor(schema: any): any {
  if (!schema || typeof schema !== 'object') return 'x';
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === 'string') return 'x'.repeat(Math.max(1, schema.minLength || 1));
  if (type === 'integer') return Math.max(1, schema.minimum ?? 1);
  if (type === 'number') return Math.max(1, schema.minimum ?? 1);
  if (type === 'boolean') return true;
  if (type === 'null') return null;
  if (type === 'array') return [validFor(schema.items)];
  if (type === 'object' || schema.properties) {
    const out: Record<string, any> = {};
    for (const key of schema.required || []) out[key] = validFor(schema.properties?.[key]);
    return out;
  }
  return 'x';
}

function wrongTypeFor(schema: any): any {
  const type = Array.isArray(schema?.type) ? schema.type[0] : schema?.type;
  if (type === 'string') return 12345;
  if (type === 'number') return 'not-a-number';
  if (type === 'integer') return 1.5;
  if (type === 'boolean') return 'true';
  if (type === 'array') return 'not-a-list';
  if (type === 'object') return ['not-an-object'];
  if (type === 'null') return 'not-null';
  return undefined;
}

test('checkArguments covers every supported JSON Schema keyword both ways and ignores unknown keywords', () => {
  assert.deepEqual(OUTCOMES, ['ok', 'invalid', 'refused', 'failed', 'unknown']);

  // type
  assert.equal(checkArguments({ type: 'string' }, 'ok', 's'), '');
  assert.match(checkArguments({ type: 'string' }, 42, 's'), /s must be a string/);
  assert.equal(checkArguments({ type: 'number' }, 3.5, 'n'), '');
  assert.match(checkArguments({ type: 'number' }, '3.5', 'n'), /n must be a number/);
  assert.match(checkArguments({ type: 'number' }, Number.NaN, 'n'), /n must be a number/);
  assert.match(checkArguments({ type: 'number' }, Number.POSITIVE_INFINITY, 'n'), /n must be a number/);
  assert.equal(checkArguments({ type: 'integer' }, 3, 'i'), '');
  assert.match(checkArguments({ type: 'integer' }, 3.5, 'i'), /i must be a whole number/);
  assert.equal(checkArguments({ type: 'boolean' }, false, 'b'), '');
  assert.match(checkArguments({ type: 'boolean' }, 'false', 'b'), /b must be true or false/);
  assert.equal(checkArguments({ type: 'array' }, [], 'a'), '');
  assert.match(checkArguments({ type: 'array' }, {}, 'a'), /a must be a list/);
  assert.equal(checkArguments({ type: 'object' }, {}, 'o'), '');
  assert.match(checkArguments({ type: 'object' }, [], 'o'), /o must be an object/);
  assert.match(checkArguments({ type: 'object' }, null), /Arguments must be an object/);
  assert.equal(checkArguments({ type: 'null' }, null, 'z'), '');
  assert.match(checkArguments({ type: 'null' }, '', 'z'), /z must be null/);
  assert.equal(checkArguments({ type: ['string', 'null'] }, null, 'm'), '');
  assert.equal(checkArguments({ type: ['string', 'null'] }, 'hi', 'm'), '');
  assert.match(checkArguments({ type: ['string', 'null'] }, 9, 'm'), /m must be a string or null/);

  // required, properties, additionalProperties: false
  const obj = { type: 'object', properties: { name: { type: 'string' }, nested: { type: 'object', properties: { flag: { type: 'boolean' } }, required: ['flag'], additionalProperties: false } }, required: ['name'], additionalProperties: false };
  assert.equal(checkArguments(obj, { name: 'ada', nested: { flag: true } }), '');
  assert.match(checkArguments(obj, {}), /name is required/);
  assert.match(checkArguments(obj, { name: 'ada', extra: 1 }), /Unknown argument extra/);
  assert.match(checkArguments(obj, { name: 'ada', nested: {} }), /nested\.flag is required/);
  assert.match(checkArguments(obj, { name: 'ada', nested: { flag: true, bogus: 1 } }), /Unknown argument nested\.bogus/);

  // enum
  const choice = { type: 'string', enum: ['low', 'medium', 'high'] };
  assert.equal(checkArguments(choice, 'medium', 'effort'), '');
  const enumErr = checkArguments(choice, 'SECRET_VALUE_999', 'effort');
  assert.match(enumErr, /effort must be one of: low, medium, high/);
  assert.ok(!enumErr.includes('SECRET_VALUE_999'), 'never echoes argument values');

  // minimum & maximum
  assert.equal(checkArguments({ type: 'integer', minimum: 1, maximum: 5 }, 1, 'count'), '');
  assert.equal(checkArguments({ type: 'integer', minimum: 1, maximum: 5 }, 5, 'count'), '');
  assert.match(checkArguments({ type: 'integer', minimum: 1 }, 0, 'count'), /count must be a whole number of at least 1/);
  assert.match(checkArguments({ type: 'integer', minimum: 1, maximum: 5 }, 6, 'count'), /count must be a whole number of at most 5/);
  assert.match(checkArguments({ type: 'number', minimum: 0 }, -0.1, 'rate'), /rate must be at least 0/);
  assert.match(checkArguments({ type: 'number', maximum: 1 }, 1.2, 'rate'), /rate must be at most 1/);

  // minLength & maxLength
  assert.equal(checkArguments({ type: 'string', minLength: 2, maxLength: 4 }, 'abc', 'code'), '');
  assert.match(checkArguments({ type: 'string', minLength: 2 }, 'a', 'code'), /code must be at least 2 characters/);
  const longErr = checkArguments({ type: 'string', maxLength: 4 }, 'PRIVATE_SECRET', 'code');
  assert.match(longErr, /code must be at most 4 characters/);
  assert.ok(!longErr.includes('PRIVATE_SECRET'), 'never echoes argument values');

  // items
  const list = { type: 'array', items: { type: 'integer', minimum: 0 } };
  assert.equal(checkArguments(list, [0, 2, 4], 'pages'), '');
  assert.match(checkArguments(list, [0, -1], 'pages'), /pages\[1\] must be a whole number of at least 0/);

  // unknown schema keywords are ignored, never a reason to refuse
  const connectorSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    title: 'Remote search',
    properties: { query: { type: 'string', format: 'uri', pattern: '^impossible$', examples: ['a'] } },
    required: ['query'],
    minProperties: 5,
    'x-vendor': { strict: true },
  };
  assert.equal(checkArguments(connectorSchema, { query: 'hello', extraAllowedByConnector: true }), '');
});

test('Astra’s three probes never reach guard or run on either toolset or WorkTools', async t => {
  // 1. Registry path (toolset)
  let ran = 0, guarded = 0;
  const probeTool = defineTool({
    name: 'probe_count',
    description: 'Counts items.',
    properties: { count: { type: 'integer', minimum: 1 } },
    required: ['count'],
    guard: () => { guarded += 1; return ''; },
    run: (args: any) => { ran += 1; return { count: args.count }; },
  });
  const set = toolset([probeTool]);
  for (const bad of [{}, { count: 'wrong' }, { count: 0, extra: true }]) {
    const handled = await set.toolHandler({ tool: 'probe_count', arguments: bad as any });
    assert.equal(handled.success, false, JSON.stringify(bad));
    assert.equal(handled.outcome, 'invalid', JSON.stringify(bad));
    assert.ok(JSON.parse((handled.contentItems[0] as { text: string }).text).error, JSON.stringify(bad));
  }
  assert.equal(guarded, 0, 'invalid arguments are stopped before guard');
  assert.equal(ran, 0, 'invalid arguments never reach run');
  const good = await set.toolHandler({ tool: 'probe_count', arguments: { count: 2 } });
  assert.equal(good.success, true);
  assert.equal(good.outcome, 'ok');
  assert.equal(ran, 1);

  // 2. WorkTools path: core work tool, grouped tool (before approval), and connector tool (with Astra's exact schema)
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fairy-probe-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  let approved = 0, connectorCalled = 0, nexusRan = 0;
  const connectors = new Map([['c_demo__probe', {
    connector: 'demo',
    remote: 'probe',
    description: 'Demo connector probe.',
    inputSchema: ASTRA_SCHEMA,
    call: async () => { connectorCalled += 1; return { failed: false, text: 'ok' }; },
  }]]);
  const tools = new WorkTools({
    root,
    permission: 'ask',
    connectors,
    nexus: { run: async () => { nexusRan += 1; return { job: 'j-1' }; }, logs: async () => ({}), outputs: async () => ({}) } as any,
    runCommand: (async () => ({ exitCode: 0, output: '' })) as any,
    approve: async () => { approved += 1; return 'allow'; },
  });
  // Connector with Astra's three probes
  for (const bad of [{}, { count: 'wrong' }, { count: 0, extra: true }]) {
    const res = await tools.handle({ tool: 'c_demo__probe', arguments: bad as any });
    assert.equal(res.success, false, JSON.stringify(bad));
    assert.equal(res.outcome, 'invalid', JSON.stringify(bad));
  }
  assert.equal(approved, 0, 'connector invalid args stopped before approval');
  assert.equal(connectorCalled, 0, 'connector invalid args never reached server');
  // Core work tool probes: missing required, wrong type, extra field
  for (const bad of [{}, { path: 123 }, { path: 'a.txt', extra: true }]) {
    const res = await tools.handle({ tool: 'read_file', arguments: bad as any });
    assert.equal(res.success, false, JSON.stringify(bad));
    assert.equal(res.outcome, 'invalid', JSON.stringify(bad));
  }
  // Grouped tool probes: missing required, wrong type, extra field — stopped BEFORE nexus approval
  for (const bad of [{}, { command: 42 }, { command: 'echo hi', extra: true }]) {
    const res = await tools.handle({ tool: 'nexus_run', arguments: bad as any });
    assert.equal(res.success, false, JSON.stringify(bad));
    assert.equal(res.outcome, 'invalid', JSON.stringify(bad));
  }
  assert.equal(approved, 0, 'grouped invalid args stopped before mayProceed approval');
  assert.equal(nexusRan, 0, 'grouped invalid args never reached tool');
  assert.equal(tools.activity.length, 0, 'invalid calls leave no stray activity rows');
});

test('all five outcomes (ok, invalid, refused, failed, unknown) and durations are recorded on calls() and toolHandler', async () => {
  const okTool = defineTool({ name: 't_ok', description: 'Succeeds.', properties: { n: { type: 'integer' } }, run: ({ n }: any) => ({ n }) });
  const guardedTool = defineTool({ name: 't_guard', description: 'Guarded.', guard: () => 'Not allowed.', run: () => ({ ok: true }) });
  const cancelTool = defineTool({ name: 't_cancel', description: 'Cancelled write.', risk: 'write', run: () => ({ created: false, cancelled: true }) });
  const failTool = defineTool({ name: 't_fail', description: 'Fails.', run: () => { throw new Error('Boom.'); } });
  const unknownTool = defineTool({ name: 't_unknown', description: 'Uncertain write.', risk: 'write', run: () => { throw Object.assign(new Error('May already have happened.'), { outcome: 'unknown' }); } });

  const set = toolset([okTool, guardedTool, cancelTool, failTool, unknownTool]);
  const rOk = await set.toolHandler({ tool: 't_ok', arguments: { n: 1 } });
  const rInvalid = await set.toolHandler({ tool: 't_ok', arguments: { n: 'nope' } as any });
  const rGuard = await set.toolHandler({ tool: 't_guard', arguments: {} });
  const rCancel = await set.toolHandler({ tool: 't_cancel', arguments: {} });
  const rMissing = await set.toolHandler({ tool: 'not_there', arguments: {} });
  const rFail = await set.toolHandler({ tool: 't_fail', arguments: {} });
  const rUnknown = await set.toolHandler({ tool: 't_unknown', arguments: {} });

  assert.equal(rOk.success, true); assert.equal(rOk.outcome, 'ok');
  assert.equal(rInvalid.success, false); assert.equal(rInvalid.outcome, 'invalid');
  assert.equal(rGuard.success, false); assert.equal(rGuard.outcome, 'refused');
  assert.equal(rCancel.success, false); assert.equal(rCancel.outcome, 'refused');
  assert.equal(rMissing.success, false); assert.equal(rMissing.outcome, 'refused');
  assert.equal(rFail.success, false); assert.equal(rFail.outcome, 'failed');
  assert.equal(rUnknown.success, false); assert.equal(rUnknown.outcome, 'unknown');
  // The JSON text the model reads keeps the exact same shape.
  assert.equal((rFail.contentItems[0] as { text: string }).text, '{"error":"Boom."}');
  assert.equal((rCancel.contentItems[0] as { text: string }).text, '{"created":false,"cancelled":true}');

  const logged = set.calls();
  assert.deepEqual(logged.map(entry => [entry.name, entry.risk, entry.outcome]), [
    ['t_ok', 'read', 'ok'],
    ['t_ok', 'read', 'invalid'],
    ['t_guard', 'read', 'refused'],
    ['t_cancel', 'write', 'refused'],
    ['not_there', null, 'refused'],
    ['t_fail', 'read', 'failed'],
    ['t_unknown', 'write', 'unknown'],
  ]);
  for (const entry of logged) assert.ok(typeof entry.ms === 'number' && entry.ms >= 0);
});

test('every provider bridge receives the same text and error signal for ok, invalid, refused and failed calls', async t => {
  const tool = defineTool({
    name: 'echo_num',
    description: 'Echoes a positive whole number.',
    properties: { count: { type: 'integer', minimum: 1 } },
    required: ['count'],
    guard: (args: any) => args.count === 99 ? 'Blocked by guard.' : '',
    run: (args: any) => { if (args.count === 13) throw new Error('Unlucky.'); return { count: args.count }; },
  });
  const set = toolset([tool]);

  // 1. Claude Code & Antigravity shared MCP bridge (toolBridge)
  const bridge = await toolBridge(set.tools, set.toolHandler);
  t.after(() => bridge.close());
  const rpc = async (name: string, args: Record<string, unknown>) => (await (await fetch(bridge.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bridge.token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })).json() as any).result;

  const claudeOk = await rpc('echo_num', { count: 2 });
  const claudeInvalid = await rpc('echo_num', { count: 0 });
  const claudeRefused = await rpc('echo_num', { count: 99 });
  const claudeFailed = await rpc('echo_num', { count: 13 });
  assert.equal(claudeOk.isError, false); assert.equal(claudeOk.content[0].text, '{"count":2}');
  assert.equal(claudeInvalid.isError, true); assert.match(claudeInvalid.content[0].text, /count must be a whole number of at least 1/);
  assert.equal(claudeRefused.isError, true); assert.equal(claudeRefused.content[0].text, '{"error":"Blocked by guard."}');
  assert.equal(claudeFailed.isError, true); assert.equal(claudeFailed.content[0].text, '{"error":"Unlucky."}');

  // 2. AntigravityConnection.toolTurn uses toolBridge and preserves success/isError through readPictures & firstPart
  const agyDir = await mkdtemp(join(tmpdir(), 'fairy-agy-bridge-'));
  t.after(() => rm(agyDir, { recursive: true, force: true }));
  const realHome = join(agyDir, 'home');
  await (await import('node:fs/promises')).mkdir(join(realHome, '.gemini', 'config'), { recursive: true });
  let agyBridgeResults: any;
  const agy = new AntigravityConnection({
    cwd: agyDir,
    executable: '/fake/agy',
    realHome,
    warmAfterTurn: false,
    spawnProcess: ((_bin: string, _args: string[], options: any) => {
      const child: any = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.kill = () => child.emit('close', 0);
      child.stdin = new Writable({ write(_chunk, _enc, done) {
        done();
        queueMicrotask(async () => {
          const mcp = JSON.parse(await readFile(join(options.env.HOME, '.gemini', 'config', 'mcp_config.json'), 'utf8')).mcpServers.fairy;
          const callAgy = async (args: Record<string, unknown>) => (await (await fetch(mcp.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...mcp.headers },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo_num', arguments: args } }),
          })).json() as any).result;
          agyBridgeResults = { ok: await callAgy({ count: 2 }), invalid: await callAgy({ count: 0 }), failed: await callAgy({ count: 13 }) };
          child.stdout.write(`${JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Done.' } })}\n`);
          child.emit('close', 0);
        });
      } });
      return child;
    }) as any,
  });
  await agy.turn({ settings: { ...DEFAULTS, antigravityModel: 'gemini-3.8-flash-low' }, instructions: 'Test.', input: [{ type: 'text', text: 'Run.' }], tools: set.tools, toolHandler: set.toolHandler });
  assert.equal(agyBridgeResults.ok.isError, false); assert.equal(agyBridgeResults.ok.content[0].text, '{"count":2}');
  assert.equal(agyBridgeResults.invalid.isError, true); assert.match(agyBridgeResults.invalid.content[0].text, /count must be a whole number of at least 1/);
  assert.equal(agyBridgeResults.failed.isError, true); assert.equal(agyBridgeResults.failed.content[0].text, '{"error":"Unlucky."}');

  // 3. Codex app-server bridge sends { success, contentItems } without leaking internal fields
  const written: any[] = [];
  const child: any = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { child.stdout.end(); child.emit('close', 0); };
  child.stdin = new Writable({ write(chunk, _enc, done) {
    const msg = JSON.parse(chunk.toString()); written.push(msg); done();
    if (!msg.method || msg.id === undefined) return;
    const res = msg.method === 'config/read' ? { config: {} } : msg.method === 'account/read' ? { account: { type: 'chatgpt', planType: 'pro' } } : msg.method === 'thread/start' ? { thread: { id: 'th-1' } } : msg.method === 'turn/start' ? { turn: { id: 'tu-1' } } : {};
    queueMicrotask(() => {
      child.stdout.write(`${JSON.stringify({ id: msg.id, result: res })}\n`);
      if (msg.method === 'turn/start') {
        child.stdout.write(`${JSON.stringify({ id: 501, method: 'item/tool/call', params: { threadId: 'th-1', tool: 'echo_num', arguments: { count: 2 } } })}\n`);
        child.stdout.write(`${JSON.stringify({ id: 502, method: 'item/tool/call', params: { threadId: 'th-1', tool: 'echo_num', arguments: { count: 0 } } })}\n`);
        setTimeout(() => {
          child.stdout.write(`${JSON.stringify({ method: 'item/completed', params: { threadId: 'th-1', item: { type: 'agentMessage', text: 'All set.' } } })}\n`);
          child.stdout.write(`${JSON.stringify({ method: 'turn/completed', params: { threadId: 'th-1', turn: { status: 'completed' } } })}\n`);
        }, 25);
      }
    });
  } });
  const codex = new CodexConnection({ cwd: '/private/tmp', executable: '/fake/codex', spawnProcess: () => child });
  try {
    assert.equal(await codex.turn({ settings: DEFAULTS, input: [{ type: 'text', text: 'hi' }], instructions: 'Test.', tools: set.tools, toolHandler: set.toolHandler as any }), 'All set.');
  } finally { codex.close(); }
  const codexOk = written.find(m => m.id === 501)?.result, codexBad = written.find(m => m.id === 502)?.result;
  assert.deepEqual(Object.keys(codexOk).sort(), ['contentItems', 'success']);
  assert.equal(codexOk.success, true); assert.equal(codexOk.contentItems[0].text, '{"count":2}');
  assert.equal(codexBad.success, false); assert.match(codexBad.contentItems[0].text, /count must be a whole number of at least 1/);

  // 4. OpenAI Responses API loop receives the same JSON text
  const seen: any[] = [];
  const api = { async response(body: any) {
    seen.push(structuredClone(body));
    if (seen.length === 1) return { output: [
      { type: 'function_call', call_id: 'c1', name: 'echo_num', arguments: '{"count":2}' },
      { type: 'function_call', call_id: 'c2', name: 'echo_num', arguments: '{"count":0}' },
    ] };
    return { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] }] };
  } };
  await runToolTurn({ provider: api as any, settings: { backend: 'openai', model: 'm' } as any, signal: new AbortController().signal, instructions: '', label: 'Test', recent: [], set: toolset([tool]) });
  const outputs = seen[1].input.filter((item: any) => item.type === 'function_call_output').map((item: any) => item.output);
  assert.equal(outputs[0], '{"count":2}');
  assert.match(outputs[1], /count must be a whole number of at least 1/);
});

test('report-only mode logs without blocking, enforce mode blocks and still logs, and main.cjs starts in enforce mode', async t => {
  const reports: any[] = [];
  let ran = 0;
  const tool = defineTool({
    name: 'loose_tool',
    description: 'Accepts a count.',
    properties: { count: { type: 'integer', minimum: 1 } },
    required: ['count'],
    run: args => { ran += 1; return { got: args }; },
  });
  const set = toolset([tool], { argumentsMode: 'report', onInvalidArgument: entry => reports.push(entry) });
  const res = await set.toolHandler({ tool: 'loose_tool', arguments: { count: 'SECRET_TOKEN' } as any });
  assert.equal(res.success, true);
  assert.equal(ran, 1);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].mode, 'report');
  assert.equal(reports[0].path, 'registry');
  assert.equal(reports[0].tool, 'loose_tool');
  assert.ok(!JSON.stringify(reports[0]).includes('SECRET_TOKEN'), 'report logs no argument values');
  // Non-object arguments are still refused even in report mode.
  assert.equal((await set.toolHandler({ tool: 'loose_tool', arguments: null as any })).outcome, 'invalid');

  // Process default via configureArgumentChecks works and can be overridden per call; enforce mode still logs without values.
  const globalReports: any[] = [];
  configureArgumentChecks({ mode: 'report', onInvalid: entry => globalReports.push(entry) });
  try {
    const defaultSet = toolset([tool]);
    assert.equal((await defaultSet.toolHandler({ tool: 'loose_tool', arguments: {} })).success, true);
    assert.equal(globalReports.length, 1);
    assert.equal(globalReports[0].mode, 'report');
    const strictSet = toolset([tool], { argumentsMode: 'enforce' });
    assert.equal((await strictSet.toolHandler({ tool: 'loose_tool', arguments: {} })).outcome, 'invalid');
    assert.equal(globalReports.length, 2);
    assert.equal(globalReports[1].mode, 'enforce');
  } finally {
    configureArgumentChecks({ mode: 'enforce', onInvalid: null });
  }

  // Verify WorkTools honors both report and enforce modes and logs without argument values.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fairy-report-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workReports: any[] = [];
  const wt = new WorkTools({ root, permission: 'auto', runCommand: (async () => ({ exitCode: 0, output: 'ok' })) as any, argumentsMode: 'report', onInvalidArgument: entry => workReports.push(entry) });
  await wt.handle({ tool: 'list_files', arguments: { extra: 'PRIVATE_VALUE' } as any });
  assert.equal(workReports.length, 1);
  assert.equal(workReports[0].mode, 'report');
  assert.equal(workReports[0].path, 'work');
  assert.equal(workReports[0].tool, 'list_files');
  assert.ok(!JSON.stringify(workReports[0]).includes('PRIVATE_VALUE'));

  const strictWt = new WorkTools({ root, permission: 'auto', runCommand: (async () => ({ exitCode: 0, output: 'ok' })) as any, argumentsMode: 'enforce', onInvalidArgument: entry => workReports.push(entry) });
  const strictRes = await strictWt.handle({ tool: 'list_files', arguments: { extra: 'PRIVATE_VALUE' } as any });
  assert.equal(strictRes.outcome, 'invalid');
  assert.equal(workReports.length, 2);
  assert.equal(workReports[1].mode, 'enforce');
  assert.ok(!JSON.stringify(workReports[1]).includes('PRIVATE_VALUE'));

  // Part A enforce mode active in main.cjs, still recording refusals (no values) into argument-checks.jsonl.
  const main = await readFile(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /argument-checks\.jsonl/);
  assert.match(main, /configureArgumentChecks\(\{ mode: 'enforce'/);
});

test('a tool with a malformed schema fails at definition time, not at run time', () => {
  assert.throws(() => defineTool({ name: 'bad_type', description: 'x', properties: { a: { type: 'banana' } }, run() {} }), /invalid schema type/);
  assert.throws(() => defineTool({ name: 'bad_enum', description: 'x', properties: { a: { type: 'string', enum: [] } }, run() {} }), /non-empty list/);
  assert.throws(() => defineTool({ name: 'bad_range', description: 'x', properties: { a: { type: 'number', minimum: 10, maximum: 5 } }, run() {} }), /minimum cannot exceed maximum/);
  assert.throws(() => defineTool({ name: 'bad_len', description: 'x', properties: { a: { type: 'string', minLength: -1 } }, run() {} }), /non-negative integer/);
  assert.throws(() => defineTool({ name: 'bad_items', description: 'x', properties: { a: { type: 'array', items: 'string' as any } }, run() {} }), /schema must be an object/);
  assert.throws(() => defineTool({ name: 'bad_req', description: 'x', properties: {}, required: ['missing'], run() {} }), /requires an input it doesn't describe/);
  // Unknown keywords in a tool's schema do not fail definition.
  assert.doesNotThrow(() => checkSchema({ type: 'object', properties: { a: { type: 'string', format: 'email' } }, 'x-meta': true }, 'ok_tool'));
});

test('sweep: every registered tool and work tool refuses a missing required field, a wrong type, and an extra field', async t => {
  const modules = [
    'files-agent.mjs', 'flux-tools.mjs', 'github-tools.mjs', 'google-tools.mjs',
    'nexus.mjs', 'research/start.mjs', 'watch-tools.mjs', 'simulator-tools.mjs',
    'side-sessions.mjs', 'work-tools.mjs',
  ];
  const all = new Map<string, any>();
  for (const file of modules) {
    const mod = await import(`../desktop/${file}`);
    for (const value of Object.values(mod)) {
      const list = value instanceof Map ? [...value.values()] : Array.isArray(value) ? value : [];
      for (const entry of list) {
        if (entry?.inputSchema && entry?.name && typeof entry.run === 'function' && !all.has(entry.name)) {
          all.set(entry.name, entry);
        }
      }
    }
  }
  assert.ok(all.size >= 80, `expected at least 80 tools, found ${all.size}`);

  // 1. Sweep every tool through toolset (with a trap run/guard that must never execute).
  for (const [name, def] of all) {
    let executed = 0;
    const trapped = { ...def, guard: () => { executed += 1; return ''; }, run: () => { executed += 1; return {}; } };
    const set = toolset([trapped]);
    const base = validFor(def.inputSchema);

    // Missing required field
    for (const req of def.inputSchema.required || []) {
      const missing = { ...base };
      delete missing[req];
      const res = await set.toolHandler({ tool: name, arguments: missing });
      assert.equal(res.outcome, 'invalid', `registry ${name} missing required ${req}`);
    }
    // Wrong type for first typed property
    for (const [prop, propSchema] of Object.entries(def.inputSchema.properties || {})) {
      const badVal = wrongTypeFor(propSchema);
      if (badVal === undefined) continue;
      const res = await set.toolHandler({ tool: name, arguments: { ...base, [prop]: badVal } });
      assert.equal(res.outcome, 'invalid', `registry ${name} wrong type on ${prop}`);
      break;
    }
    // Extra unknown field
    const extraRes = await set.toolHandler({ tool: name, arguments: { ...base, __unexpected_probe__: true } });
    assert.equal(extraRes.outcome, 'invalid', `registry ${name} extra field`);
    assert.equal(executed, 0, `registry ${name} should never reach guard/run on invalid args`);
  }

  // 2. Sweep every WorkTools core + grouped tool through WorkTools.handle (with every feature enabled, and trapping approve/runCommand).
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fairy-sweep-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  let trappedCalls = 0;
  const trap = (() => { trappedCalls += 1; throw new Error('should not be called'); }) as any;
  const tools = new WorkTools({
    root,
    permission: 'ask',
    runCommand: trap,
    approve: trap,
    attachments: { list: [{ id: 'a1', file: 'doc.txt' }], files: { read: trap, image: trap } } as any,
    web: { search: trap, read: trap },
    browser: { address: trap, url: trap, open: trap } as any,
    computer: { describe: trap, validate: trap, safe: trap, run: trap, capture: trap },
    pages: { check: trap, publish: trap },
    boards: { create: trap, save: trap },
    earlier: trap,
    recall: trap,
    helper: trap,
    helpers: { start: trap, wait: trap, get: trap, list: trap, discard: trap, plan: trap },
    builder: trap,
    critic: trap,
    github: { status: trap },
    nexus: { run: trap, logs: trap, outputs: trap },
    research: { draft: trap },
    watchers: { list: trap, add: trap },
    runs: { list: trap, start: trap, finish: trap, codeState: trap, helper: trap } as any,
    evals: { offer: trap },
    goal: { id: 'G1', step: 1, update: trap },
    goals: { list: trap, add: trap },
    simulators: { list: trap, show: trap },
    sessions: { list: trap, start: trap, message: trap },
  });
  const workDefs = [...WORK_DEFINITIONS.values(), ...RUN_TOOLS, ...EVAL_TOOLS, ...GOAL_TOOLS, ...GOAL_OFFER_TOOLS];
  const workNames = new Set(tools.available().map(t => t.name));
  for (const def of workDefs) {
    if (!workNames.has(def.name)) continue;
    const base = validFor(def.inputSchema);
    for (const req of def.inputSchema.required || []) {
      const missing = { ...base };
      delete missing[req];
      const res = await tools.handle({ tool: def.name, arguments: missing });
      assert.equal(res.outcome, 'invalid', `work ${def.name} missing required ${req}`);
    }
    for (const [prop, propSchema] of Object.entries(def.inputSchema.properties || {})) {
      const badVal = wrongTypeFor(propSchema);
      if (badVal === undefined) continue;
      const res = await tools.handle({ tool: def.name, arguments: { ...base, [prop]: badVal } });
      assert.equal(res.outcome, 'invalid', `work ${def.name} wrong type on ${prop}`);
      break;
    }
    const extraRes = await tools.handle({ tool: def.name, arguments: { ...base, __unexpected_probe__: true } });
    assert.equal(extraRes.outcome, 'invalid', `work ${def.name} extra field`);
  }
  assert.equal(trappedCalls, 0, 'no WorkTools handler or approval ran on invalid arguments');
});
