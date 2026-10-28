import { Board } from '../board/Board';
import { LineOrientation, NoteType, SpecialType, Tile } from '../board/Tile';
import { MatchGroup } from './MatchEngine';

/** A straight run of exactly this length becomes a line-clear tile. */
export const LINE_CLEAR_MATCH_LENGTH = 4;

/** A straight run of this length or longer becomes a color bomb. */
export const COLOR_BOMB_MATCH_LENGTH = 5;

/**
 * A tile that this stage is going to turn into a special tile.
 *
 * The tile is chosen from the run that matched and is NOT removed: it stays on
 * the board and becomes the special tile. Everything else in the run is removed
 * normally.
 */
export interface PlannedSpecialTile {
  tile: Tile;
  type: SpecialType;
  /** Axis for a line-clear, null for a color bomb. */
  orientation: LineOrientation | null;
}

/**
 * One cascade stage, planned before anything is removed.
 *
 * This is the hand-off between SpecialTileEngine and CascadeEngine. The engine
 * decides the contents, CascadeEngine performs them through the existing
 * remove -> gravity -> refill pipeline.
 */
export interface StagePlan {
  /** Unique tiles to remove this stage. Never contains a promoted tile. */
  removals: Tile[];
  /** Tiles promoted to special tiles this stage. */
  specials: PlannedSpecialTile[];
  /**
   * Which special tile fired to add extra removals, or null for a plain match.
   * Drives the activation score bonus.
   */
  activation: SpecialType | null;
}

/** A board cell, used to prefer where a special tile is created. */
export interface CellRef {
  row: number;
  column: number;
}

/**
 * Result of inspecting a swap for special tile involvement.
 *
 * 'unsupported' exists because special + special combinations are explicitly
 * out of scope: the caller refuses the swap instead of guessing at behaviour.
 */
export type SpecialSwapOutcome =
  | { type: 'none' }
  | { type: 'unsupported' }
  | { type: 'plan'; plan: StagePlan };

/**
 * The special tile a straight run of `length` produces, or null for a plain
 * removal. Only straight runs are considered: L and T shapes are deliberately
 * left as normal matches.
 */
export function specialTypeForMatchLength(length: number): SpecialType | null {
  if (!Number.isFinite(length)) return null;
  if (length >= COLOR_BOMB_MATCH_LENGTH) return 'color-bomb';
  if (length === LINE_CLEAR_MATCH_LENGTH) return 'line-clear';
  return null;
}

/**
 * Writes the special flags onto the chosen tiles.
 *
 * Called by CascadeEngine before the removal animation, so the visuals already
 * show a special tile while the rest of the run is still fading out.
 */
export function createSpecialTiles(specials: PlannedSpecialTile[]): void {
  for (const { tile, type, orientation } of specials) {
    tile.special = type;
    // A color bomb has no axis, and a line-clear always has one. Defaulting to
    // horizontal keeps a hand-built tile from firing in an undefined direction.
    tile.orientation = type === 'line-clear' ? orientation ?? 'horizontal' : null;
  }
}

/**
 * Turns match groups into the removals and special tiles for one stage.
 *
 * Rules, straight runs only:
 *   3 tiles  -> plain removal
 *   4 tiles  -> one line-clear tile, oriented along the run
 *   5 or more-> one color bomb
 *
 * `preferred` is the cell the player swapped into. When a run contains that cell
 * the special tile is created there, so a hand-made 4- or 5-match always hands
 * back the cell the player aimed at. Otherwise the middle tile of the run is
 * used, which keeps cascade-created specials deterministic.
 *
 * A line-clear tile caught inside a match fires along its own axis and adds that
 * line to this stage's removals. A color bomb caught inside a match is removed
 * without effect: only a direct swap sets it off.
 */
export function planMatchStage(
  board: Board,
  groups: MatchGroup[],
  preferred: CellRef | null = null
): StagePlan {
  const removals = new Set<Tile>();
  const promoted = new Set<Tile>();
  const specials: PlannedSpecialTile[] = [];
  let activation: SpecialType | null = null;

  for (const group of groups) {
    const type = specialTypeForMatchLength(group.length);
    let survivor: Tile | null = null;

    if (type !== null) {
      survivor = chooseSurvivor(group, preferred, promoted);

      if (survivor) {
        promoted.add(survivor);
        specials.push({
          tile: survivor,
          type,
          // A line-clear fires along the run that created it.
          orientation: type === 'line-clear' ? group.direction : null,
        });
      }
    }

    for (const tile of group.tiles) {
      // The promoted tile stays on the board, so it is never removed or fired.
      if (tile === survivor) continue;

      // A line-clear caught in a match fires along its own axis and adds that
      // line to this stage's removals, on top of the normal match removal.
      if (tile.special === 'line-clear') {
        if (activation === null) activation = tile.special;

        for (const cleared of lineTilesFor(board, tile) ?? []) removals.add(cleared);
        continue;
      }

      removals.add(tile);
    }
  }

  return {
    removals: Array.from(removals).filter((tile) => !promoted.has(tile)),
    specials,
    activation,
  };
}

