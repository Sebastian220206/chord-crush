import { Board } from '../board/Board';
import { Tile } from '../board/Tile';

/**
 * Clears every matched tile out of the board's data model.
 *
 * Pure data operation: no Phaser, React, DOM or canvas. Visuals are the
 * caller's responsibility, which keeps the swap/removal logic testable.
 *
 * There is intentionally no gravity or refill here. Cells stay empty until a
 * later step moves tiles down and generates replacements.
 *
 * @param board the board to mutate
 * @param matchedTiles tiles reported by MatchEngine (deduplicated or not)
 * @returns the tiles that were actually removed, in the order they were removed
 */
export function removeMatchedTiles(board: Board, matchedTiles: Tile[]): Tile[] {
  const removed: Tile[] = [];
  const processed = new Set<Tile>();

  for (const tile of matchedTiles) {
    // A tile sitting on both a horizontal and a vertical match must only be
    // removed once. MatchEngine already dedupes, but stay safe if it does not.
    if (processed.has(tile)) continue;
    processed.add(tile);

    // removeTile verifies the cell still holds this exact tile, so a stale or
    // foreign reference can never blank out an unrelated cell.
    if (board.removeTile(tile)) {
      removed.push(tile);
    }
  }

  return removed;
}
