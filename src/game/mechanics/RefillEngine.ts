import { Board } from '../board/Board';
import { Tile } from '../board/Tile';

/** A brand new tile seated into a previously empty cell. */
export interface RefilledTile {
  tile: Tile;
  row: number;
  column: number;
}

/**
 * Creates a new tile for every cell left empty, so the board is always full
 * once this returns.
 *
 * Normally gravity runs first, which pushes all remaining holes to the top of
 * each column, so the new tiles appear in the rows closest to the top edge.
 * Columns are walked top-down so the tiles entering a column stack in reading
 * order, and only genuinely empty cells are touched.
 *
 * @returns the new tiles and the cells they now occupy, for the caller to animate
 */
export function refillEmptyCells(board: Board): RefilledTile[] {
  const { rows, columns } = board.getSize();
  const created: RefilledTile[] = [];

  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      if (!board.isEmpty(row, column)) continue;

      // Tile assigns its own unique id and a random note from NOTES, so refill
      // never invents a second note system and never reuses an existing id.
      const tile = new Tile(row, column);

      if (!board.moveTile(tile, row, column)) continue;

      created.push({ tile, row, column });
    }
  }

  return created;
}
