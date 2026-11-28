// A practice quiz in one of Fairy's ink windows: a question at a time, answered with a click or a typed number, then
// marked, with the working (and a plot of it, when there is one) shown underneath. At the end, the score, a go again,
// and "more like this", which asks Fairy for a fresh set aimed at what was missed.
import { replyHTML } from './reply-renderer.js';
import { plotView } from './ink-plot.js';
import type { InkPlotHandle, InkPlotPart } from './ink-plot.js';
import { compile } from '../desktop/ink-math.mjs';

export interface QuizChoiceQuestion {
  type: 'choice';
  q: string;
  options: string[];
  answer: number;
  explain?: string;
  plot?: InkPlotPart | null;
}

export interface QuizNumberQuestion {
  type: 'number';
  q: string;
  answer: number;
  tolerance: number;
  unit?: string;
  explain?: string;
  plot?: InkPlotPart | null;
}

export type QuizQuestion = QuizChoiceQuestion | QuizNumberQuestion;

export interface QuizPart {
  title?: string;
  questions: QuizQuestion[];
}

export interface QuizBodyOptions {
  reduced?: boolean;
  ask?: (prompt: string) => void;
}

export interface QuizBodyHandle {
  stop: () => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const LETTERS = 'ABCDE';

// A typed answer as a number: plain numbers, fractions and simple expressions (3/2, sqrt(2), 2e-3, pi/4).
export function readNumber(text: unknown): number {
  const cleaned = String(text ?? '').trim().replace(/,(?=\d{3}\b)/g, '').replace(/,/g, '.');
  if (!cleaned) return NaN;
  try { return compile(cleaned, [])(); } catch { return NaN; }
}
export const marks = (question: QuizQuestion, given: string | number): boolean =>
  question.type === 'choice'
    ? given === question.answer
    : Math.abs(readNumber(given) - question.answer) <= question.tolerance;
const shownAnswer = (question: QuizQuestion): string =>
  question.type === 'choice'
    ? `${LETTERS[question.answer]}. ${question.options[question.answer]}`
    : `${question.answer}${question.unit ? ` ${question.unit}` : ''}`;

export function quizBody(
  part: QuizPart,
  body: HTMLElement,
  { reduced = false, ask = () => {} }: QuizBodyOptions = {},
): QuizBodyHandle {
  const total = part.questions.length, missed: string[] = [];
  let index = 0, score = 0, view: InkPlotHandle | null = null;
  const head = el('div', 'ink-quiz-head'), stage = el('div', 'ink-quiz-stage');
  body.append(head, stage);
  const progress = (): void => {
    head.replaceChildren(
      el('span', 'ink-quiz-count', index < total ? `QUESTION ${index + 1}/${total}` : `DONE`),
      el('span', 'ink-quiz-pips', [...Array<undefined>(total)].map((_, i) => (i < index ? '■' : i === index ? '▣' : '□')).join('')),
    );
  };
  function show(): void {
    view?.stop(); view = null; stage.replaceChildren(); progress();
    if (index >= total) return finish();
    const question = part.questions[index];
    const prompt = el('div', 'ink-quiz-q rich-reply'); prompt.innerHTML = replyHTML(question.q);
    stage.append(prompt);
    if (question.type === 'choice') {
      const choices = el('div', 'ink-quiz-choices');
      question.options.forEach((option, i) => {
        const button = el('button', 'ink-quiz-option'); button.type = 'button';
        const label = el('span', 'rich-reply'); label.innerHTML = replyHTML(option).replace(/^<p>|<\/p>\s*$/g, '');
        button.append(el('b', '', `[${LETTERS[i]}]`), label);
        button.onclick = () => {
          for (const other of choices.children) (other as HTMLButtonElement).disabled = true;
          button.classList.add('chosen');
          answer(i, choices);
        };
        choices.append(button);
      });
      stage.append(choices);
    } else {
      const form = el('form', 'ink-quiz-form'), input = el('input', 'ink-quiz-input'), check = el('button', 'ink-quiz-check', '[check]');
      input.placeholder = 'your answer'; input.autocomplete = 'off'; input.spellcheck = false; check.type = 'submit';
      form.append(el('span', 'ink-quiz-prompt', '>'), input, ...(question.unit ? [el('span', 'ink-quiz-unit', question.unit)] : []), check);
      form.onsubmit = event => { event.preventDefault(); if (!input.value.trim()) return; input.disabled = true; check.disabled = true; answer(input.value, null); };
      stage.append(form);
      requestAnimationFrame(() => input.focus({ preventScroll: true }));
    }
  }
  function answer(given: string | number, choices: HTMLElement | null): void {
    const question = part.questions[index], right = marks(question, given);
    if (right) score++; else missed.push(question.q.slice(0, 160));
    if (choices) {
      [...choices.children].forEach((button, i) => {
        if (i === question.answer) button.classList.add('right');
        else if (button.classList.contains('chosen')) button.classList.add('wrong');
      });
    }
    const verdict = el('div', `ink-quiz-verdict ${right ? 'right' : 'wrong'}`, right ? '✓ RIGHT' : `✗ NOT QUITE · ANSWER: ${shownAnswer(question)}`);
    stage.append(verdict);
    if (question.explain) { const working = el('div', 'ink-quiz-working rich-reply'); working.innerHTML = replyHTML(question.explain); stage.append(working); }
    if (question.plot) {
      const plot = question.plot;
      const holder = el('div', 'ink-plot'), canvas = el('canvas', 'ink-plot-canvas'), overlay = el('div', 'ink-plot-overlay');
      holder.append(canvas, overlay); stage.append(holder);
      requestAnimationFrame(() => { if (canvas.isConnected) view = plotView(canvas, overlay, plot, { reduced }); });
    }
    const next = el('button', 'ink-quiz-next', index + 1 < total ? '[next ▸]' : '[finish ▸]'); next.type = 'button';
    next.onclick = () => { index++; show(); };
    stage.append(next);
  }
  function finish(): void {
    const bar = '█'.repeat(score) + '░'.repeat(total - score);
    stage.append(el('div', 'ink-quiz-score', `SCORE ${score}/${total}  ${bar}`));
    stage.append(el('p', 'ink-quiz-note', score === total ? 'All right. Ask for a harder set when you’re ready.' : 'Go again, or get a new set aimed at the ones you missed.'));
    const again = el('button', 'ink-quiz-next', '[▶ again]'), more = el('button', 'ink-quiz-next', '[more like this]');
    again.type = more.type = 'button';
    again.onclick = () => { index = 0; score = 0; missed.length = 0; show(); };
    more.onclick = () => {
      more.disabled = true; more.textContent = '[asking…]';
      ask(missed.length
        ? `Quiz me again on ${part.title || 'this'}, with new questions aimed at what I got wrong: ${missed.join(' | ')}`
        : `Quiz me again on ${part.title || 'this'}, with harder questions.`);
    };
    const row = el('div', 'ink-quiz-actions'); row.append(again, more); stage.append(row);
  }
  show();
  return { stop: () => view?.stop() };
}
