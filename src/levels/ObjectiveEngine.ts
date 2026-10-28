import type { Level } from './Level';

/**
 * Everything an objective can be measured against.
 *
 * This is a snapshot rather than a live reference, so the engine can be asked
 * hypothetical questions ("would this win if the score were 3000?") without
 * touching the real game. GameState is the only thing that produces one.
 */
export interface ObjectiveProgress {
  score: number;
  chordsCompleted: number;
  specialTilesCompleted: number;
  movesRemaining: number;
}

export type ObjectiveKind = 'score' | 'chords' | 'specialTiles';

export interface ObjectiveState {
  kind: ObjectiveKind;
  /** Uppercase HUD label, e.g. SCORE or CHORDS. */
  label: string;
  target: number;
  current: number;
  complete: boolean;
}

export type LevelOutcome = 'playing' | 'won' | 'lost';

/**
 * Builds the objective list for a level.
 *
 * Only the objectives the level actually declares are returned, which is what
 * keeps the HUD from showing an empty SPECIALS row on a level with no special
 * tile target. The score target is mandatory, so the list is never empty and
 * "all complete" can never be true by accident.
 */
export function objectivesFor(level: Level, progress: ObjectiveProgress): ObjectiveState[] {
  const objectives: ObjectiveState[] = [
    {
      kind: 'score',
      label: 'SCORE',
      target: level.scoreTarget,
      current: progress.score,
      complete: progress.score >= level.scoreTarget,
    },
  ];

  if (level.chordTarget !== undefined) {
    objectives.push({
      kind: 'chords',
      label: 'CHORDS',
      target: level.chordTarget,
      current: progress.chordsCompleted,
      complete: progress.chordsCompleted >= level.chordTarget,
    });
  }

  if (level.specialTileTarget !== undefined) {
    objectives.push({
      kind: 'specialTiles',
      label: 'SPECIALS',
      target: level.specialTileTarget,
      current: progress.specialTilesCompleted,
      complete: progress.specialTilesCompleted >= level.specialTileTarget,
    });
  }

  return objectives;
}

/**
 * Finds one objective in a built list, or null when the level does not declare it.
 *
 * This is how the HUD asks "does this level have a special tile target?" without
 * inventing a placeholder row for levels that do not.
 */
export function findObjective(
  objectives: ObjectiveState[],
  kind: ObjectiveKind
): ObjectiveState | null {
  for (const objective of objectives) {
    if (objective.kind === kind) return objective;
  }

  return null;
}

/**
 * True only when every objective the level declares is satisfied.
 *
 * Objectives combine with AND: a level asking for 2000 points and 3 chords is
 * not won with 3000 points and one chord.
 */
export function isLevelComplete(level: Level, progress: ObjectiveProgress): boolean {
  const objectives = objectivesFor(level, progress);

  return objectives.length > 0 && objectives.every((objective) => objective.complete);
}

/**
 * True when the player has spent their last move without completing the level.
 *
 * Losing needs the moves to be gone *and* the objectives unmet. Both halves
 * matter: a completed level stays a win even on the final move.
 */
export function isLevelFailed(level: Level, progress: ObjectiveProgress): boolean {
  return progress.movesRemaining <= 0 && !isLevelComplete(level, progress);
}

/**
 * The level's status right now.
 *
 * Completion is checked first so a level finished on the last move is a win
 * rather than a loss.
 */
export function levelOutcome(level: Level, progress: ObjectiveProgress): LevelOutcome {
  if (isLevelComplete(level, progress)) return 'won';
  if (isLevelFailed(level, progress)) return 'lost';

  return 'playing';
}

/**
 * Thousands separators for the HUD and the win screen: 3250 becomes "3,250".
 *
 * Written by hand rather than with toLocaleString so the format does not shift
 * with the browser's locale.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';

  const digits = String(Math.max(0, Math.floor(value)));
  let formatted = '';

  for (let index = 0; index < digits.length; index++) {
    if (index > 0 && (digits.length - index) % 3 === 0) formatted += ',';
    formatted += digits.charAt(index);
  }

  return formatted;
}

/**
 * Returns the [1-star, 2-star, 3-star] score thresholds for a level.
 */
export function starThresholdsFor(level: Level): [number, number, number] {
  const base = Math.max(100, level.scoreTarget);
  return [
    base,
    Math.round((base * 1.45) / 50) * 50,
    Math.round((base * 2.0) / 50) * 50,
  ];
}

/**
 * Computes how many stars (0..3) a completed level score earns.
 */
export function starsForScore(level: Level, score: number | null): 0 | 1 | 2 | 3 {
  if (score === null || !Number.isFinite(score) || score < level.scoreTarget) return 0;
  const [, twoStar, threeStar] = starThresholdsFor(level);
  if (score >= threeStar) return 3;
  if (score >= twoStar) return 2;
  return 1;
}
