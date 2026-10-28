/**
 * Tests for the ChordEngine, progressive ChordBuilder, star ratings, and hint bridge.
 */
import {
  ChordBuilder,
  analyzeChord,
  canFormTriadPair,
  detectChord,
  findCompletingNotes,
} from '../src/game/music/ChordEngine';
import { chordLabel } from '../src/game/music/Chord';
import type { Chord } from '../src/game/music/Chord';
import { starThresholdsFor, starsForScore } from '../src/levels/ObjectiveEngine';
import { LEVEL_DEFINITIONS } from '../src/levels/LevelManager';
import { GameBridge } from '../src/game/GameBridge';

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;

    return;
  }

  failures.push(`${name}${detail ? ` -- ${detail}` : ''}`);
}

function equal(name: string, actual: unknown, expected: unknown): void {
  check(name, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`);
}

function labelOrNull(chord: Chord | null): string | null {
  return chord ? chordLabel(chord) : null;
}

// ------------------------------------------------ 1. diatonic triad detection

{
  equal('1 C-E-G is C Major', labelOrNull(detectChord(['C', 'E', 'G'])), 'C Major');
  equal('1a D-F-A is D Minor', labelOrNull(detectChord(['D', 'F', 'A'])), 'D Minor');
  equal('1b E-G-B is E Minor', labelOrNull(detectChord(['E', 'G', 'B'])), 'E Minor');
  equal('1c F-A-C is F Major', labelOrNull(detectChord(['F', 'A', 'C'])), 'F Major');
  equal('1d G-B-D is G Major', labelOrNull(detectChord(['G', 'B', 'D'])), 'G Major');
  equal('1e A-C-E is A Minor', labelOrNull(detectChord(['A', 'C', 'E'])), 'A Minor');
  equal('1f B-D-F is B Diminished', labelOrNull(detectChord(['B', 'D', 'F'])), 'B Diminished');

  const analysis = analyzeChord(['C', 'E', 'G', 'C']);
  check('1g analyzeChord returns C Major details', analysis.chord !== null);
  equal('1h analyzeChord root', analysis.chord?.root, 'C');
  equal('1i analyzeChord quality', analysis.chord?.quality, 'major');
}

// ------------------------------------------------ 2. triad pair helpers

{
  check('2 C and E can form a triad', canFormTriadPair('C', 'E'));
  check('2a C and D cannot form a diatonic triad', !canFormTriadPair('C', 'D'));

  const completionsCE = findCompletingNotes(['C', 'E']);
  equal('2b C and E can be completed by G or A', completionsCE.join(','), 'G,A');

  const completionsDF = findCompletingNotes(['D', 'F']);
  equal('2c D and F can be completed by A or B', completionsDF.join(','), 'A,B');
}

// ------------------------------------------------ 3. progressive ChordBuilder

{
  const builder = new ChordBuilder();

  equal('3 fresh builder is empty', builder.getNotes().length, 0);

  // Move 1: match 3 Cs
  const step1 = builder.ingestStageNotes(['C', 'C', 'C']);
  equal('3a single note match does not complete a chord yet', step1.chord, null);
  equal('3b builder holds C', builder.getNotes().join(','), 'C');

  // Move 2: match 3 Es
  const step2 = builder.ingestStageNotes(['E', 'E', 'E']);
  equal('3c two notes do not complete a chord yet', step2.chord, null);
  equal('3d builder holds C,E', builder.getNotes().join(','), 'C,E');
  equal('3e needed notes for C,E are G,A', builder.getNeededNotes().join(','), 'G,A');

  // Move 3: match 3 Gs -> completes C Major!
  const step3 = builder.ingestStageNotes(['G', 'G', 'G']);
  check('3f third compatible note completes a triad', step3.chord !== null);
  equal('3g completed chord is C Major', labelOrNull(step3.chord), 'C Major');
  equal('3h builder resets after completing a chord', builder.getNotes().length, 0);
}

// ------------------------------------------------ 4. ChordBuilder handles incompatible note shifts

{
  const builder = new ChordBuilder();

  // Start with C
  builder.ingestStageNotes(['C', 'C', 'C']);
  // Next match is D (C and D cannot share any diatonic triad)
  const step2 = builder.ingestStageNotes(['D', 'D', 'D']);
  equal('4 incompatible second note does not complete a chord', step2.chord, null);
  equal('4a builder pivots to D', builder.getNotes().join(','), 'D');

  // Next match is F (D and F share D Minor / B Diminished)
  builder.ingestStageNotes(['F', 'F', 'F']);
  equal('4b builder now holds D,F', builder.getNotes().join(','), 'D,F');

  // Next match is A -> completes D Minor!
  const step4 = builder.ingestStageNotes(['A', 'A', 'A']);
  equal('4c D-F-A completes D Minor', labelOrNull(step4.chord), 'D Minor');
}

// ------------------------------------------------ 5. ChordBuilder instant 3-note cascade stage

{
  const builder = new ChordBuilder();
  const instant = builder.ingestStageNotes(['F', 'A', 'C', 'F']);
  equal('5 a stage containing F, A, C immediately triggers F Major', labelOrNull(instant.chord), 'F Major');
  equal('5a builder is empty after instant chord', builder.getNotes().length, 0);
}

// ------------------------------------------------ 6. star ratings and thresholds

{
  const level1 = LEVEL_DEFINITIONS[0];
  const [oneStar, twoStar, threeStar] = starThresholdsFor(level1);

  equal('6 1-star threshold equals scoreTarget', oneStar, level1.scoreTarget);
  check('6a 2-star threshold is higher than 1-star', twoStar > oneStar);
  check('6b 3-star threshold is higher than 2-star', threeStar > twoStar);

  equal('6c below target earns 0 stars', starsForScore(level1, oneStar - 1), 0);
  equal('6d at 1-star threshold earns 1 star', starsForScore(level1, oneStar), 1);
  equal('6e at 2-star threshold earns 2 stars', starsForScore(level1, twoStar), 2);
  equal('6f at 3-star threshold earns 3 stars', starsForScore(level1, threeStar), 3);
}

// ------------------------------------------------ 7. GameBridge hint requests

{
  const bridge = new GameBridge();
  let hints = 0;
  const unsub = bridge.onHintRequest(() => {
    hints++;
  });

  bridge.requestHint();
  bridge.requestHint();
  equal('7 hint requests reach the listener', hints, 2);

  unsub();
  bridge.requestHint();
  equal('7a unsubscribed hint listener stops receiving', hints, 2);
}

console.log(`${passed} passed, ${failures.length} failed`);
for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
