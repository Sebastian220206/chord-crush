import type { Level } from './Level';

/** The level the game opens on. */
export const FIRST_LEVEL_ID = 1;

/**
 * The playable levels, in order.
 *
 * Starter values, not a balance pass: the first level is meant to be won almost
 * by accident so the chord objective teaches itself, and later levels raise score
 * and chord counts together. Every level is 8x8 for now, though nothing depends
 * on that, since the board size travels in the level rather than in the renderer.
 *
 * Level 5's missing specialTileTarget is deliberate, and level 6 has one on
 * purpose: between them they prove the HUD only shows objectives a level asks
 * for.
 */
export const LEVEL_DEFINITIONS: readonly Level[] = [
  {
    id: 1,
    name: 'First Chord',
    description: 'Match three distinct triad notes (like C · E · G) to voice your first harmony.',
    boardWidth: 8,
    boardHeight: 8,
    moveLimit: 25,
    scoreTarget: 1000,
    chordTarget: 1,
  },
  {
    id: 2,
    name: 'Major Progression',
    description: 'Build bright Major & Minor triads across the staff before moves run out.',
    boardWidth: 8,
    boardHeight: 8,
    moveLimit: 25,
    scoreTarget: 2000,
    chordTarget: 2,
  },
  {
    id: 3,
    name: 'Minor Colors',
    description: 'Weave deeper harmonic progressions and chain consecutive chords for bonus points.',
    boardWidth: 8,
    boardHeight: 8,
    moveLimit: 30,
    scoreTarget: 3000,
    chordTarget: 3,
  },
  {
    id: 4,
    name: 'Chord Rush',
    description: 'Keep the Chord Builder moving and chain four full triads under pressure.',
    boardWidth: 8,
    boardHeight: 8,
    moveLimit: 30,
    scoreTarget: 4500,
    chordTarget: 4,
  },
  {
    id: 5,
    name: 'Finale',
    description: 'A grand symphonic test of cascades, high scores, and five completed chords.',
    boardWidth: 8,
    boardHeight: 8,
    moveLimit: 35,
    scoreTarget: 6000,
    chordTarget: 5,
  },
  {
    id: 6,
    name: 'Specialist',
    description: 'Combine 4-in-a-row Line Clears and 5-in-a-row Color Bombs with full triads.',
    boardWidth: 8,
    boardHeight: 8,
    moveLimit: 35,
    scoreTarget: 7000,
    chordTarget: 3,
    specialTileTarget: 2,
  },
];

/**
 * Tracks which level is loaded and moves through the list.
 *
 * Knows nothing about progress: it answers "which level" and never "how is it
 * going", because that is GameState and ObjectiveEngine's business. Keeping the
 * distinction sharp means the win and lose rules cannot drift from the level list.
 *
 * Deliberately free of Phaser, so the flow can be exercised headlessly.
 */
export class LevelManager {
  private readonly levels: readonly Level[];
  private index = 0;

  constructor(levels: readonly Level[] = LEVEL_DEFINITIONS) {
    // A level manager with nothing to load could not honour any of its calls, so
    // it refuses to exist rather than failing later at the first loadLevel.
    if (levels.length === 0) throw new Error('LevelManager needs at least one level');

    this.levels = levels;
  }

  getCurrentLevel(): Level {
    return this.levels[this.index];
  }

  getAllLevels(): readonly Level[] {
    return this.levels;
  }

  getLevelCount(): number {
    return this.levels.length;
  }

  /** The level with this id, or null when there is no such level. */
  getLevel(id: number): Level | null {
    for (let index = 0; index < this.levels.length; index++) {
      if (this.levels[index].id === id) return this.levels[index];
    }

    return null;
  }

  hasNextLevel(): boolean {
    return this.index < this.levels.length - 1;
  }

  /**
   * Jumps to a level by id.
   *
   * Returns false for an unknown id and leaves the current level alone, so a bad
   * call can never blank the game.
   */
  loadLevel(id: number): boolean {
    const found = this.levels.findIndex((level) => level.id === id);

    if (found === -1) return false;

    this.index = found;

    return true;
  }

  /**
   * Advances one level, or returns false at the end of the list so the caller can
   * show the completion state instead of wrapping around silently.
   */
  nextLevel(): boolean {
    if (!this.hasNextLevel()) return false;

    this.index++;

    return true;
  }

  /** Stays on the current level. Used by retry, which is a fresh attempt. */
  restartLevel(): void {
    // The index is already correct; progress lives in GameState and is cleared
    // by the level start, not here.
  }

  /** The first level, for replaying the game from the beginning. */
  loadFirstLevel(): void {
    this.index = 0;
  }
}
