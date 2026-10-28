/**
 * What the player has to achieve, and on what board.
 *
 * Purely declarative data. A level describes a goal, never how to check it:
 * ObjectiveEngine reads these fields and decides what is complete, LevelManager
 * decides which one is current, and GameState holds the progress being compared.
 * Keeping all three apart is what lets a new level be added by writing an object
 * literal and nothing else.
 */
export interface Level {
  /** 1-based identifier, also the order the levels are played in. */
  id: number;
  name: string;

  /** Short musical briefing shown on the level map and codex. */
  description?: string;

  /** Columns on the board. */
  boardWidth: number;
  /** Rows on the board. */
  boardHeight: number;

  /** Swaps the player may make before the level is lost. */
  moveLimit: number;

  /** Always required: the points the player has to reach. */
  scoreTarget: number;

  /** Chords to form. Optional, and left off the HUD entirely when absent. */
  chordTarget?: number;

  /** Special tiles to create. Optional, same rule as chordTarget. */
  specialTileTarget?: number;
}
