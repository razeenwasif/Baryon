import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWakeProfile, matchWake, restoreName, dropOpeningWords, learnedPhrases, cleanWakeProfile, couldBeName, soundAgrees } from '../src/wake-profile.js';

const RATE = 48000;
// A deterministic stand-in for speech: buzzing tones whose formants follow a contour.
function say(contour: Array<[number, number, number]>, { speed = 1, gain = .3, seed = 1 } = {}) {
  let noise = seed; const random = () => (noise = (noise * 16807) % 2147483647) / 2147483647 - .5;
  const parts = [new Float32Array(Math.round(RATE * .3)).map(() => random() * .002)];
  for (const [low, high, seconds] of contour) {
    const samples = new Float32Array(Math.round(RATE * seconds / speed));
    for (let i = 0; i < samples.length; i++) { const t = i / RATE, buzz = Math.sign(Math.sin(2 * Math.PI * 120 * t)); samples[i] = gain * (.5 * buzz * Math.sin(2 * Math.PI * low * t) + .5 * Math.sin(2 * Math.PI * high * t)) + random() * .002; }
    parts.push(samples);
  }
  parts.push(new Float32Array(Math.round(RATE * .4)).map(() => random() * .002));
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}
const HEY: Array<[number, number, number]> = [[500, 1800, .12], [650, 2200, .14]], NAME: Array<[number, number, number]> = [[300, 2600, .1], [700, 1500, .16], [400, 2400, .14]];
const HEY_NAME: Array<[number, number, number]> = [...HEY, ...NAME];
const OTHER: Array<[number, number, number]> = [[900, 1100, .15], [250, 3200, .2], [1100, 1300, .15], [350, 900, .2]];
const takes = () => [.9, 1, 1.1].flatMap((speed, i) => [
  { phrase: 'hey', samples: say(HEY_NAME, { speed, seed: i + 2 }), rate: RATE, heard: 'Hey, Mary.' },
  { phrase: 'name', samples: say(NAME, { speed, seed: i + 7 }), rate: RATE, heard: 'Very.' },
]);

test('a setup recognizes the phrase at another speed and volume, and ignores different speech', () => {
  const profile = buildWakeProfile(takes(), 'Fairy');
  assert.equal(matchWake(profile, say(HEY_NAME, { speed: .95, gain: .15, seed: 21 }), RATE), 'whole');
  assert.equal(matchWake(profile, say(NAME, { speed: 1.05, gain: .5, seed: 22 }), RATE), 'whole');
  assert.equal(matchWake(profile, say(OTHER, { seed: 23 }), RATE), null);
  assert.equal(matchWake(profile, say([...OTHER, ...OTHER, ...OTHER], { seed: 24 }), RATE), null);
  assert.equal(matchWake(null as any, say(NAME), RATE), null);
});

test('only a phrase with its greeting can open a longer sentence', () => {
  const profile = buildWakeProfile(takes(), 'Fairy');
  const sentence = [...OTHER, ...OTHER, ...OTHER];
  assert.equal(matchWake(profile, say([...HEY_NAME, ...sentence], { seed: 25 }), RATE), 'prefix');
  assert.equal(matchWake(profile, say([...NAME, ...sentence, ...sentence], { seed: 26 }), RATE), null, 'a lone word starts too many sentences');
});

test('a profile keeps measurements only, and rejects takes with nothing to learn from', () => {
  const profile = buildWakeProfile(takes(), 'Fairy');
  assert.deepEqual(Object.keys(profile).sort(), ['name', 'phrases', 'templates', 'threshold', 'version']);
  assert(profile.templates.every(take => take.frames.every(frame => frame.length === 12)));
  assert(profile.threshold >= 5 && profile.threshold <= 8.5);
  assert.deepEqual(cleanWakeProfile(JSON.parse(JSON.stringify(profile))), profile);
  assert.throws(() => buildWakeProfile([{ phrase: 'hey', samples: new Float32Array(100), rate: RATE }], 'Fairy'), /too quiet or too short/);
  for (const bad of [null, {}, { ...profile, version: 2 }, { ...profile, templates: [] }, { ...profile, templates: [{ phrase: 'hey', frames: [[1]] }] }]) assert.equal(cleanWakeProfile(bad as any), null);
  assert.equal(cleanWakeProfile({ ...profile, threshold: 500 })!.threshold, 8.5);
});

