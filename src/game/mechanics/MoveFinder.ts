import { Board } from '../board/Board';
import { Tile } from '../board/Tile';
import { findMatchGroups } from './MatchEngine';

/** A board cell. */
export interface Position {
  row: number;
  column: number;
}

/**
 * A legal swap: the two cells the player would drag.
 *
 * Returned by findValidMove so a future hint system can highlight exactly the
 * move that works, instead of re-deriving it.
 */
export interface Move {
  from: Position;
  to: Position;
}

/**
 * A tile a player is allowed to drag.
 *
 * Deliberately conservative: only ordinary notes count. Letting a special tile
 * count as a move would make MoveFinder answer "yes, playable" for a board that
 * only has a color bomb to blow up, and the board would then never be
 * reshuffled even though it is effectively dead. Special tiles still fire when
 * they are caught in a match or swapped, which SpecialTileEngine handles.
 */
function isDraggable(tile: Tile | null): tile is Tile {
  return tile !== null && tile.special === null;
}

/**
 * True when swapping these two tiles' notes produces a match.
 *
 * The swap is temporary and always undone: the two noteType fields are saved,
 * swapped, and restored in a finally block, so a throw mid-scan can never leave
 * the real board modified. Tile ids, positions and special flags are never
 * touched, so no Phaser visual can move as a side effect.
 */
function swapCreatesMatch(board: Board, tileA: Tile, tileB: Tile): boolean {
  const noteA = tileA.noteType;
  const noteB = tileB.noteType;

  tileA.noteType = noteB;
  tileB.noteType = noteA;

  try {
    // Only a match that involves one of the two swapped tiles counts. Without
    // that check a board that already contained a match would report every
    // single pair as a winning move.
    return findMatchGroups(board).some(
      (group) => group.tiles.indexOf(tileA) !== -1 || group.tiles.indexOf(tileB) !== -1
    );
  } finally {
    tileA.noteType = noteA;
    tileB.noteType = noteB;
  }
}

/**
 * The first legal move found, or null when the board is deadlocked.
 *
 * Brute force over the 8 x 7 horizontal plus 7 x 8 vertical adjacent pairs, and
 * each pair to the right or below only, so no swap is tested twice. At 112
 * candidates this is far cheaper than any clever algorithm would be worth, and
 * it is pure data work: no Phaser, no animation, no scoring.
 */
export function findValidMove(board: Board): Move | null {
  const { rows, columns } = board.getSize();

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const tile = board.getTileAt(row, column);
      if (!isDraggable(tile)) continue;

      const right = board.getTileAt(row, column + 1);
      if (isDraggable(right) && swapCreatesMatch(board, tile, right)) {
        return { from: { row, column }, to: { row, column: column + 1 } };
      }

      const below = board.getTileAt(row + 1, column);
      if (isDraggable(below) && swapCreatesMatch(board, tile, below)) {
        return { from: { row, column }, to: { row: row + 1, column } };
      }
    }
  }

  return null;
}

/** True when at least one legal swap exists. */
export function hasValidMove(board: Board): boolean {
  return findValidMove(board) !== null;
}
