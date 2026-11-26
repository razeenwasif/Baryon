import test from 'node:test';
import assert from 'node:assert/strict';
import { requestMode, wantsDesktop } from '../src/chat-routing.js';
import { DEFAULTS, cleanSettings } from '../desktop/core.mjs';
import { actionReview } from '../desktop/action-review.mjs';

test('direct desktop commands route from typed or transcribed chat', () => {
  for (const text of [
    'Can you scroll through this document and summarize it?',
    'Could you please scroll down a little?', 'Scroll up', 'scroll',
    'Fairy, scroll to the bottom of this PDF', 'Fairy, scroll to the bottom of this PDF', 'Hey Mav, please open Calculator',
    'I want you to open Safari', 'Launch Blender', 'Open this link',
    'Click the next button', 'Can you click "Next"?', 'Tap on that checkbox',
    'Press Command+F', 'Type "gravity" into the search box',
    'Paste this into the document', 'Go to the next page',
    'Switch to the previous tab', 'Close this tab', 'Zoom in',
  ]) {
    assert.equal(wantsDesktop(text), true, text);
    assert.equal(requestMode(text, 'chat', DEFAULTS), 'desktop', text);
  }
});

test('explanations, quotes, negations, and ordinary chat do not enable control', () => {
  for (const text of [
    'How do I scroll through a document?', 'Can you explain how to open Calculator?',
    'What happens if I click delete?', 'Should I click this button?',
    'Translate "scroll down"', '"Can you click Next?"',
    '```js\nscroll down\n```', "'open Calculator'", 'The page says click Next',
    'Do not scroll', "Please don't open anything", 'Can you not click that?',
    'Open Calculator without capturing my screen', 'Open your mind',
    'Explain this diagram on screen', 'Search for the latest science news',
    'Tell me about scrolling animations', 'What is on my calendar tomorrow?',
    'Summarize my Gmail inbox', 'Check my GitHub pull requests',
  ]) assert.equal(wantsDesktop(text), false, text);
});

test('routing is per request, prioritizes actions, and respects mode and settings', () => {
  assert.equal(requestMode('Scroll through this document on my screen', 'chat', DEFAULTS), 'desktop');
  assert.equal(requestMode('Explain this on my screen', 'chat', DEFAULTS), 'screen');
  assert.equal(requestMode('Tell me more', 'chat', DEFAULTS), 'chat');
  assert.equal(requestMode('Scroll down', 'chat', { ...DEFAULTS, autoDesktop: 'off' }), 'chat');
  assert.equal(requestMode('Scroll down', 'chat', { ...DEFAULTS, autoScreen: 'off' }), 'desktop');
  assert.equal(requestMode('Scroll down', 'screen', DEFAULTS), 'screen');
  assert.equal(requestMode('Hello', 'desktop', { ...DEFAULTS, autoDesktop: 'off' }), 'desktop');
  assert.equal(cleanSettings({ autoDesktop: 'off' }).autoDesktop, 'off');
  assert.equal(cleanSettings({}).autoDesktop, 'on');
  assert.throws(() => cleanSettings({ autoDesktop: 'maybe' }), /route automatically/);
});

test('recognizing a desktop request does not authorize its actions', () => {
  assert.equal(requestMode('Click the Send button', 'chat', DEFAULTS), 'desktop');
  assert.equal(actionReview([{ type: 'click', x: 10, y: 10, button: 'left' }]).required, true);
  assert.equal(actionReview([{ type: 'type', text: 'an email reply' }]).required, true);
  assert.equal(actionReview([{ type: 'scroll', x: 10, y: 10, scroll_y: 300, scroll_x: 0 }]).required, true);
});
