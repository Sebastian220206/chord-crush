/**
 * The words and numbers the end-of-level panel shows.
 *
 * Everything here is derived, never invented: the heading comes from which ending
 * actually happened, the score from GameState, the objective rows from
 * ObjectiveEngine (the same list the HUD reads), and the best line from the
 * campaign's own record. If a fact is not available it is left out rather than
 * guessed at, which is what keeps the panel from promising a player something the
 * game did not do.
 *
 * Pure: no Phaser, no React, so the wording can be tested without a renderer.
 */

import { formatNumber, objectivesFor } from '../../levels/ObjectiveEngine';
import type { ObjectiveProgress, ObjectiveState } from '../../levels/ObjectiveEngine';
import type { Level } from '../../levels/Level';

/** Which end-of-level screen this is. Mirrors the scene's overlay modes minus 'none'. */
export type ResultMode = 'win' | 'final' | 'lose';

export interface ResultObjectiveRow {
  /** Uppercase objective label, e.g. SCORE. */
  label: string;
  current: number;
  target: number;
  /** True when this objective's target was met in the attempt being reported. */
  complete: boolean;
  /**
   * "✓ SCORE  3,250 / 1,000".
   *
   * The mark is the primary read: a player who cannot tell gold from teal still
   * sees which objectives were met. The two numbers carry the same fact a second
   * time, so even a glyph that a system font cannot draw cannot hide the result.
   */
  text: string;
}

/** Everything the panel needs, already decided. */
export interface LevelResultView {
  mode: ResultMode;
  /** The one heading: LEVEL COMPLETE, ALL LEVELS COMPLETE or LEVEL FAILED. */
  heading: string;
  /** "LEVEL 3 · MINOR COLORS" — where this happened, from the level itself. */
  levelLine: string;
  /** "FINAL SCORE" or "YOUR SCORE". */
  scoreLabel: string;
  /** The attempt's score, formatted. */
  scoreValue: string;
  /** "NEW BEST!" or "BEST 3,000", or null when there is no record to show. */
  bestLine: string | null;
  /** True only when this attempt beat the stored best. */
  newBest: boolean;
  objectivesLabel: string;
  objectiveRows: ResultObjectiveRow[];
  /** The one encouraging line. Never blames the player. */
  message: string;
  primaryLabel: string;
  secondaryLabel: string;
}

/**
 * One slot per objective kind ObjectiveEngine can produce (score, chords,
 * specials), so a panel pool of this size can never drop a real objective.
 */
export const MAX_RESULT_OBJECTIVE_ROWS = 3;

/** The heading for each ending. The wording, not the colour, carries the verdict. */
export const RESULT_HEADINGS: Record<ResultMode, string> = {
  win: 'LEVEL COMPLETE',
  final: 'ALL LEVELS COMPLETE',
  lose: 'LEVEL FAILED',
};

/**
 * What the primary button does, per ending.
 *
 * 'final' offers another run rather than a next level, because there is no next
 * level: a continue action here would be a promise the campaign cannot keep.
 */
export const RESULT_PRIMARY_LABELS: Record<ResultMode, string> = {
  win: 'NEXT LEVEL',
  final: 'PLAY AGAIN',
  lose: 'RETRY',
};

/** The map is one press away from every ending, so the label never changes. */
export const RESULT_SECONDARY_LABEL = 'LEVEL MAP';

export interface LevelResultInput {
  mode: ResultMode;
  level: Level;
  progress: ObjectiveProgress;
  /**
   * The level's best score *before* this attempt was recorded — the campaign's
   * own number, or null when the level has never been finished.
   *
   * Passed in rather than read here for two reasons. It keeps this function pure,
   * and it lets the caller capture the value before ProgressionManager.completeLevel
   * raises it: read afterwards, "was this a personal best?" would compare the
   * attempt's score with itself and always answer no.
   */
  bestBefore: number | null;
}

/**
 * Builds the panel's content from real state.
 *
 * The mode is passed in rather than re-derived, because the scene has already
 * decided the outcome through ObjectiveEngine.levelOutcome and recorded it in
 * GameState; asking a second time would give the UI a chance to disagree with the
 * rule that the player actually played under.
 */
export function buildLevelResultView(input: LevelResultInput): LevelResultView {
  const { mode, level, progress, bestBefore } = input;
  const score = Math.max(0, Math.floor(progress.score));
  const newBest = isNewBest(mode, score, bestBefore);

  return {
    mode,
    heading: RESULT_HEADINGS[mode],
    levelLine: `LEVEL ${level.id} · ${level.name.toUpperCase()}`,
    scoreLabel: mode === 'lose' ? 'YOUR SCORE' : 'FINAL SCORE',
    scoreValue: formatNumber(score),
    bestLine: bestLineFor(newBest, bestBefore),
    newBest,
    objectivesLabel: 'OBJECTIVES',
    objectiveRows: objectivesFor(level, progress).map(toResultRow),
    message: messageFor(mode, progress),
    primaryLabel: RESULT_PRIMARY_LABELS[mode],
    secondaryLabel: RESULT_SECONDARY_LABEL,
  };
}

/**
 * A personal best is only claimed when it is real.
 *
 * A loss is never a best: the scene does not record one, so claiming it would be
 * inventing progression. Equal to the stored best is not better than it.
 */
function isNewBest(mode: ResultMode, score: number, bestBefore: number | null): boolean {
  if (mode === 'lose') return false;
  if (score <= 0) return false;

  return bestBefore === null || score > bestBefore;
}

/** The best line, or null when there is nothing to claim and no record to show. */
function bestLineFor(newBest: boolean, bestBefore: number | null): string | null {
  if (newBest) return 'NEW BEST!';
  if (bestBefore === null) return null;

  return `BEST ${formatNumber(bestBefore)}`;
}

function toResultRow(objective: ObjectiveState): ResultObjectiveRow {
  const mark = objective.complete ? '✓' : '×';

  return {
    label: objective.label,
    current: objective.current,
    target: objective.target,
    complete: objective.complete,
    text: `${mark} ${objective.label}  ${formatNumber(objective.current)} / ${formatNumber(
      objective.target
    )}`,
  };
}

/**
 * The encouraging line under the result.
 *
 * A loss says out of moves only when the moves really are gone, so the reason
 * shown always matches the rule that ended the attempt. Nothing here tells the
 * player they were bad at it.
 */
function messageFor(mode: ResultMode, progress: ObjectiveProgress): string {
  if (mode === 'win') return 'Every objective cleared. Nicely played.';
  if (mode === 'final') return 'You cleared every level in the campaign.';

  return progress.movesRemaining <= 0
    ? 'Out of moves. Give it another go.'
    : 'So close. Give it another go.';
}