test('only words that could be the name count as a mishearing', () => {
  for (const heard of ['Very.', 'Hey, Mary.', 'Hey Siri', 'ferry', 'A ferry', 'Barry', 'Okay, fairly', 'fair', 'Fairy']) assert.equal(couldBeName(heard), true, heard);
  for (const heard of ['Mhm', 'mm', 'Hmm', 'Thank you', 'Okay', 'Yeah', 'Hey', 'Hey there', 'Hello', 'Really', 'Very good', 'Every day', 'Marry me', 'Good morning', '']) assert.equal(couldBeName(heard), false, heard);
  assert.equal(couldBeName('Rabin', 'Robin'), true);
  assert.equal(couldBeName('Very', 'Robin'), false);
});

test('a sound match only counts when the words could be the name', () => {
  assert.equal(soundAgrees('whole', 'Very.', 'Fairy'), true);
  for (const heard of ['', 'Mhm', 'Thank you', 'Hey there', 'Very good']) assert.equal(soundAgrees('whole', heard, 'Fairy'), false, heard);
  assert.equal(soundAgrees('prefix', 'Hey Mary, what time is it?', 'Fairy'), true);
  assert.equal(soundAgrees('prefix', 'Very, what time is it?', 'Fairy'), true);
  for (const heard of ['', 'Hey', 'Hey there, what’s up?', 'Hey what time is it?', 'Thank you so much']) assert.equal(soundAgrees('prefix', heard, 'Fairy'), false, heard);
  assert.equal(soundAgrees(null as any, 'Fairy', 'Fairy'), false);
});

test('a filler learned in setup stops counting as the name, even in a saved profile', () => {
  assert.deepEqual(learnedPhrases([{ heard: 'Mhm.' }, { heard: 'Thank you' }, { heard: 'Hey Siri' }], 'Fairy'), ['hey siri']);
  const saved = { ...buildWakeProfile(takes(), 'Fairy'), phrases: ['hey siri', 'mhm'] };
  const profile = cleanWakeProfile(JSON.parse(JSON.stringify(saved)))!;
  assert.deepEqual(profile.phrases, ['hey siri']);
  assert.equal(restoreName('Mhm.', profile), 'Mhm.');
  assert.equal(restoreName('Hey Siri', profile), 'Fairy');
});

test('spellings learned in setup count, without capturing everyday speech', () => {
  assert.deepEqual(learnedPhrases([{ heard: 'Hey, Mary.' }, { heard: 'Very.' }, { heard: 'Hey Fairy' }, { heard: '' }, { heard: 'one two three four' }], 'Fairy'), ['hey mary', 'very']);
  const profile = { name: 'Fairy', phrases: ['hey mary', 'very', 'a ferry'] };
  assert.equal(restoreName('Very.', profile as any), 'Fairy');
  assert.equal(restoreName('A ferry.', profile as any), 'Fairy');
  assert.equal(restoreName('Hey, Mary.', profile as any), 'Fairy');
  assert.equal(restoreName('Hey, Mary, what time is it?', profile as any), 'Fairy, what time is it?');
  assert.equal(restoreName('Very good, thanks.', profile as any), 'Very good, thanks.');
  assert.equal(restoreName('A ferry leaves at noon.', profile as any), 'A ferry leaves at noon.');
  assert.equal(restoreName('Very.', null as any), 'Very.');
});

test('a matched opening is removed however it was spelled', () => {
  assert.equal(dropOpeningWords('Hey Siri, what time is it?'), 'what time is it?');
  assert.equal(dropOpeningWords('February, what time is it?'), 'what time is it?');
  assert.equal(dropOpeningWords('A ferry what time is it'), 'what time is it');
  assert.equal(dropOpeningWords(''), '');
});
