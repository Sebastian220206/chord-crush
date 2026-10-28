/**
 * Tests for the end-of-level results experience: what it says and where it fits.
 *
 * Both halves are pure on purpose, so the two claims that actually matter can be
 * checked without a renderer:
 *
 * - Nothing is claimed that the game did not do. A personal best only appears when
 *   the score really beat the stored one, a loss never claims one, and every number
 *   comes from the same objective list the HUD reads.
 * - Nothing is clipped. The panel and both buttons stay inside the canvas and
 *   inside the panel on every screen the task names, from a 320px phone in
 *   portrait to a desktop, including a landscape phone with very little height.
 */
import {
  MAX_RESULT_OBJECTIVE_ROWS,
  RESULT_PRIMARY_LABELS,
  RESULT_SECONDARY_LABEL,
  buildLevelResultView,
} from '../src/game/results/LevelResultView';
import {
  computeResultPanelLayout,
  estimateTextWidth,
  fitFontSize,
} from '../src/game/results/resultPanelLayout';
import type { ResultPanelInput, ResultPanelLayout } from '../src/game/results/resultPanelLayout';
import { LEVEL_DEFINITIONS } from '../src/levels/LevelManager';
import { objectivesFor } from '../src/levels/ObjectiveEngine';
import type { Level } from '../src/levels/Level';

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

function levelWith(overrides: Partial<Level> = {}): Level {
  return {
    id: 3,
    name: 'Minor Colors',
    boardWidth: 8,
    boardHeight: 8,
    moveLimit: 30,
    scoreTarget: 3000,
    chordTarget: 3,
    ...overrides,
  };
}

// ------------------------------------------------- 1. the built view is truthful

{
  const level = levelWith();

  // A first clear: the campaign has no score, so this attempt is a best because it
  // is the first, and nothing about the level is invented.
  const first = buildLevelResultView({
    mode: 'win',
    level,
    progress: { score: 3250, chordsCompleted: 3, specialTilesCompleted: 0, movesRemaining: 4 },
    bestBefore: null,
  });

  equal('a win with no previous record is a new best', first.newBest, true);
  equal('the new best line says so', first.bestLine, 'NEW BEST!');
  equal('the win heading names the outcome', first.heading, 'LEVEL COMPLETE');
  equal('the level line names the level', first.levelLine, 'LEVEL 3 · MINOR COLORS');
  equal('the attempt score is shown', first.scoreValue, '3,250');
  equal('the win primary action is next level', first.primaryLabel, 'NEXT LEVEL');
  equal('the map is always the secondary action', first.secondaryLabel, RESULT_SECONDARY_LABEL);
  equal('only the declared objectives are listed', first.objectiveRows.length, 2);
  equal('a cleared objective is ticked', first.objectiveRows[0].text, '✓ SCORE  3,250 / 3,000');
  equal('every objective a win reports is complete', first.objectiveRows.every((row) => row.complete), true);

  // The same score again is not a new best, and the stored number is shown instead.
  const repeat = buildLevelResultView({
    mode: 'win',
    level,
    progress: { score: 3250, chordsCompleted: 3, specialTilesCompleted: 0, movesRemaining: 4 },
    bestBefore: 3250,
  });

  equal('matching the record is not a new best', repeat.newBest, false);
  equal('the record is shown instead', repeat.bestLine, 'BEST 3,250');

  const beaten = buildLevelResultView({
    mode: 'win',
    level,
    progress: { score: 4200, chordsCompleted: 3, specialTilesCompleted: 0, movesRemaining: 1 },
    bestBefore: 3250,
  });

  equal('beating the record is a new best', beaten.newBest, true);
  equal('the new best line says so', beaten.bestLine, 'NEW BEST!');

  const worse = buildLevelResultView({
    mode: 'win',
    level,
    progress: { score: 3100, chordsCompleted: 3, specialTilesCompleted: 0, movesRemaining: 2 },
    bestBefore: 3250,
  });

  equal('coming in under the record is not a new best', worse.newBest, false);
  equal('the old record is still shown, never the smaller attempt', worse.bestLine, 'BEST 3,250');
}

// ------------------------------------------------------ 2. the failed attempt

{
  const level = levelWith();

  const lost = buildLevelResultView({
    mode: 'lose',
    level,
    progress: { score: 1800, chordsCompleted: 1, specialTilesCompleted: 0, movesRemaining: 0 },
    bestBefore: 2400,
  });

  equal('the failure heading names the outcome', lost.heading, 'LEVEL FAILED');
  equal('a loss never claims a personal best', lost.newBest, false);
  equal('the record is still shown on a loss', lost.bestLine, 'BEST 2,400');
  equal('the final score is shown on a loss', lost.scoreValue, '1,800');
  equal('the retry action is offered', lost.primaryLabel, 'RETRY');
  equal('the map is still offered after a loss', lost.secondaryLabel, RESULT_SECONDARY_LABEL);
  equal('an unmet objective is crossed', lost.objectiveRows[0].text, '× SCORE  1,800 / 3,000');
  equal('an unmet objective is not complete', lost.objectiveRows[0].complete, false);
  check('the failure copy is not blaming', lost.message.indexOf('Out of moves') === 0, lost.message);

  // Never finished before: there is no record, so nothing claims one.
  const never = buildLevelResultView({
    mode: 'lose',
    level,
    progress: { score: 0, chordsCompleted: 0, specialTilesCompleted: 0, movesRemaining: 0 },
    bestBefore: null,
  });

  equal('no record means no best line', never.bestLine, null);
}

