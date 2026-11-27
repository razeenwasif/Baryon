// Eval tasks grouped by the kind of task Auto reads a request as (docs/auto-by-task-plan.md, stage 3), so a model's
// score on a kind comes from Fairy's own harness and exact checks rather than from the web.
//
// The tasks that exist already are tagged here (code, business, data). New sets for maths, circuits, vision, writing and
// teaching are below, each a plain chat ("ask") with one request and checks that need no model:
//   maths     the final answer, exactly or to a stated number of places
//   circuits  the answer built and run against the problem's truth table by Fairy's own engines (fairy-engines)
//   vision    a picture drawn here (evals/pictures.mjs) with one right answer
//   writing   rules the brief sets (length, words to keep or drop, form): checked by rules, not judged for quality
//   teaching  the same: the right answer, the form asked for, and not giving away what it was asked to keep back
// Each new task has a script that passes and a wrong answer that fails, played by test/kind-tasks.test.mjs with no model.
// Research has its own runner (Research mode's evals) and isn't here; circuits' engines must be built (npm run build:engines).
import { spawnSync } from 'node:child_process';
import { check, excerpt, says } from './checks.mjs';
import { TASKS } from './tasks.mjs';
import { COLOURS, Picture } from './pictures.mjs';
import { ENGINES } from '../desktop/notebook/practice.mjs';

// The tasks that were there before, by kind. The hard work tasks are Swarm's measure and stay out of these sets.
export const TAGGED = {
  code: ['files-dev-port', 'github-ci-failure', 'github-review-reply', 'github-injection', 'work-review-feedback', 'work-fix-bug', 'work-find-fact', 'work-config-readers', 'work-rename', 'work-json-option', 'work-export-formats', 'work-injection', 'work-plan-mode'],
  business: ['calendar-first-meeting', 'calendar-busy-check', 'calendar-create-approved', 'calendar-create-declined', 'calendar-injection', 'gmail-act-on', 'gmail-draft-reply', 'gmail-injection', 'drive-budget-total', 'files-injection'],
  data: ['work-number-from-data'],
};

// ── reading an answer ──

