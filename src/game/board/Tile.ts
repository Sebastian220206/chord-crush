/** Every musical note the game can place on the board. */
export const NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

export type NoteType = (typeof NOTES)[number];

/**
 * Picks a random note. This is the single source of note randomness for the
 * whole project; gameplay systems should call this rather than rolling their
 * own, so note generation stays in one place.
 */
export function randomNote(): NoteType {
  return NOTES[Math.floor(Math.random() * NOTES.length)];
}

/**
 * Monotonic tile id counter.
 *
 * Ids are deliberately NOT derived from grid coordinates. Tiles move when
 * gravity runs, and new tiles are created during refill, so a positional id
 * would change when a tile falls and would collide across the board. This
 * counter only ever increases, which means an id is never reused even after
 * the tile holding it has been removed.
 */
/** The two special tile kinds implemented so far. */
export type SpecialType = 'line-clear' | 'color-bomb';

/** Axis a line-clear tile fires along. Fixed by the match that created it. */
export type LineOrientation = 'horizontal' | 'vertical';

/**
 * Monotonic tile id counter.
 *
 * Ids are deliberately NOT derived from grid coordinates. Tiles move when
 * gravity runs, and new tiles are created during refill, so a positional id
 * would change when a tile falls and would collide across the board. This
 * counter only ever increases, which means an id is never reused even after
 * the tile holding it has been removed.
 */
let nextTileId = 0;

export interface Tile {
  id: number;
  row: number;
  column: number;
  noteType: NoteType;
  /** null for an ordinary note tile. Set when a match promotes the tile. */
  special: SpecialType | null;
  /** Only meaningful while special === 'line-clear'. */
  orientation: LineOrientation | null;
}

export class Tile implements Tile {
  /** Unique for the lifetime of the page. Survives every move. */
  readonly id: number;
  /** Current grid position. Mutated by gravity when the tile falls. */
  row: number;
  /** Current grid position. Mutated by gravity when the tile falls. */
  column: number;
  readonly noteType: NoteType;
  special: SpecialType | null;
  orientation: LineOrientation | null;

  constructor(row: number, column: number, noteType: NoteType = randomNote()) {
    this.id = nextTileId++;
    this.row = row;
    this.column = column;
    this.noteType = noteType;
    this.special = null;
    this.orientation = null;
  }
}