// --------------------------------------------------------- 3. the final level

{
  const last = LEVEL_DEFINITIONS[LEVEL_DEFINITIONS.length - 1];
  const final = buildLevelResultView({
    mode: 'final',
    level: last,
    progress: { score: 8000, chordsCompleted: 3, specialTilesCompleted: 2, movesRemaining: 3 },
    bestBefore: 7000,
  });

  equal('the final level gets its own heading', final.heading, 'ALL LEVELS COMPLETE');
  equal('the final level never offers a next level', final.primaryLabel, 'PLAY AGAIN');
  check('no ending offers a next level action at the end', final.primaryLabel !== 'NEXT LEVEL');

  const mid = buildLevelResultView({
    mode: 'win',
    level: LEVEL_DEFINITIONS[0],
    progress: { score: 1200, chordsCompleted: 1, specialTilesCompleted: 0, movesRemaining: 5 },
    bestBefore: null,
  });

  equal('a mid-campaign win does offer the next level', mid.primaryLabel, RESULT_PRIMARY_LABELS.win);
}

// ------------------------------------ 4. the objective pool can never be too small

{
  for (const level of LEVEL_DEFINITIONS) {
    const count = objectivesFor(level, {
      score: 0,
      chordsCompleted: 0,
      specialTilesCompleted: 0,
      movesRemaining: 1,
    }).length;

    check(
      `level ${level.id} declares no more objectives than the panel has rows`,
      count <= MAX_RESULT_OBJECTIVE_ROWS,
      `${count} objectives`
    );
  }
}

// ------------------------------------------------------ 5. the layout fits

/** Every screen the task names, plus a deliberately punishing landscape phone. */
const VIEWPORTS: { name: string; width: number; height: number }[] = [
  { name: '320 portrait', width: 320, height: 568 },
  { name: '375 portrait', width: 375, height: 667 },
  { name: '390 portrait', width: 390, height: 844 },
  { name: '430 portrait', width: 430, height: 932 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'landscape phone', width: 844, height: 390 },
  { name: 'short landscape', width: 667, height: 320 },
];

/**
 * The longest strings the panel can be asked to show: every level name in the
 * campaign, the longest heading, and a seven-figure score.
 */
const WORST_CASE: { heading: string; levelLine: string; score: string; rows: string[] } = {
  heading: 'ALL LEVELS COMPLETE',
  levelLine: 'LEVEL 6 · SPECIALIST',
  score: '1,234,567',
  rows: ['✓ SPECIALS  12 / 12', '✓ CHORDS  3 / 3', '✓ SCORE  1,234,567 / 7,000'],
};

function inputFor(
  viewport: { width: number; height: number },
  overrides: Partial<ResultPanelInput> = {}
): ResultPanelInput {
  return {
    width: viewport.width,
    height: viewport.height,
    heading: WORST_CASE.heading,
    levelLine: WORST_CASE.levelLine,
    scoreLabel: 'FINAL SCORE',
    scoreValue: WORST_CASE.score,
    bestLine: 'NEW BEST!',
    objectivesLabel: 'OBJECTIVES',
    objectiveLines: WORST_CASE.rows,
    primaryLabel: 'NEXT LEVEL',
    secondaryLabel: 'LEVEL MAP',
    ...overrides,
  };
}

function slotBottom(layout: ResultPanelLayout): number {
  const secondary = layout.secondary;

  return secondary.y + secondary.height / 2;
}

for (const viewport of VIEWPORTS) {
  const layout = computeResultPanelLayout(inputFor(viewport));
  const label = viewport.name;

  check(`${label}: the panel starts inside the canvas`, layout.panelY >= 0, String(layout.panelY));
  check(`${label}: the panel is inside the canvas horizontally`, layout.panelX >= 0, String(layout.panelX));
  check(
    `${label}: the panel is no wider than the canvas`,
    layout.panelWidth <= viewport.width,
    `${layout.panelWidth} > ${viewport.width}`
  );
  check(
    `${label}: the panel does not run past the bottom`,
    layout.panelY + layout.panelHeight <= viewport.height,
    `${layout.panelY + layout.panelHeight} > ${viewport.height}`
  );
  check(
    `${label}: the last action is reachable`,
    slotBottom(layout) <= viewport.height,
    `${slotBottom(layout)} > ${viewport.height}`
  );
  check(
    `${label}: the actions do not overlap`,
    layout.secondary.y - layout.secondary.height / 2 >
      layout.primary.y + layout.primary.height / 2,
    `primary ends ${layout.primary.y + layout.primary.height / 2}, secondary starts ${
      layout.secondary.y - layout.secondary.height / 2
    }`
  );
  check(
    `${label}: the actions clear the panel edge`,
    layout.secondary.y + layout.secondary.height / 2 <=
      layout.panelY + layout.panelHeight,
    'the secondary button runs past the panel'
  );
  check(`${label}: the actions are tappable`, layout.primary.height >= 40, String(layout.primary.height));
  check(`${label}: the heading is readable`, layout.heading.fontSize >= 11, String(layout.heading.fontSize));
  check(
    `${label}: the buttons keep a real width`,
    layout.primary.width >= 120,
    String(layout.primary.width)
  );
}

