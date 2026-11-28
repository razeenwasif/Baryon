// Research's eval tasks (desktop/research/evals.mjs, stage 8.9): fixed questions whose answers are settled, so a round's
// hypotheses can be scored against a key. Each is small enough for one round on a low call cap. key: what a good answer
// says, each point found by any of its patterns in the leading hypotheses' statements and predictions; mistakes: what
// a live hypothesis shouldn't claim. Patterns are words (case aside) or regular expressions.

export interface ResearchCriterion {
  point: string;
  weight?: number;
  says: ReadonlyArray<string | RegExp>;
}

export interface ResearchTask {
  id: string;
  title: string;
  discipline: string;
  goal: string;
  key: readonly ResearchCriterion[];
  mistakes: readonly ResearchCriterion[];
}

export const RESEARCH_TASKS: readonly ResearchTask[] = Object.freeze([
  {
    id: 'sky-violet',
    title: 'Why is the daytime sky blue rather than violet?',
    discipline: 'physics',
    goal: 'Rayleigh scattering is stronger at shorter wavelengths, so why does the clear daytime sky look blue, not violet? Find the factors that set the hue and how much each matters.',
    key: [
      { point: 'Rayleigh scattering grows as λ⁻⁴', weight: 2, says: [/rayleigh/i, /λ\s*\^?\s*[-−]\s*4|lambda\s*\^?\s*-\s*4|\^\{?-4|inverse fourth|fourth power/i] },
      { point: 'the solar spectrum has less violet than blue', says: [/solar spectrum|sunlight'?s? spectrum|solar irradiance|blackbody|5[78]\d\d\s*K/i] },
      { point: 'the eye’s colour response decides the hue (cones, colour matching)', weight: 2, says: [/\bcones?\b|colou?r[- ]matching|\bCMF|tristimulus|chromaticity|\bCIE\b|photopic|luminosity function/i] },
      { point: 'the sky’s light is a mixture, perceived by its mix, not its peak', says: [/mix(?:ture|ing)?\b|dominant wavelength|white[- ]?light|desaturat|purity/i] },
      { point: 'ozone absorption plays a small part', says: [/ozone|chappuis/i] },
    ],
    mistakes: [
      { point: 'the sky reflects the ocean', says: [/reflect(?:s|ion of|ing)? (?:the )?(?:ocean|sea|water)/i] },
      { point: 'violet light is absorbed by the upper atmosphere and never reaches us', says: [/violet (?:light )?(?:is |gets )?(?:entirely |completely |all )?absorbed (?:high )?(?:in|by) the upper atmosphere/i] },
    ],
  },
  {
    id: 'ice-floats',
    title: 'Why does ice float on water?',
    discipline: 'chemistry',
    goal: 'Most solids are denser than their liquids, but ice floats on liquid water. Explain why, how large the effect is, and what it predicts about water near freezing.',
    key: [
      { point: 'hydrogen bonds hold the molecules in ice', weight: 2, says: [/hydrogen[- ]bond/i] },
      { point: 'ice’s lattice is open (hexagonal ice Ih, tetrahedral, four neighbours)', weight: 2, says: [/hexagonal|ice\s*I\s*h|\bIh\b|tetrahedr|open (?:lattice|structure|network)|four (?:nearest )?neighbou?rs/i] },
      { point: 'ice is about 9% less dense (0.917 against 1.000 g/cm³)', says: [/0\.91[67]|\b9\s*%|about 9 per ?cent|~\s*9\s*%/i] },
      { point: 'liquid water is densest near 4 °C', says: [/\b4\s*°?\s*C\b|3\.98|maximum density|density maximum/i] },
      { point: 'pressure lowers the melting point (Clausius–Clapeyron, negative slope)', says: [/clausius|clapeyron|negative slope|pressure (?:lowers|reduces|decreases) the melting/i] },
    ],
    mistakes: [
      { point: 'air bubbles make ice float', says: [/(?:air|gas) bubbles? (?:make|makes|cause|causes|let|lets) (?:the )?ice (?:to )?float/i] },
      { point: 'water molecules get bigger when they freeze', says: [/molecules? (?:get|become|grow) (?:bigger|larger)/i] },
    ],
  },
  {
    id: 'whip-crack',
    title: 'Why does a whip crack?',
    discipline: 'physics',
    goal: 'A bullwhip makes a loud crack when cracked. Find what makes the sound, why the tip gets so fast, and what the explanation predicts that could be measured.',
    key: [
      { point: 'part of the whip goes faster than sound (about 343 m/s)', weight: 2, says: [/supersonic|speed of sound|sound barrier|\b34[0-9]\s*m\s*\/?\s*s|mach\b/i] },
      { point: 'the crack is a shock wave, a small sonic boom', weight: 2, says: [/shock(?:wave| wave)?|sonic boom/i] },
      { point: 'a loop travels down the tapering whip, the energy carried by less and less mass', weight: 2, says: [/taper|travel(?:l)?ing (?:loop|wave)|loop (?:travels|moves|runs)|decreasing mass|less (?:and less )?mass|mass per (?:unit )?length/i] },
      { point: 'energy or momentum carried to the tip speeds it up', says: [/conserv(?:ation|ed) of (?:energy|momentum)|energy (?:is )?(?:concentrated|carried|transferred)|kinetic energy/i] },
      { point: 'high-speed filming or the sound’s timing can test it', says: [/high[- ]speed (?:camera|video|film|imaging)|schlieren|shadowgraph|microphone|frames? per second/i] },
    ],
    mistakes: [
      { point: 'the crack is the whip slapping itself', says: [/(?:leather|whip|cracker) (?:slap|slaps|hitting|hits|striking|strikes) (?:itself|against itself)/i] },
    ],
  },
]);

export const taskById = (id: string): ResearchTask | undefined => RESEARCH_TASKS.find(t => t.id === id);
