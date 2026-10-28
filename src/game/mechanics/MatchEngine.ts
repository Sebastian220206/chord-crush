import { Board } from '../board/Board';
import { Tile } from '../board/Tile';

const MIN_MATCH_LENGTH = 3;

export type MatchDirection = 'horizontal' | 'vertical';

/**
 * One straight run of 3+ tiles of the same note.
 *
 * Match detection stays deliberately dumb: it reports runs, it does not decide
 * what they are worth. SpecialTileEngine reads the run length and direction to
 * work out whether a line-clear or color bomb should be created, which keeps
 * "what matched" and "what to do about it" in separate engines.
 *
 * A tile that belongs to both a horizontal and a vertical run (an L or T shape)
 * appears in two groups. SpecialTileEngine resolves that overlap, so no
 * de-duplication happens here.
 */
export interface MatchGroup {
  /** Every tile in the run, in board order. */
  tiles: Tile[];
  direction: MatchDirection;
  /** Row of the run, for horizontal runs. */
  row: number;
  /** Column of the run, for vertical runs. */
  column: number;
  /** Run length, always >= MIN_MATCH_LENGTH. */
  length: number;
}

/** All straight runs on the board, horizontal first. */
export function findMatchGroups(board: Board): MatchGroup[] {
  const groups: MatchGroup[] = [];

  collectHorizontalMatches(board, groups);
  collectVerticalMatches(board, groups);

  return groups;
}

/**
 * Flattens groups into a single de-duplicated tile list.
 *
 * This is the shared bookkeeping step: a tile matched by both a horizontal and
 * a vertical run is reported exactly once, which is what stops the same tile
 * from being scored or removed twice.
 */
export function collectGroupTiles(groups: MatchGroup[]): Tile[] {
  const matched = new Set<Tile>();

  for (const group of groups) {
    for (const tile of group.tiles) matched.add(tile);
  }

  return Array.from(matched);
}

/**
 * Every tile currently part of a match. Kept as the simple entry point used by
 * callers that only need the tiles; group-aware callers use findMatchGroups.
 */
export function findMatches(board: Board): Tile[] {
  return collectGroupTiles(findMatchGroups(board));
}

function collectHorizontalMatches(board: Board, groups: MatchGroup[]): void {
  const { rows, columns } = board.getSize();

  for (let row = 0; row < rows; row++) {
    let start = 0;

    while (start < columns) {
      const length = measureRun(board, row, start, 0, 1);

      if (length >= MIN_MATCH_LENGTH) {
        groups.push({
          tiles: readRun(board, row, start, length, 0, 1),
          direction: 'horizontal',
          row,
          column: start,
          length,
        });
      }

      start += length;
    }
  }
}

function collectVerticalMatches(board: Board, groups: MatchGroup[]): void {
  const { rows, columns } = board.getSize();

  for (let column = 0; column < columns; column++) {
    let start = 0;

    while (start < rows) {
      const length = measureRun(board, start, column, 1, 0);

      if (length >= MIN_MATCH_LENGTH) {
        groups.push({
          tiles: readRun(board, start, column, length, 1, 0),
          direction: 'vertical',
          row: start,
          column,
          length,
        });
      }

      start += length;
    }
  }
}

function measureRun(
  board: Board,
  startRow: number,
  startColumn: number,
  rowStep: number,
  columnStep: number
): number {
  const { rows, columns } = board.getSize();

  const first = board.getTileAt(startRow, startColumn);
  if (!first) return 1;

  let length = 1;

  while (true) {
    const nextRow = startRow + length * rowStep;
    const nextColumn = startColumn + length * columnStep;

    const outOfBounds = nextRow < 0 || nextRow >= rows || nextColumn < 0 || nextColumn >= columns;
    if (outOfBounds) break;

    const candidate = board.getTileAt(nextRow, nextColumn);
    if (!candidate) break;
    if (candidate.noteType !== first.noteType) break;

    length++;
  }

  return length;
}

/** Reads the tiles of a run in board order. */
function readRun(
  board: Board,
  startRow: number,
  startColumn: number,
  length: number,
  rowStep: number,
  columnStep: number
): Tile[] {
  const tiles: Tile[] = [];

  for (let offset = 0; offset < length; offset++) {
    const row = startRow + offset * rowStep;
    const column = startColumn + offset * columnStep;

    const tile = board.getTileAt(row, column);
    if (tile) tiles.push(tile);
  }

  return tiles;
}
