import { Board } from '../board/Board';
import { Tile } from '../board/Tile';
import { findMatchGroups } from './MatchEngine';
import { createSpecialTiles, planMatchStage, StagePlan } from './SpecialTileEngine';
import { removeMatchedTiles } from './RemovalEngine';
import { applyGravity, TileFall } from './GravityEngine';
import { refillEmptyCells, RefilledTile } from './RefillEngine';

/**
 * Hard stop for a single turn. Random refill can in principle keep producing
 * matches, so the loop is bounded to guarantee the game can never soft-lock.
 */
export const MAX_CASCADE_DEPTH = 50;

/**
 * The visual side of a cascade, injected so this engine stays free of Phaser
 * and can be driven by a headless presenter in tests.
 *
 * Each method resolves only once its animation has fully finished, which is
 * what keeps the board and the visuals in step.
 */
export interface CascadePresenter {
  log(message: string): void;
  /**
   * Called once per cascade stage, before that stage's tiles are removed.
   *
   * Special tiles in `stage.specials` have already been written to the data
   * model, so the visuals can show them already, and the stage can be scored
   * against a still-intact tile list. `depth` is the 1-based cascade level,
   * which is what the score multiplier is based on.
   */
  onStage(stage: StagePlan, depth: number): void;
  /** Plays the tiles disappearing. Resolves when they are destroyed. */
  animateRemoval(tiles: Tile[]): Promise<void>;
  /** Plays existing tiles dropping into their new cells. */
  animateGravity(falls: TileFall[]): Promise<void>;
  /** Plays new tiles entering from above the board. */
  animateRefill(created: RefilledTile[]): Promise<void>;
}

export interface CascadeResult {
  /** Number of match/remove/gravity/refill cycles that ran. */
  depth: number;
  totalRemoved: number;
  /** Number of special tiles created across the whole cascade. */
  specialsCreated: number;
  /** True if the depth limit stopped the cascade early. */
  aborted: boolean;
}

/**
 * Runs the full post-match sequence and repeats it until the board is clear:
 *
 *   create specials -> remove -> gravity -> refill -> detect -> (repeat)
 *
 * Every phase is awaited in order, so the logical board never advances while the
 * previous animation is still on screen. The first stage is supplied by the
 * caller because it came from a player swap rather than from the board itself;
 * every later stage is planned here from fresh match detection.
 */
export async function runCascade(
  board: Board,
  presenter: CascadePresenter,
  firstStage: StagePlan
): Promise<CascadeResult> {
  let stage = firstStage;
  let depth = 0;
  let totalRemoved = 0;
  let specialsCreated = 0;
  let aborted = false;

  presenter.log('CASCADE START');

  while (stage.removals.length > 0) {
    if (depth >= MAX_CASCADE_DEPTH) {
      aborted = true;
      presenter.log(`CASCADE ABORTED: reached depth limit of ${MAX_CASCADE_DEPTH}`);
      break;
    }

    depth++;
    if (depth > 1) presenter.log(`CASCADE ${depth}`);
    presenter.log(`MATCH FOUND: ${stage.removals.length}`);

    // Special tiles are created in the data model before anything is reported or
    // animated, so the player sees the new special tile while the rest of its
    // run fades out.
    if (stage.specials.length > 0) {
      createSpecialTiles(stage.specials);
      specialsCreated += stage.specials.length;

      presenter.log(`CREATED ${stage.specials.length} SPECIAL TILE(S)`);
      for (const special of stage.specials) {
        const axis = special.orientation === null ? '' : ` ${special.orientation}`;
        presenter.log(
          `  ${special.type.toUpperCase()}${axis} at (${special.tile.row}, ${special.tile.column})`
        );
      }
    }

    if (stage.activation !== null) {
      presenter.log(`ACTIVATED ${stage.activation.toUpperCase()}`);
    }

    // Report the stage before anything is removed, so scoring happens exactly
    // once per cascade step against a still-intact tile list.
    presenter.onStage(stage, depth);

    // Animate the tiles out first, then clear them from the data. The await
    // guarantees gravity cannot start while removed tiles are still visible.
    await presenter.animateRemoval(stage.removals);

    const removed = removeMatchedTiles(board, stage.removals);
    totalRemoved += removed.length;
    presenter.log(`REMOVING: ${removed.length}`);

    const falls = applyGravity(board);
    presenter.log(`GRAVITY: ${falls.length} falling`);
    await presenter.animateGravity(falls);

    const spawned = refillEmptyCells(board);
    presenter.log(`REFILL: ${spawned.length}`);
    await presenter.animateRefill(spawned);

    // Nothing here comes from a player swap, so no cell is preferred and each
    // new special tile lands on the middle of the run that made it.
    stage = planMatchStage(board, findMatchGroups(board));

    if (stage.removals.length === 0) presenter.log('NO MORE MATCHES');
  }

  presenter.log(aborted ? 'CASCADE STOPPED' : 'CASCADE COMPLETE');

  return { depth, totalRemoved, specialsCreated, aborted };
}
