import { Board } from '../board/Board';
import { NoteType, NOTES } from '../board/Tile';
import { findMatches } from './MatchEngine';
import { hasValidMove } from './MoveFinder';

/**
 * Bounded attempts for producing a board the player can actually use. Reaching
 * the limit is not a reason to hang, so the caller falls back instead.
 */
export const MAX_GENERATION_ATTEMPTS = 200;

/**
 * Chooses which of the allowed notes a cell ends up with.
 *
 * The cell is already guaranteed to be safe; the picker only decides between
 * the notes that are legal there. Injecting it lets the fallback path use
 * deterministic layouts instead of re-rolling randomness.
 */
export type NotePicker = (candidates: NoteType[], cellIndex: number) => NoteType;

/** Uniform random choice. */
export const randomNotePicker: NotePicker = (candidates) =>
  candidates[Math.floor(Math.random() * candidates.length)];

/**
 * Deterministic choice, rotated by `offset`.
 *
 * Different offsets walk through genuinely different layouts, so the fallback
 * search explores new boards rather than retrying the same dice roll.
 */
export function deterministicNotePicker(offset: number): NotePicker {
  return (candidates, cellIndex) => candidates[(cellIndex + offset) % candidates.length];
}

/**
 * True when placing `note` here would complete a run of three.
 *
 * Only the two cells to the left and the two above can combine with this cell,
 * because everything else in the board is generated in reading order and is
 * already known to be clean. That makes a full 3-run check two comparisons per
 * axis rather than a scan.
 */
function wouldCompleteRun(
  layout: NoteType[][],
  row: number,
  column: number,
  note: NoteType
): boolean {
  const left = layout[row];
  if (left[column - 1] === note && left[column - 2] === note) return true;

  if (row >= 2 && layout[row - 1][column] === note && layout[row - 2][column] === note) {
    return true;
  }

  return false;
}

/**
 * Builds a layout with no horizontal or vertical run of three.
 *
 * Each cell simply refuses the notes that would complete a run, so the result is
 * match-free by construction rather than by checking and retrying whole boards.
 * With seven notes and at most two forbidden per cell there is always a legal
 * choice, so this never loops.
 */
export function generateMatchFreeLayout(
  rows: number,
  columns: number,
  pick: NotePicker = randomNotePicker
): NoteType[][] {
  const layout: NoteType[][] = [];

  for (let row = 0; row < rows; row++) {
    const line: NoteType[] = [];
    // Pushed before it is filled, because the run check reads the cell to the
    // left, which is the row currently being generated.
    layout.push(line);

    for (let column = 0; column < columns; column++) {
      const candidates = NOTES.filter((note) => !wouldCompleteRun(layout, row, column, note));
      // Never empty in practice, but the fallback keeps this total.
      const safe: NoteType[] = candidates.length > 0 ? candidates : Array.from(NOTES);

      line.push(pick(safe, row * columns + column));
    }
  }

  return layout;
}

/**
 * A fresh board with no starting matches and at least one legal move.
 *
 * Both conditions are checked even though the layout is match-free by
 * construction: playability cannot be guaranteed by placement alone, and a
 * board the player cannot move on is worse than one that starts mid-cascade.
 *
 * The random pass is followed by a deterministic pass so that a freak run of
 * unplayable boards cannot spin. If even that fails, a match-free board is
 * returned with an error logged rather than freezing the game.
 */
export function createPlayableBoard(rows: number = 8, columns: number = 8): Board {
  const pickers: NotePicker[] = [randomNotePicker];

  for (let offset = 1; offset <= MAX_GENERATION_ATTEMPTS; offset++) {
    pickers.push(deterministicNotePicker(offset));
  }

  for (let attempt = 0; attempt < pickers.length; attempt++) {
    const board = Board.fromLayout(generateMatchFreeLayout(rows, columns, pickers[attempt]));

    if (findMatches(board).length === 0 && hasValidMove(board)) {
      return board;
    }
  }

  console.error(
    `BOARD GENERATION FAILED after ${pickers.length} attempts: returning a match-free board that may be deadlocked`
  );

  return Board.fromLayout(generateMatchFreeLayout(rows, columns));
}
