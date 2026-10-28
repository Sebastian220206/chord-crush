import { Board } from '../board/Board';
import { Tile } from '../board/Tile';

/** A single tile's fall, used to drive the matching Phaser tween. */
export interface TileFall {
  tile: Tile;
  fromRow: number;
  fromColumn: number;
  toRow: number;
  toColumn: number;
}

/**
 * Settles every column downward so no empty cell has a tile above it.
 *
 * Each column is compacted independently: tiles keep their original top-to-bottom
 * order and only ever move straight down. Tiles never swap, reorder, or move
 * sideways. The board is mutated in place and the Tile objects are reused, so
 * tile ids and any visuals bound to them remain valid.
 *
 * @returns one entry per tile that actually moved, empty if the board was solid
 */
export function applyGravity(board: Board): TileFall[] {
  const { rows, columns } = board.getSize();
  const falls: TileFall[] = [];

  for (let column = 0; column < columns; column++) {
    // writeRow tracks the lowest cell still free in this column. Reading from
    // the bottom up means the first tile we meet keeps the bottom cell, and the
    // next one settles directly above it, preserving order.
    let writeRow = rows - 1;

    for (let row = rows - 1; row >= 0; row--) {
      const tile = board.getTileAt(row, column);
      if (!tile) continue;

      if (row !== writeRow) {
        if (!board.moveTile(tile, writeRow, column)) continue;

        falls.push({
          tile,
          fromRow: row,
          fromColumn: column,
          toRow: writeRow,
          toColumn: column,
        });
      }

      writeRow--;
    }
  }

  return falls;
}