// The last line that starts "Answer:", without its bold or full stop; null when there is none.
export function finalAnswer(reply) {
  const lines = String(reply || '').split('\n').map(line => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const found = /^[*_#>\s-]*answer[*_\s]*[:：][*_\s]*(.+?)[*_\s.]*$/i.exec(lines[i]);
    if (found) return found[1].trim();
  }
  return null;
}
// The numbers in an answer, fractions as their value: "x = 1 or x = 3" → [1, 3]; "5/36" → [0.13888…].
export function numbersOf(text) {
  return [...String(text || '').replace(/(\d),(\d{3})\b/g, '$1$2').replace(/[−–]/g, '-').matchAll(/-?\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?/g)]
    .map(([found]) => { const [top, bottom] = found.split('/').map(Number); return bottom === undefined ? top : top / bottom; });
}
export const words = text => String(text || '').split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
const prose = reply => String(reply || '').replace(/^\s*answer\s*:.*$/gim, '').trim();

const ANSWER_LINE = 'End with the final answer on its own last line, as “Answer: …”.';
const answerIs = (value, places = null) => check(`the answer is ${value}`, r => {
  const given = finalAnswer(r.reply);
  if (given === null) return `There was no “Answer:” line: ${excerpt(r.reply)}.`;
  const tolerance = places === null ? 1e-9 : 0.5 * 10 ** -places + 1e-9;
  return numbersOf(given).some(number => Math.abs(number - value) <= tolerance) || `It answered ${excerpt(given)}.`;
});
const answerSet = values => check(`the answers are ${values.join(' and ')}`, r => {
  const given = finalAnswer(r.reply);
  if (given === null) return `There was no “Answer:” line: ${excerpt(r.reply)}.`;
  const found = [...new Set(numbersOf(given).map(n => Math.round(n * 1e6) / 1e6))].sort((a, b) => a - b);
  return JSON.stringify(found) === JSON.stringify([...values].sort((a, b) => a - b)) || `It answered ${excerpt(given)}.`;
});
const answerSays = (pattern, name) => check(name, r => { const given = finalAnswer(r.reply); return given !== null && pattern.test(given) || `It answered ${excerpt(given ?? r.reply)}.`; });

// ── maths ──

const maths = (id, title, ask, check, good, wrong) => ({ id, taskKind: 'maths', kind: 'ask', title, ask: `${ask} ${ANSWER_LINE}`, checks: [check], script: [{ reply: good }], wrong });
const MATHS = [
  maths('maths-quadratic', 'Solves a quadratic', 'Solve 3x² − 12x + 9 = 0.', answerSet([1, 3]), 'Divide by 3: x² − 4x + 3 = 0, so (x − 1)(x − 3) = 0.\nAnswer: x = 1 or x = 3', 'Answer: x = 1 or x = −3'),
  maths('maths-multiples', 'Counts with inclusion and exclusion', 'What is the sum of the integers from 1 to 200 that are divisible by 3 or by 5?', answerIs(9368), 'Multiples of 3: 6633; of 5: 4100; of 15: 1365. 6633 + 4100 − 1365.\nAnswer: 9368', 'Answer: 10733'),
  maths('maths-derivative', 'Differentiates a product', 'Let f(x) = x³ ln x. What is f′(e)? Give it as a decimal to two places.', answerIs(4 * Math.E ** 2, 2), 'f′(x) = 3x² ln x + x², so f′(e) = 4e².\nAnswer: 29.56', 'Answer: 22.17'),
  maths('maths-integral', 'Integrates by parts', 'Evaluate the integral of x sin x from 0 to π. Give it as a decimal to three places.', answerIs(Math.PI, 3), 'By parts: [−x cos x + sin x] from 0 to π = π.\nAnswer: 3.142', 'Answer: 0'),
  maths('maths-dice', 'Works out a probability', 'Two fair six-sided dice are rolled. What is the probability that they sum to 8? Give it as a fraction in lowest terms.', answerIs(5 / 36), 'The pairs are (2,6), (3,5), (4,4), (5,3), (6,2): 5 of 36.\nAnswer: 5/36', 'Answer: 1/6'),
  maths('maths-arrangements', 'Counts arrangements with repeats', 'How many distinct arrangements are there of the letters of BANANA?', answerIs(60), '6!/(3!·2!) = 720/12.\nAnswer: 60', 'Answer: 720'),
  maths('maths-projectile', 'Solves a projectile problem', 'A ball is thrown straight up at 14 m/s from the ground. Taking g as 9.8 m/s² and ignoring air, how many seconds until it lands? Give it to two decimal places.', answerIs(28 / 9.8, 2),
    'It lands when 14t − 4.9t² = 0, so t = 14/4.9.\nAnswer: 2.86 s', 'Answer: 1.43 s'),
  maths('maths-determinant', 'Finds a determinant', 'What is the determinant of the 3×3 matrix with rows (2, 1, 3), (0, 4, 1) and (5, 2, 0)?', answerIs(-59), 'Along the first row: 2(0 − 2) − 1(0 − 5) + 3(0 − 20) = −4 + 5 − 60.\nAnswer: −59', 'Answer: 59'),
  maths('maths-modular', 'Works with remainders', 'What is the remainder when 7^100 is divided by 13?', answerIs(9), '7^12 ≡ 1 (mod 13) and 100 = 8·12 + 4, so 7^100 ≡ 7^4 = 2401 ≡ 9.\nAnswer: 9', 'Answer: 3'),
  maths('maths-limit', 'Takes a limit', 'What is the limit of (1 + 3/n)^(2n) as n tends to infinity? Give it as a decimal to two places.', answerIs(Math.E ** 6, 2), 'It is e^(3·2) = e^6.\nAnswer: 403.43', 'Answer: 20.09'),
  maths('maths-eigenvalues', 'Finds eigenvalues', 'What are the eigenvalues of the 2×2 matrix with rows (4, 1) and (2, 3)?', answerSet([2, 5]), 'Trace 7, determinant 10: λ² − 7λ + 10 = 0.\nAnswer: 2 and 5', 'Answer: 1 and 6'),
];

// ── circuits ──

// A combinational problem with its truth table worked out from rule(inputs) → outputs, every row in binary order.
function combinational(title, statement, inputs, outputs, rule, reference) {
  const rows = [];
  for (let n = 0; n < 2 ** inputs.length; n++) {
    const values = Object.fromEntries(inputs.map((name, i) => [name, (n >> (inputs.length - 1 - i)) & 1]));
    const out = rule(values);
    rows.push([...inputs.map(name => values[name]), ...outputs.map(name => Number(Boolean(out[name])))].join(' '));
  }
  return { title, statement, inputs: inputs.map(name => ({ name, bits: 1 })), outputs: outputs.map(name => ({ name, bits: 1 })), clocked: false,
    table: `${[...inputs, ...outputs].join(' ')}\n${rows.join('\n')}\n`, referenceKind: 'expressions', reference: `${reference}\n`, hints: [], explanation: '', difficulty: 'medium', topic: 'logic', cites: [], id: 'c1' };
}
const EXPRESSIONS = 'Answer with one line per output in a ```circuit block, like\n```circuit\nY = A & !B | C\n```\nusing & for AND, | for OR, ^ for XOR, ! for NOT and brackets, and only the input names given.';
const MACHINE = 'Answer with a Moore state machine in a ```circuit block, in this form (the first state is where it starts; a state stays put unless a line moves it; an output not given in a state is 0):\n```circuit\ninputs A\noutputs Y\nstate Idle\nstate On Y=1\nIdle -> On when A\nOn -> Idle when A\'\n```';
// The circuit in a reply: its last fenced block, or else its lines of the form "Y = …".
export function circuitText(reply) {
  const blocks = [...String(reply || '').matchAll(/```[a-z]*\n([\s\S]*?)```/gi)];
  if (blocks.length) return blocks.at(-1)[1].trim();
  return String(reply || '').split('\n').filter(line => /^\s*[A-Za-z]\w*\s*=\s*\S/.test(line)).join('\n').trim();
}
// Built and run by Fairy's circuit engines against the problem's own table.
export function engineCheck(problem, text, { program = ENGINES } = {}) {
  const ran = spawnSync(program, { input: JSON.stringify({ op: 'circuits.answer', problem, kind: problem.referenceKind, text }), timeout: 30000 });
  if (ran.error) throw new Error(ran.error.code === 'ENOENT' ? 'Fairy’s circuit engines aren’t built: npm run build:engines.' : ran.error.message);
  const answer = JSON.parse(String(ran.stdout));
  if (!answer.ok) throw new Error(answer.error);
  return answer.result;
}
const passesTable = problem => check('the circuit passes its truth table', r => {
  const text = circuitText(r.reply);
  if (!text) return `There was no circuit in the reply: ${excerpt(r.reply)}.`;
  const result = engineCheck(problem, text);
  return result.passed || (result.built ? `It built but failed: ${result.failures.slice(0, 2).join('; ')}` : `It couldn’t be built: ${result.error}`);
});
const circuit = (id, problem, good, wrong) => ({ id, taskKind: 'circuits', kind: 'ask', title: problem.title, problem,
  ask: `${problem.statement}\nInputs: ${problem.inputs.map(s => s.name).join(', ')}. Outputs: ${problem.outputs.map(s => s.name).join(', ')}.\n${problem.referenceKind === 'machine' ? MACHINE : EXPRESSIONS}`,
  checks: [passesTable(problem)], script: [{ reply: `Here it is.\n\`\`\`circuit\n${good}\n\`\`\`` }], wrong: `\`\`\`circuit\n${wrong}\n\`\`\`` });
const CIRCUITS = [
  circuit('circuits-majority', combinational('Majority of three', 'Design a circuit whose output Y is 1 when at least two of A, B and C are 1.', ['A', 'B', 'C'], ['Y'], v => ({ Y: v.A + v.B + v.C >= 2 }), 'Y = A & B | A & C | B & C'), 'Y = A & B | C & (A | B)', 'Y = A | B | C'),
  circuit('circuits-mux', combinational('Two-way multiplexer', 'Design a multiplexer: Y is A when S is 0 and B when S is 1.', ['S', 'A', 'B'], ['Y'], v => ({ Y: v.S ? v.B : v.A }), 'Y = !S & A | S & B'), 'Y = !S & A | S & B', 'Y = S & A | !S & B'),
  circuit('circuits-full-adder', combinational('Full adder', 'Design a full adder: S is the sum bit and Co the carry out of adding A, B and the carry in Ci.', ['A', 'B', 'Ci'], ['S', 'Co'], v => ({ S: (v.A + v.B + v.Ci) % 2, Co: v.A + v.B + v.Ci >= 2 }), 'S = A ^ B ^ Ci\nCo = A & B | Ci & (A ^ B)'),
    'S = A ^ B ^ Ci\nCo = A & B | A & Ci | B & Ci', 'S = A ^ B\nCo = A & B'),
  circuit('circuits-even-parity', combinational('Even parity', 'Design a circuit whose output Y is 1 when an even number of A, B and C are 1 (none counts as even).', ['A', 'B', 'C'], ['Y'], v => ({ Y: (v.A + v.B + v.C) % 2 === 0 }), 'Y = !(A ^ B ^ C)'), 'Y = !(A ^ B ^ C)', 'Y = A ^ B ^ C'),
  circuit('circuits-comparator', combinational('Two-bit comparator', 'A1 A0 and B1 B0 are two 2-bit numbers, A1 and B1 their high bits. Design a circuit whose output G is 1 when A is greater than B.', ['A1', 'A0', 'B1', 'B0'], ['G'],
    v => ({ G: 2 * v.A1 + v.A0 > 2 * v.B1 + v.B0 }), 'G = A1 & !B1 | !(A1 ^ B1) & A0 & !B0'), 'G = A1 & !B1 | A0 & !B1 & !B0 | A1 & A0 & !B0', 'G = A1 & !B1 | A0 & !B0'),
  circuit('circuits-priority', combinational('Priority encoder', 'Design a 4-to-2 priority encoder: Y1 Y0 is the number of the highest-numbered input among D3, D2, D1, D0 that is 1, and V is 1 when any of them is 1. When none is, Y1 and Y0 are 0.', ['D3', 'D2', 'D1', 'D0'], ['Y1', 'Y0', 'V'],
    v => { const top = v.D3 ? 3 : v.D2 ? 2 : v.D1 ? 1 : 0; return { Y1: top >> 1, Y0: top & 1, V: v.D3 | v.D2 | v.D1 | v.D0 }; }, 'Y1 = D3 | D2\nY0 = D3 | !D2 & D1\nV = D3 | D2 | D1 | D0'),
    'Y1 = D3 | D2\nY0 = D3 | !D2 & D1\nV = D3 | D2 | D1 | D0', 'Y1 = D3 | D2\nY0 = D3 | D1\nV = D3 | D2 | D1 | D0'),
  circuit('circuits-simplify', combinational('Simplify a sum of products', 'Simplify F = A’B’C + A’BC + AB’C + ABC (’ is NOT) to its simplest form and give it as a circuit.', ['A', 'B', 'C'], ['F'], v => ({ F: v.C }), 'F = C'), 'F = C', 'F = A | C'),
  circuit('circuits-half-subtractor', combinational('Half subtractor', 'Design a half subtractor working out A − B: D is the difference bit and Bo the borrow.', ['A', 'B'], ['D', 'Bo'], v => ({ D: v.A ^ v.B, Bo: !v.A && v.B }), 'D = A ^ B\nBo = !A & B'), 'D = A ^ B\nBo = !A & B', 'D = A ^ B\nBo = A & !B'),
  circuit('circuits-prime', combinational('Three-bit primes', 'A2 A1 A0 is a 3-bit number, A2 its high bit. Design a circuit whose output Y is 1 when the number is prime.', ['A2', 'A1', 'A0'], ['Y'], v => ({ Y: [2, 3, 5, 7].includes(4 * v.A2 + 2 * v.A1 + v.A0) }), 'Y = !A2 & A1 | A2 & A0'),
    'Y = !A2 & A1 | A2 & A0', 'Y = A0'),
  circuit('circuits-two-ones', { title: 'Two ones in a row', statement: 'Design a clocked circuit with input X whose output Z is 1 once X has been 1 at the last two clock edges in a row, and 0 otherwise.', inputs: [{ name: 'X', bits: 1 }], outputs: [{ name: 'Z', bits: 1 }], clocked: true,
    table: 'X Clk Z\n1 C 0\n1 C 1\n1 C 1\n0 C 0\n1 C 0\n1 C 1\n0 C 0\n', referenceKind: 'machine', reference: "inputs X\noutputs Z\nstate S0\nstate S1\nstate S2 Z=1\nS0 -> S1 when X\nS1 -> S2 when X\nS1 -> S0 when X'\nS2 -> S0 when X'\n", hints: [], explanation: '', difficulty: 'medium', topic: 'state machines', cites: [], id: 'c1' },
    "inputs X\noutputs Z\nstate Zero\nstate One\nstate Two Z=1\nZero -> One when X\nOne -> Two when X\nOne -> Zero when X'\nTwo -> Zero when X'", "inputs X\noutputs Z\nstate Zero\nstate One Z=1\nZero -> One when X\nOne -> Zero when X'"),
];

// ── vision ──

const LOOK = `Look at the picture. ${ANSWER_LINE}`;
const vision = (id, title, ask, draw, check, good, wrong) => ({ id, taskKind: 'vision', kind: 'ask', title, ask: `${ask} ${LOOK}`, picture: () => draw().screenshot(), checks: [check], script: [{ reply: good }], wrong });
const VISION = [
  vision('vision-count-red', 'Counts shapes of one colour', 'How many red squares are there?', () => {
    const p = new Picture(480, 320);
    [[30, 30], [150, 60], [300, 40], [80, 200], [380, 220]].forEach(([x, y]) => p.rect(x, y, 50, 50, COLOURS.red));
    [[230, 150], [40, 120], [400, 120]].forEach(([x, y]) => p.rect(x, y, 50, 50, COLOURS.blue));
    return p;
  }, answerIs(5), 'There are five red squares and three blue ones.\nAnswer: 5', 'Answer: 8'),
  vision('vision-read-number', 'Reads a number', 'What number is written in the picture?', () => new Picture(420, 160).text(40, 40, '4827', COLOURS.black, 12), answerIs(4827), 'Answer: 4827', 'Answer: 4821'),
  vision('vision-tallest-bar', 'Reads a bar chart', 'Which bar is tallest: A, B, C or D?', () => {
    const p = new Picture(480, 360);
    [['A', 140], ['B', 90], ['C', 230], ['D', 180]].forEach(([letter, height], i) => { p.rect(50 + i * 110, 290 - height, 70, height, COLOURS.blue); p.text(70 + i * 110, 305, letter, COLOURS.black, 5); });
    return p.rect(30, 290, 440, 3, COLOURS.black);
  }, answerSays(/^\W*C\b/i, 'the answer is C'), 'C is the tallest bar.\nAnswer: C', 'Answer: D'),
  vision('vision-circle-colour', 'Names a colour', 'The picture has one circle among squares. What colour is the circle: red, blue, green or yellow?', () => {
    const p = new Picture(420, 300);
    p.rect(30, 40, 70, 70, COLOURS.red).rect(300, 50, 70, 70, COLOURS.blue).rect(60, 190, 70, 70, COLOURS.yellow);
    return p.circle(220, 170, 45, COLOURS.green);
  }, answerSays(/green/i, 'the answer is green'), 'Answer: green', 'Answer: yellow'),
  vision('vision-grid-cell', 'Finds a cell in a grid', 'A 4 by 4 grid has one black cell. Counting rows from 1 at the top and columns from 1 at the left, which row and column is it in? Give it as “row R, column C”.', () => {
    const p = new Picture(400, 400);
    for (let i = 0; i <= 4; i++) { p.rect(40 + i * 80, 40, 3, 323, COLOURS.grey); p.rect(40, 40 + i * 80, 323, 3, COLOURS.grey); }
    return p.rect(123, 203, 77, 77, COLOURS.black);
  }, answerSays(/row\s*3\D+column\s*2\b/i, 'the answer is row 3, column 2'), 'Answer: row 3, column 2', 'Answer: row 2, column 3'),
  vision('vision-sum', 'Adds two numbers it reads', 'The picture shows a sum. What is its result?', () => new Picture(520, 160).text(30, 40, '37+58', COLOURS.black, 12), answerIs(95), '37 + 58 = 95.\nAnswer: 95', 'Answer: 85'),
  vision('vision-arrow', 'Reads a direction', 'Which way does the arrow point: up, down, left or right?', () => new Picture(300, 300).arrow(150, 150, 140, 'left', COLOURS.black),
    answerSays(/^\W*left\b/i, 'the answer is left'), 'Answer: left', 'Answer: up'),
  vision('vision-inside', 'Counts what is inside a shape', 'How many blue dots are inside the black rectangle?', () => {
    const p = new Picture(480, 340).frame(120, 80, 240, 180, COLOURS.black, 4);
    [[170, 130], [250, 120], [310, 200], [200, 220]].forEach(([x, y]) => p.circle(x, y, 14, COLOURS.blue));
    [[50, 50], [420, 300], [60, 290]].forEach(([x, y]) => p.circle(x, y, 14, COLOURS.blue));
    return p;
  }, answerIs(4), 'Four dots are inside and three outside.\nAnswer: 4', 'Answer: 7'),
];

// ── writing (checked by rules) ──

const ONLY = 'Reply with only the text asked for: no heading, no note before or after it.';
const ruled = (name, test) => check(name, r => test(String(r.reply || '').trim()));
const writing = (id, title, ask, checks, good, wrong) => ({ id, taskKind: 'writing', kind: 'ask', title, checkedBy: 'rules', ask: `${ask} ${ONLY}`, checks, script: [{ reply: good }], wrong });
const LONG = 'The Northgate Library will close for renovation from Monday 7 December to Friday 22 January. During this time, books on loan will be due back at the Riverside branch, which will extend its opening hours until 8 pm on weekdays. The renovation, funded by a council grant of $2.4 million, will add a children’s reading room, a quiet study floor and twenty new public computers. Library members do not need to do anything: their cards will work at every branch, and holds will be moved automatically. Staff will be on hand at Riverside to help anyone who usually visits Northgate, and the library’s website will post weekly photos of the building work. The library thanks the community for its patience and looks forward to welcoming everyone back in late January with a family open day.';
const WRITING = [
  writing('writing-less-stiff', 'Rewrites to a brief', 'Rewrite this cover letter opening so it sounds natural and confident, in at most 35 words, without the words “esteemed”, “express” or “I am writing”: “I am writing to express my interest in the position of graduate engineer at your esteemed firm.”',
    [ruled('at most 35 words', t => words(t) <= 35 || `It ran to ${words(t)} words.`), ruled('drops the stiff words', t => !/esteemed|express|i am writing/i.test(t) || `It kept a stiff phrase: ${excerpt(t)}.`), ruled('keeps the role', t => /graduate engineer/i.test(t) || 'It lost the role.')],
    'I’d love to join your team as a graduate engineer, bringing two years of hands-on project work and a real appetite for hard problems.', 'I am writing to express my keen interest in the graduate engineer role at your esteemed firm.'),
  writing('writing-cut', 'Cuts to a length and keeps the facts', `Cut this notice to between 60 and 80 words, keeping the closing and reopening dates, the Riverside branch and the $2.4 million: “${LONG}”`,
    [ruled('60 to 80 words', t => (words(t) >= 60 && words(t) <= 80) || `It ran to ${words(t)} words.`), ruled('keeps the facts', t => ['7 December', '22 January', 'Riverside', '$2.4 million'].every(fact => t.includes(fact)) || `It lost a fact: ${excerpt(t)}.`)],
    'Northgate Library closes for renovation from Monday 7 December to Friday 22 January. Return loans to the Riverside branch, which will open until 8 pm on weekdays. The $2.4 million council grant adds a children’s reading room, a quiet study floor and twenty public computers. Cards work at every branch and holds move automatically. Riverside staff will help Northgate visitors, and a family open day will welcome everyone back in late January.',
    'Northgate Library is closing for a while for renovations. Please use another branch.'),
  writing('writing-active', 'Turns passive into active', 'Rewrite these two sentences in the active voice, keeping their meaning: “The report was written by Maria. The results were checked by the team.”',
    [ruled('Maria wrote the report', t => /maria wrote the report/i.test(t) || `It said ${excerpt(t)}.`), ruled('the team checked the results', t => /the team checked the results/i.test(t) || `It said ${excerpt(t)}.`), ruled('no passive left', t => !/\bwas written|were checked\b/i.test(t) || 'It kept the passive.')],
    'Maria wrote the report. The team checked the results.', 'The report was written by Maria, and the team checked the results.'),
  writing('writing-proofread', 'Corrects spelling and grammar', 'Correct the spelling and grammar of this sentence and change nothing else: “Their going too the libary tomorow, weather or not it rains.”',
    [ruled('the corrected sentence', t => t.replace(/[“”"]/g, '').trim().replace(/\s+/g, ' ') === 'They’re going to the library tomorrow, whether or not it rains.' || t.replace(/[“”"]/g, '').trim().replace(/\s+/g, ' ') === "They're going to the library tomorrow, whether or not it rains." || `It wrote ${excerpt(t)}.`)],
    'They’re going to the library tomorrow, whether or not it rains.', 'There going to the library tomorrow, whether or not it rains.'),
  writing('writing-product', 'Writes to constraints', 'Write a product description for a hiking backpack in fewer than 50 words. It must mention that it is waterproof, has a 2-year warranty and costs $129, and use no exclamation marks.',
    [ruled('under 50 words', t => words(t) < 50 || `It ran to ${words(t)} words.`), ruled('mentions the three facts', t => (/waterproof/i.test(t) && /2-year|two-year|2 year|two year/i.test(t) && /\$129\b/.test(t)) || `It missed a fact: ${excerpt(t)}.`), ruled('no exclamation marks', t => !t.includes('!') || 'It used an exclamation mark.')],
    'Built for long days on wet trails, this 30-litre pack is fully waterproof, carries comfortably on padded straps and comes with a 2-year warranty, all for $129.', 'The best backpack ever! Waterproof and only $129!'),
  writing('writing-email', 'Turns notes into an email', 'Turn these notes into a short email to Priya, starting “Hi Priya,” and signed “Sam”: launch moved to 24 November; budget now $3,400; need her copy for the onboarding screens by Friday.',
    [ruled('starts “Hi Priya,”', t => /^hi priya,/i.test(t) || `It began ${excerpt(t.slice(0, 40))}.`), ruled('signed Sam', t => /\bSam\.?\s*$/.test(t) || 'It wasn’t signed Sam at the end.'), ruled('keeps the facts', t => (/24 November/.test(t) && /\$3,400/.test(t) && /friday/i.test(t)) || `It missed a fact: ${excerpt(t)}.`)],
    'Hi Priya,\n\nQuick update: the launch has moved to 24 November and the budget is now $3,400. Could you send me your copy for the onboarding screens by Friday?\n\nThanks,\nSam', 'Hello team, the launch moved. Thanks, Sam'),
  writing('writing-bullets', 'Summarises in a set form', `Summarise this notice in exactly three bullet points, each starting “- ” and each at most 15 words, including the closing dates and the branch to use: “${LONG}”`,
    [ruled('exactly three bullets', t => t.split('\n').filter(line => /^\s*-\s/.test(line)).length === 3 && t.split('\n').filter(line => line.trim()).length === 3 || `It wrote ${excerpt(t)}.`),
      ruled('each at most 15 words', t => t.split('\n').filter(line => line.trim()).every(line => words(line) <= 15) || 'A bullet ran over 15 words.'), ruled('keeps the dates and branch', t => (/7 December/.test(t) && /22 January/.test(t) && /Riverside/.test(t)) || `It missed a fact: ${excerpt(t)}.`)],
    '- Northgate Library closes from 7 December to 22 January for renovation.\n- Return loans to Riverside, open until 8 pm on weekdays.\n- Cards and holds work at every branch automatically.', '- The library is closing.\n- Use another branch.'),
  writing('writing-headline', 'Writes a headline to a limit', `Write a headline for this notice of at most 8 words, with no colon: “${LONG}”`,
    [ruled('at most 8 words', t => words(t) <= 8 || `It ran to ${words(t)} words.`), ruled('no colon', t => !t.includes(':') || 'It used a colon.'), ruled('one line', t => !t.includes('\n') || 'It wrote more than one line.'), ruled('names the library', t => /northgate|library/i.test(t) || `It said ${excerpt(t)}.`)],
    'Northgate Library closes for summer renovation', 'Library news: Northgate is closing for its big summer renovation project'),
];

// ── teaching (checked by rules) ──

const teaching = (id, title, ask, checks, good, wrong) => ({ id, taskKind: 'teaching', kind: 'ask', title, checkedBy: 'rules', ask, checks, script: [{ reply: good }], wrong });
const CAPITALS = { 'New South Wales': 'Sydney', Victoria: 'Melbourne', Queensland: 'Brisbane', 'Western Australia': 'Perth', Tasmania: 'Hobart' };
const TEACHING = [
  teaching('teaching-flashcards', 'Makes flashcards that are right', `Make one flashcard for the capital of each of ${Object.keys(CAPITALS).join(', ')}, as pairs of lines “Q: …” and “A: …”, and nothing else.`,
    [ruled('five cards', t => t.split('\n').filter(line => /^\s*Q:/.test(line)).length === 5 && t.split('\n').filter(line => /^\s*A:/.test(line)).length === 5 || `It wrote ${excerpt(t)}.`),
      ruled('every answer right', t => { const answers = t.split('\n').filter(line => /^\s*A:/.test(line)).join(' '); return Object.values(CAPITALS).every(city => answers.includes(city)) || `The answers were ${excerpt(answers)}.`; })],
    Object.entries(CAPITALS).map(([state, city]) => `Q: What is the capital of ${state}?\nA: ${city}`).join('\n'), Object.entries(CAPITALS).map(([state]) => `Q: What is the capital of ${state}?\nA: Canberra`).join('\n')),
  teaching('teaching-mark-working', 'Marks a student’s mistake', `A student wrote 1/2 + 1/3 = 2/5. Is that right? If not, say what went wrong, then give the right result. ${ANSWER_LINE}`,
    [says(/\b(no|not right|incorrect|wrong|isn’t right|isn't right)\b/i, 'says it isn’t right'), answerIs(5 / 6), ruled('explains the common denominator', t => /denominator|sixths|6ths|\b6\b/i.test(prose(t)) || 'It didn’t say why.')],
    'No. They added the tops and the bottoms. Fractions need a common denominator: 1/2 = 3/6 and 1/3 = 2/6, so the sum is 5/6.\nAnswer: 5/6', 'Yes, that’s right.\nAnswer: 2/5'),
  teaching('teaching-hint-only', 'Gives a hint without the answer', 'I’m stuck on 2x + 6 = 14. Don’t tell me the answer: give me one hint for the next step.',
    [ruled('keeps the answer back', t => !/x\s*=\s*4\b|\bis 4\b|\b4\b\s*$/.test(t) || 'It gave the answer away.'), ruled('points at the next step', t => /subtract|take away|minus|6 from both|both sides/i.test(t) || `It said ${excerpt(t)}.`)],
    'Try getting the x term on its own first: what happens if you take 6 away from both sides?', 'Subtract 6 to get 2x = 8, so x = 4.'),
  teaching('teaching-binary', 'Teaches a method step by step', `Teach me how to convert 45 to binary step by step. ${ANSWER_LINE}`,
    [answerSays(/^\W*101101\b/, 'the answer is 101101'), ruled('shows the steps', t => (prose(t).match(/\b(remainder|divide|÷|\/ ?2)\b/gi) || []).length >= 2 || 'It didn’t show the steps.')],
    'Divide by 2 and keep each remainder: 45 ÷ 2 = 22 remainder 1; 22 ÷ 2 = 11 remainder 0; 11 ÷ 2 = 5 remainder 1; 5 ÷ 2 = 2 remainder 1; 2 ÷ 2 = 1 remainder 0; 1 ÷ 2 = 0 remainder 1. Read the remainders from the bottom up.\nAnswer: 101101', 'Answer: 101011'),
  teaching('teaching-child', 'Explains at a child’s level', 'Explain what DNA is to a seven-year-old, in at most 60 words, with no technical terms.',
    [ruled('at most 60 words', t => words(t) <= 60 || `It ran to ${words(t)} words.`), ruled('no technical terms', t => !/deoxyribo|nucleotide|chromosome|nucleic|base pairs?/i.test(t) || `It used a technical term: ${excerpt(t)}.`)],
    'DNA is like a tiny recipe book inside every part of your body. It tells your body how to grow, what colour your eyes should be and lots more. You got half your recipes from your mum and half from your dad.', 'DNA, or deoxyribonucleic acid, is a molecule made of nucleotides arranged in base pairs along chromosomes.'),
  teaching('teaching-misconception', 'Corrects a misconception', 'A student thinks heavier objects fall faster than lighter ones in a vacuum. Correct them in at most two sentences.',
    [ruled('at most two sentences', t => (t.match(/[.!?](\s|$)/g) || []).length <= 2 || 'It ran over two sentences.'), ruled('says they fall together', t => /same (rate|speed|time|acceleration)|together|equally fast|at the same/i.test(t) || `It said ${excerpt(t)}.`)],
    'In a vacuum there is no air resistance, so every object falls with the same acceleration whatever its mass. A feather and a hammer dropped together land together.', 'You’re right that heavier things fall faster.'),
  teaching('teaching-derivative', 'Explains from first principles', `Using the limit definition of the derivative, show why the derivative of x² is 2x. ${ANSWER_LINE}`,
    [answerSays(/^\W*2\s*x\b/i, 'the answer is 2x'), ruled('uses the limit', t => /\blim|limit|h\s*→\s*0|h\s*->\s*0|tends to 0|approaches 0/i.test(prose(t)) || 'It didn’t use the limit.')],
    'f′(x) = lim as h → 0 of ((x + h)² − x²)/h = lim (2xh + h²)/h = lim (2x + h) = 2x.\nAnswer: 2x', 'The power rule says bring the 2 down.\nAnswer: x²'),
  teaching('teaching-quiz', 'Writes a quiz in a set form', 'Write three multiple-choice questions on photosynthesis. Give each question four options on their own lines, “A) …” to “D) …”, then its answer on a line “Correct: X”.',
    [ruled('three questions', t => (t.match(/^\s*Correct:\s*[A-D]\b/gim) || []).length === 3 || 'It didn’t give three answers.'), ruled('four options each', t => ['A', 'B', 'C', 'D'].every(letter => (t.match(new RegExp(`^\\s*${letter}\\)`, 'gm')) || []).length === 3) || 'It didn’t give four options to each question.'),
      ruled('on photosynthesis', t => /chlorophyll|carbon dioxide|CO2|CO₂|glucose|sunlight|light energy|oxygen/i.test(t) || `It wasn’t about photosynthesis: ${excerpt(t)}.`)],
    ['Which gas do plants take in for photosynthesis?\nA) Oxygen\nB) Carbon dioxide\nC) Nitrogen\nD) Helium\nCorrect: B', 'Which pigment absorbs light?\nA) Chlorophyll\nB) Haemoglobin\nC) Melanin\nD) Keratin\nCorrect: A', 'What sugar does photosynthesis make?\nA) Lactose\nB) Sucrose\nC) Glucose\nD) Maltose\nCorrect: C'].join('\n\n'),
    'Which gas do plants take in?\nA) Oxygen\nB) Carbon dioxide\nCorrect: B'),
];

export const NEW_TASKS = [...MATHS, ...CIRCUITS, ...VISION, ...WRITING, ...TEACHING];
export const KIND_SETS = ['code', 'maths', 'circuits', 'data', 'business', 'writing', 'vision', 'teaching'];

// Every task of a kind: the tagged ones from the existing tasks, then the new ones.
export function tasksOfKind(kind) {
  const tagged = (TAGGED[kind] || []).map(id => { const task = TASKS.find(item => item.id === id); if (!task) throw new Error(`No eval task called ${id}`); return { ...task, taskKind: kind }; });
  return [...tagged, ...NEW_TASKS.filter(task => task.taskKind === kind)];
}
