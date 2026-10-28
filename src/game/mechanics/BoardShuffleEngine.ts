import { Board } from '../board/Board';
import { NoteType, Tile } from '../board/Tile';
import { findMatches } from './MatchEngine';
import { hasValidMove } from './MoveFinder';
import {
  deterministicNotePicker,
  generateMatchFreeLayout,
  MAX_GENERATION_ATTEMPTS,
} from './BoardGenerator';

/**
 * Bounded attempt limit for finding a reshuffle. The game must never be able to
 * hang here, so this is a hard stop rather than a retry-until-success loop.
 */
export const MAX_SHUFFLE_ATTEMPTS = 1000;

export interface ShuffleResult {
  /** Arrangements that were tried before the accepted one. */
  attempts: number;
  /** True when the board is match-free and has at least one legal move. */
  playable: boolean;
  /** True when the attempt limit was hit and a degraded board was accepted. */
  exhausted: boolean;
}

/** Every tile on the board in reading order. */
function collectTiles(board: Board): Tile[] {
  const { rows, columns } = board.getSize();
  const tiles: Tile[] = [];

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const tile = board.getTileAt(row, column);
      if (tile) tiles.push(tile);
    }
  }

  return tiles;
}

/** The current notes in reading order, which is also a tile's index. */
function readLayout(board: Board): NoteType[] {
  return collectTiles(board).map((tile) => tile.noteType);
}

function sameLayout(a: NoteType[], b: NoteType[]): boolean {
  return a.length === b.length && a.every((note, index) => note === b[index]);
}

/** Row-major layout to the flat order tiles are stored in. */
function flatten(layout: NoteType[][]): NoteType[] {
  const flat: NoteType[] = [];

  for (const line of layout) {
    for (const note of line) flat.push(note);
  }

  return flat;
}

/** Flat row-major notes back into a grid, for building a probe board. */
function toGrid(notes: NoteType[], columns: number): NoteType[][] {
  const grid: NoteType[][] = [];

  for (let index = 0; index < notes.length; index += columns) {
    grid.push(notes.slice(index, index + columns));
  }

  return grid;
}

/** Fisher-Yates, so every arrangement of the existing notes is equally likely. */
function permute(notes: NoteType[]): NoteType[] {
  const copy = notes.slice();

  for (let index = copy.length - 1; index > 0; index--) {
    const swapWith = Math.floor(Math.random() * (index + 1));
    const held = copy[index];

    copy[index] = copy[swapWith];
    copy[swapWith] = held;
  }

  return copy;
}

/**
 * Writes a layout onto the existing tiles.
 *
 * The same Tile objects are reused, so ids, positions, hit boxes and any
 * Phaser visual bound to a tile all survive the shuffle untouched. Only the note
 * of each cell changes, which is why a shuffle needs no repositioning at all.
 * Special flags and orientations are left exactly as they are.
 */
function applyLayout(board: Board, layout: NoteType[]): void {
  const tiles = collectTiles(board);

  for (let index = 0; index < tiles.length; index++) {
    tiles[index].noteType = layout[index];
  }
}

/**
 * Reshuffles a deadlocked board in place.
 *
 * A candidate is only accepted when it is both match-free and playable, so the
 * player is never handed a board that starts mid-cascade or that they cannot
 * move on. Candidates are tried on a throwaway probe board first, which means
 * the real board is left untouched until a good one is found.
 *
 * Special tiles are not moved or converted. Their notes may change, which is
 * harmless: a line-clear keeps its axis and a color bomb draws no note.
 */
export function shuffleBoard(board: Board): ShuffleResult {
  const { rows, columns } = board.getSize();
  const current = readLayout(board);

  // Phase 1: permute the notes that are already on the board, which keeps the
  // exact note counts of the current game.
  let bestMatchFree: NoteType[] | null = null;
  let bestAttempts = 0;

  for (let attempt = 1; attempt <= MAX_SHUFFLE_ATTEMPTS; attempt++) {
    const candidate = permute(current);

    // A shuffle that changes nothing would leave the deadlock in place.
    if (sameLayout(candidate, current)) continue;

    const probe = Board.fromLayout(toGrid(candidate, columns));
    if (findMatches(probe).length > 0) continue;

    bestMatchFree = candidate;
    bestAttempts = attempt;

    if (hasValidMove(probe)) {
      applyLayout(board, candidate);

      return { attempts: attempt, playable: true, exhausted: false };
    }
  }

  // Phase 2: deterministic layouts. These may not preserve the current note
  // counts, which is an acceptable last resort compared to a dead board.
  for (let offset = 1; offset <= MAX_GENERATION_ATTEMPTS; offset++) {
    const candidate = generateMatchFreeLayout(rows, columns, deterministicNotePicker(offset));
    const probe = Board.fromLayout(candidate);

    if (findMatches(probe).length > 0) continue;

    applyLayout(board, flatten(candidate));

    return {
      attempts: MAX_SHUFFLE_ATTEMPTS + offset,
      playable: hasValidMove(board),
      exhausted: false,
    };
  }

  // Phase 3: give up loudly rather than silently leaving the player stuck.
  if (bestMatchFree) {
    applyLayout(board, bestMatchFree);

    console.error(
      `SHUFFLE FAILED: no playable arrangement in ${MAX_SHUFFLE_ATTEMPTS} attempts; applied the best match-free layout`
    );

    return { attempts: bestAttempts, playable: false, exhausted: true };
  }

  console.error(
    `SHUFFLE FAILED: no match-free arrangement in ${MAX_SHUFFLE_ATTEMPTS} attempts; board left unchanged`
  );

  return { attempts: MAX_SHUFFLE_ATTEMPTS, playable: false, exhausted: true };
}