/**
 * Stage plan for swapping a line-clear tile with anything else: its whole row
 * or column is cleared. The tile it was swapped with is consumed as part of the
 * trade, because the activation happens in place without a literal swap.
 */
export function planLineClearActivation(
  board: Board,
  lineClear: Tile,
  partner: Tile | null = null
): StagePlan {
  const removals = new Set<Tile>(lineTilesFor(board, lineClear) ?? [lineClear]);
  if (partner) removals.add(partner);

  return { removals: Array.from(removals), specials: [], activation: 'line-clear' };
}

/**
 * Stage plan for swapping a color bomb with a normal note tile: every tile of
 * that note is cleared, plus the bomb itself.
 *
 * The partner tile is already part of the note set, so it is removed without
 * needing to be added explicitly.
 */
export function planColorBombActivation(
  board: Board,
  bomb: Tile,
  noteType: NoteType
): StagePlan {
  const { rows, columns } = board.getSize();
  const removals = new Set<Tile>([bomb]);

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const tile = board.getTileAt(row, column);
      if (tile && tile.noteType === noteType) removals.add(tile);
    }
  }

  return { removals: Array.from(removals), specials: [], activation: 'color-bomb' };
}

/**
 * Decides how a player swap involving special tiles should be handled.
 *
 * Neither tile special      -> 'none', use the normal swap-and-validate path.
 * One special, one normal   -> 'plan', run the activation straight away.
 * Both special              -> 'unsupported', refuse the swap for now.
 */
export function planSpecialSwap(board: Board, tileA: Tile, tileB: Tile): SpecialSwapOutcome {
  const specialA = tileA.special;
  const specialB = tileB.special;

  if (specialA === null && specialB === null) return { type: 'none' };
  if (specialA !== null && specialB !== null) return { type: 'unsupported' };

  if (specialA === 'color-bomb') {
    return { type: 'plan', plan: planColorBombActivation(board, tileA, tileB.noteType) };
  }

  if (specialB === 'color-bomb') {
    return { type: 'plan', plan: planColorBombActivation(board, tileB, tileA.noteType) };
  }

  if (specialA === 'line-clear') {
    return { type: 'plan', plan: planLineClearActivation(board, tileA, tileB) };
  }

  return { type: 'plan', plan: planLineClearActivation(board, tileB, tileA) };
}

/**
 * Every tile a line-clear tile clears, or null when the tile is not a
 * line-clear. The tile's own cell is part of the line.
 */
export function lineTilesFor(board: Board, tile: Tile): Tile[] | null {
  if (tile.special !== 'line-clear') return null;

  const { rows, columns } = board.getSize();
  const line: Tile[] = [];

  if (tile.orientation === 'vertical') {
    for (let row = 0; row < rows; row++) {
      const cell = board.getTileAt(row, tile.column);
      if (cell) line.push(cell);
    }

    return line;
  }

  for (let column = 0; column < columns; column++) {
    const cell = board.getTileAt(tile.row, column);
    if (cell) line.push(cell);
  }

  return line;
}

/**
 * Picks the tile of a run that becomes the special tile: the preferred cell when
 * it is part of this run and not already claimed by another run, otherwise the
 * middle of the run. Returns null when every tile is already claimed, in which
 * case the run is removed as an ordinary match.
 */
function chooseSurvivor(
  group: MatchGroup,
  preferred: CellRef | null,
  promoted: Set<Tile>
): Tile | null {
  if (preferred) {
    const atPreferred = group.tiles.find(
      (tile) =>
        tile.row === preferred.row && tile.column === preferred.column && !promoted.has(tile)
    );

    if (atPreferred) return atPreferred;
  }

  const middle = group.tiles[Math.floor(group.tiles.length / 2)];
  if (middle && !promoted.has(middle)) return middle;

  return null;
}
