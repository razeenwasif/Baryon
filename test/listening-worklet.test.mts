import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../src/listening-worklet.js', import.meta.url), 'utf8');
function fixture() {
  let Processor: any; const messages: any[] = [];
  vm.runInNewContext(source, { Float32Array, AudioWorkletProcessor: class { port: any; constructor() { this.port = { postMessage: (x: any) => messages.push(x) }; } }, registerProcessor: (_: unknown, value: any) => { Processor = value; } });
  return { node: new Processor(), messages };
}
test('worklet emits no idle input and tags frames with the active session', () => {
  const f = fixture(); for (let i = 0; i < 9; i++) f.node.process([[new Float32Array(128).fill(.1)]]); assert.equal(f.messages.length, 0);
  f.node.port.onmessage({ data: { token: 3 } }); for (let i = 0; i < 8; i++) f.node.process([[new Float32Array(128).fill(.1)]]);
  assert.equal(f.messages.length, 1); assert.equal(f.messages[0].token, 3); assert.equal(f.messages[0].samples.length, 1024);
});
test('session reset erases partial samples and final disposal stops the processor', () => {
  const f = fixture(); f.node.port.onmessage({ data: { token: 1 } }); f.node.process([[new Float32Array(128).fill(.9)]]);
  f.node.port.onmessage({ data: { token: 2 } }); for (let i = 0; i < 8; i++) f.node.process([[new Float32Array(128).fill(.2)]]);
  assert.equal(f.messages[0].token, 2); assert(f.messages[0].samples.every((x: number) => Math.abs(x - .2) < .0001));
  f.node.port.onmessage({ data: { token: 0 } }); for (let i = 0; i < 8; i++) f.node.process([[new Float32Array(128)]]); assert.equal(f.messages.length, 1);
  f.node.port.onmessage({ data: { stop: true } }); assert.equal(f.node.process([]), false);
});
