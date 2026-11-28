import test from 'node:test';
import assert from 'node:assert/strict';
import { seatedPose } from '../src/seated-sequence.js';
import { replyReaction, ConversationReaction } from '../src/conversation-reaction.js';

test('seated gestures form a repeating uninterrupted cycle across a fifteen-minute rest', () => {
  for (const [time, kind] of [[0, 'finger'], [8, 'chin'], [33, 'peek'], [41, 'chin'], [66, 'finger']] as const) assert.equal(seatedPose(time).kind, kind);
  const seen = new Set<string>();
  for (let t = 0; t < 900; t += .1) {
    const s = seatedPose(t);
    seen.add(s.kind);
    assert(s.frame >= 0 && s.frame < ({ finger: 5, chin: 1, peek: 8 }[s.kind]));
  }
  assert.equal(seen.size, 3);
});
test('conversation reactions require clear opening cues, not generic punctuation', () => {
  assert.equal(replyReaction('Haha, that was a good one!'), 'laugh');
  assert.equal(replyReaction('Wow, I did not expect that!'), 'surprise');
  assert.equal(replyReaction('Hmph, you are teasing me.'), 'pout');
  assert.equal(replyReaction('Here is how the algorithm works!'), null);
  assert.equal(replyReaction('This is not funny.'), null);
  assert.equal(replyReaction('Here is code: `haha()`'), null);
});
test('serious conversation and quoted code do not receive playful reactions', () => {
  assert.equal(replyReaction('Haha, okay.', 'My friend died.'), null);
  assert.equal(replyReaction('Wow, that sounds difficult.', 'I received a cancer diagnosis.'), null);
  assert.equal(replyReaction('```js\nhaha()\n```\nThe function is invoked.'), null);
  assert.equal(replyReaction('The word “wow” is an interjection.'), null);
});
test('reactions end once, reject bursts and allow explicit previews', () => {
  const r = new ConversationReaction();
  assert(r.play('laugh'));
  assert(!r.play('pout'));
  assert(!r.play('bogus' as any, true));
  for (let i = 0; i < 49; i++) r.tick(.1);
  assert.equal(r.kind, null);
  assert(!r.play('surprise'));
  assert(r.play('pout', true));
  r.tick(.1, { allowed: false });
  assert.equal(r.kind, null);
});
test('reaction loading does not skip frames and stalled clocks cannot catch up', () => {
  const r = new ConversationReaction();
  r.play('surprise');
  r.tick(99, { ready: false });
  assert.equal(r.time, 0);
  r.tick(99);
  assert.equal(r.time, .1);
  assert.equal(r.sample().frame, 0);
  r.stop();
  assert.equal(r.kind, null);
});
