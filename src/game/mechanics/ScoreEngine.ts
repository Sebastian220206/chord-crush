import { SpecialType } from '../board/Tile';
import type { Chord } from '../music/Chord';

/**
 * Pure scoring rules for CHORD CRUSH.
 *
 * No Phaser, React, DOM or game state lives here: this file only turns
 * "how many tiles matched" and "how deep in the cascade are we" into points.
 */

/** Fewer matched tiles than this can never score. */
const MIN_SCORED_TILES = 3;

/** Base points per matched tile count, indexed directly by count. */
const BASE_POINTS_BY_SIZE: Record<number, number> = {
  3: 100,
  4: 150,
  5: 200,
  6: 250,
};

/** Awarded for 7 or more tiles, so huge runs stay bounded. */
const MAX_BASE_POINTS = 300;

/**
 * Base points for a single cascade stage, before the combo multiplier.
 * Returns 0 for anything too small to be a real match, or for a nonsense count.
 */
export function baseScoreForTiles(matchedTileCount: number): number {
  if (!Number.isFinite(matchedTileCount) || matchedTileCount < MIN_SCORED_TILES) return 0;

  const exact = BASE_POINTS_BY_SIZE[matchedTileCount];
  return exact === undefined ? MAX_BASE_POINTS : exact;
}

/**
 * Points for one cascade stage.
 *
 * The multiplier is the cascade level: the first match of a turn scores at x1,
 * the next at x2, and so on. A stage covering several independent matches is
 * scored on the combined number of unique tiles, which is what MatchEngine
 * returns after its own de-duplication, so no tile can ever score twice.
 */
export function calculateMatchScore(matchedTileCount: number, cascadeLevel: number): number {
  const base = baseScoreForTiles(matchedTileCount);
  if (base === 0) return 0;

  // Guard explicitly: Math.floor(NaN) is NaN, which would poison the total.
  const level = Number.isFinite(cascadeLevel) ? Math.floor(cascadeLevel) : 1;
  const multiplier = Math.max(1, level);

  return base * multiplier;
}

/** Awarded for each tile a match turns into a special tile. */
export const SPECIAL_CREATION_BONUS = 250;

/** Flat bonus for firing a line-clear, on top of the tiles it clears. */
export const LINE_CLEAR_ACTIVATION_BONUS = 300;

/** Flat bonus for detonating a color bomb, on top of the tiles it clears. */
export const COLOR_BOMB_ACTIVATION_BONUS = 400;

/**
 * Bonus for the special tiles a stage created.
 *
 * Separate from the match points so that promoting a tile never inflates the
 * score of the run that created it: the run still scores for the tiles that
 * were actually removed.
 */
export function calculateSpecialCreationBonus(specialsCreated: number): number {
  if (!Number.isFinite(specialsCreated) || specialsCreated <= 0) return 0;

  return SPECIAL_CREATION_BONUS * Math.floor(specialsCreated);
}

/**
 * Flat bonus for firing a special tile, or 0 for a plain match.
 *
 * The tiles a special tile clears are already scored by
 * calculateMatchScore, so this only rewards the activation itself. Deliberately
 * not multiplied by the cascade level, which keeps activation bonuses
 * predictable no matter how deep a cascade runs.
 */
export function calculateActivationBonus(type: SpecialType | null): number {
  if (type === 'line-clear') return LINE_CLEAR_ACTIVATION_BONUS;
  if (type === 'color-bomb') return COLOR_BOMB_ACTIVATION_BONUS;

  return 0;
}

/** Awarded for a major or minor triad. */
export const CHORD_BONUS = 50;

/**
 * Awarded for a diminished triad.
 *
 * Higher than the other qualities because it is the rarest coincidence on the
 * board: it needs B, D and F to clear together.
 */
export const DIMINISHED_CHORD_BONUS = 75;

/**
 * Points for a detected chord, or 0 when the notes did not form one.
 *
 * Major and minor deliberately share one value. Splitting them would need
 * rebalancing for a difference players cannot hear, whereas diminished earns its
 * extra because it is genuinely harder to stumble into.
 *
 * This is only ever *added* to the score for the stage. The tiles that formed
 * the chord are already scored by calculateMatchScore, so a chord can never pay
 * for the same tiles twice.
 */
export function calculateChordBonus(chord: Chord | null): number {
  if (chord === null) return 0;
  if (chord.quality === 'diminished') return DIMINISHED_CHORD_BONUS;

  return CHORD_BONUS;
}

/**
 * Longest chord chain multiplier, so a long cascade cannot run away with the
 * score. Five consecutive chords is already a rare enough event.
 */
export const CHORD_COMBO_MAX_MULTIPLIER = 5;

/**
 * Multiplier for the nth chord of a chain: x1, x2, x3 ... capped.
 *
 * Driven by how many chords have been detected so far in this move, so the
 * first chord of a move always starts again at x1.
 */
export function chordComboMultiplier(chainLength: number): number {
  if (!Number.isFinite(chainLength) || chainLength <= 0) return 1;

  return Math.min(Math.floor(chainLength), CHORD_COMBO_MAX_MULTIPLIER);
}

/**
 * The chord award for one link of a chain: base bonus times the chain
 * multiplier. With a 50 point base that gives 50, 100, 150, 200, then 250 for
 * every chord after the fifth.
 */
export function applyChordCombo(baseBonus: number, chainLength: number): number {
  if (!Number.isFinite(baseBonus) || baseBonus <= 0) return 0;

  return baseBonus * chordComboMultiplier(chainLength);
}