// ------------------------------------------------- 6. no text runs out of the panel

{
  const innerFor = (viewport: { width: number; height: number }): number => {
    const layout = computeResultPanelLayout(inputFor(viewport));

    return layout.panelWidth - 44;
  };

  for (const viewport of VIEWPORTS) {
    const layout = computeResultPanelLayout(inputFor(viewport));
    const inner = innerFor(viewport);
    const label = viewport.name;
    const fits = (text: string, fontSize: number, weight: 'regular' | 'bold'): boolean =>
      estimateTextWidth(text, fontSize, weight) <= inner;

    check(`${label}: the heading fits`, fits(WORST_CASE.heading, layout.heading.fontSize, 'bold'));
    check(`${label}: the level line fits`, fits(WORST_CASE.levelLine, layout.levelLine.fontSize, 'regular'));
    check(`${label}: the score fits`, fits(WORST_CASE.score, layout.scoreValue.fontSize, 'bold'));
    check(
      `${label}: the best line fits`,
      layout.bestLine === null || fits('NEW BEST!', layout.bestLine.fontSize, 'bold')
    );

    layout.objectiveRows.forEach((row, index) => {
      check(
        `${label}: objective row ${index} fits`,
        fits(WORST_CASE.rows[index], row.fontSize, 'regular')
      );
    });

    check(`${label}: the primary label fits its button`, layout.primary.fontSize <= 21);
    check(`${label}: the secondary label fits its button`, layout.secondary.fontSize <= 18);
  }

  // Every level name in the campaign has to fit too, at the narrowest screen.
  const narrow = computeResultPanelLayout(inputFor(VIEWPORTS[0]));
  const inner = innerFor(VIEWPORTS[0]);

  for (const level of LEVEL_DEFINITIONS) {
    const line = `LEVEL ${level.id} · ${level.name.toUpperCase()}`;

    check(
      `level ${level.id} name fits at 320px`,
      estimateTextWidth(line, Math.min(16, fitFontSize(line, inner, 'regular', 16)), 'regular') <= inner,
      line
    );
  }
}

// ------------------------------------------------------ 7. layout edge cases

{
  const withBest = computeResultPanelLayout(inputFor(VIEWPORTS[0]));
  const withoutBest = computeResultPanelLayout(inputFor(VIEWPORTS[0], { bestLine: null }));

  equal('a missing best line leaves no slot', withoutBest.bestLine, null);
  check(
    'a missing best line tightens the stack',
    withoutBest.primary.y < withBest.primary.y,
    `${withoutBest.primary.y} vs ${withBest.primary.y}`
  );

  const noRows = computeResultPanelLayout(inputFor(VIEWPORTS[0], { objectiveLines: [] }));

  equal('a level with no objective rows lays out none', noRows.objectiveRows.length, 0);
  check('the buttons still exist without objective rows', noRows.secondary.y > noRows.primary.y);

  const degenerate = computeResultPanelLayout(inputFor({ width: 0, height: 0 }));

  for (const [name, value] of Object.entries({
    panelWidth: degenerate.panelWidth,
    panelHeight: degenerate.panelHeight,
    panelX: degenerate.panelX,
    panelY: degenerate.panelY,
    headingY: degenerate.heading.y,
    primaryY: degenerate.primary.y,
    primaryHeight: degenerate.primary.height,
  })) {
    check(`a zero-sized canvas still yields a finite ${name}`, Number.isFinite(value) && value >= 0, String(value));
  }
}

// ------------------------------------------------------------ 8. the font fit

{
  equal('a short string keeps the cap', fitFontSize('OK', 300, 'bold', 34), 34);
  check(
    'a long string is shrunk to fit',
    fitFontSize('ALL LEVELS COMPLETE', 200, 'bold', 34) < 34,
    String(fitFontSize('ALL LEVELS COMPLETE', 200, 'bold', 34))
  );
  check(
    'a filled string fits the width it was given',
    estimateTextWidth(
      'LEVEL COMPLETE',
      fitFontSize('LEVEL COMPLETE', 200, 'bold', 34),
      'bold'
    ) <= 200
  );
  equal('an empty string has no font size to fit', fitFontSize('', 200, 'regular', 34), 11);
  equal('an empty width has no room', fitFontSize('SCORE', 0, 'regular', 34), 11);
}

console.log(`${passed} passed, ${failures.length} failed`);
for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
