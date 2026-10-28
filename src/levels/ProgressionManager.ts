import {
  createEmptyProgression,
  createProgressionStorage,
  sanitizeProgression,
} from './ProgressionStorage';
import type { ProgressionData, ProgressionStorage } from './ProgressionStorage';

/** What a level looks like from the campaign's point of view. */
export type LevelStatus = 'locked' | 'unlocked' | 'completed';

export interface LevelCompletion {
  /** Final score for the attempt, kept as a personal best. Not a ranking. */
  score?: number;
}

type Listener = (data: ProgressionData) => void;

/**
 * Owns campaign progress: which levels are open, which are finished, and the
 * best score on each.
 *
 * Free of Phaser and React, and free of the Level list too, because it only ever
 * deals in ids. Deciding whether id 4 exists is LevelManager's job; deciding
 * whether the player has earned it belongs here. That separation is what makes
 * the unlock rule testable without a game and the level list replaceable without
 * touching saved progress.
 *
 * Two invariants hold no matter what the caller does:
 * progress only ever moves forward, and a level already completed is never
 * un-completed, so a double click or a repeated win cannot undo anything.
 */
export class ProgressionManager {
  private readonly storage: ProgressionStorage;
  private data: ProgressionData;
  private readonly listeners = new Set<Listener>();

  constructor(storage: ProgressionStorage = createProgressionStorage()) {
    this.storage = storage;
    this.data = this.read();
  }

  /** Starts a new campaign in memory. Only called by the constructor. */
  private read(): ProgressionData {
    const stored = this.storage.load();

    return stored === null ? createEmptyProgression() : stored;
  }

  /** A defensive copy, so callers cannot mutate progress by accident. */
  getSnapshot(): ProgressionData {
    return {
      highestUnlockedLevel: this.data.highestUnlockedLevel,
      completedLevels: [...this.data.completedLevels],
      bestScores: { ...this.data.bestScores },
    };
  }

  getHighestUnlockedLevel(): number {
    return this.data.highestUnlockedLevel;
  }

  getCompletedLevels(): number[] {
    return [...this.data.completedLevels];
  }

  /**
   * True when the player may start this level.
   *
   * Only ever true for a level at or below the highest unlocked id, which is what
   * stops a jump straight into the middle of the campaign.
   */
  isUnlocked(levelId: number): boolean {
    if (!Number.isInteger(levelId) || levelId <= 0) return false;

    return levelId <= this.data.highestUnlockedLevel;
  }

  isCompleted(levelId: number): boolean {
    if (!Number.isInteger(levelId) || levelId <= 0) return false;

    return this.data.completedLevels.indexOf(levelId) !== -1;
  }

  /** Best score on a level, or null when it has never been finished. */
  getBestScore(levelId: number): number | null {
    const score = this.data.bestScores[String(levelId)];

    return typeof score === 'number' ? score : null;
  }

  /** The single question the level map asks about a card. */
  getStatus(levelId: number): LevelStatus {
    if (this.isCompleted(levelId)) return 'completed';
    if (this.isUnlocked(levelId)) return 'unlocked';

    return 'locked';
  }

  /**
   * Records a finished level.
   *
   * Unlocking is derived from the completion rather than passed in, so the two can
   * never disagree: finishing level N opens N+1 and nothing else. Both halves are
   * idempotent and monotonic, so winning the same level twice, or finishing an
   * older level after a newer one, leaves the campaign exactly where it was apart
   * from a higher personal best.
   *
   * Finishing the last level simply leaves the unlock id one past the end, which
   * is harmless: no level list ever contains that id, so nothing unlocks that
   * should not.
   */
  completeLevel(levelId: number, completion: LevelCompletion = {}): ProgressionData {
    if (!Number.isInteger(levelId) || levelId <= 0) return this.getSnapshot();

    if (!this.isCompleted(levelId)) {
      this.data.completedLevels = [...this.data.completedLevels, levelId].sort((a, b) => a - b);
    }

    if (levelId + 1 > this.data.highestUnlockedLevel) {
      this.data.highestUnlockedLevel = levelId + 1;
    }

    // A personal best only ever rises, so replaying an old level cannot lower it.
    const score = completion.score;
    if (typeof score === 'number' && Number.isFinite(score) && score >= 0) {
      const key = String(levelId);
      const previous = this.data.bestScores[key];

      if (typeof previous !== 'number' || Math.floor(score) > previous) {
        this.data.bestScores[key] = Math.floor(score);
      }
    }

    return this.commit();
  }

  /**
   * Wipes the campaign back to level 1.
   *
   * For development and tests. There is deliberately no menu item wired to it,
   * because handing a player a one-tap campaign reset is not a small decision.
   */
  resetProgress(): ProgressionData {
    this.storage.clear();
    this.data = createEmptyProgression();

    // Not committed: clearing already removed the saved bytes, and writing an
    // empty campaign straight back would make a reset look like it never happened.
    return this.notify();
  }

  /** Saves and tells listeners. The single exit point for any change. */
  private commit(): ProgressionData {
    this.data = sanitizeProgression(this.data);
    this.storage.save(this.data);

    return this.notify();
  }

  /** Hands every listener a private copy, so nobody can mutate state by accident. */
  private notify(): ProgressionData {
    const snapshot = this.getSnapshot();

    // forEach rather than for...of: the project targets es5, where iterating a Set
    // directly needs a compiler flag the rest of the codebase does not use.
    this.listeners.forEach((listener) => listener(snapshot));

    return snapshot;
  }

  /**
   * Notifies on every change.
   *
   * This is how the React level map stays in step with a win that happened inside
   * the Phaser canvas, without the canvas ever touching React's state directly.
   * Returns an unsubscribe function.
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }
}

let shared: ProgressionManager | null = null;

/**
 * The game's single ProgressionManager.
 *
 * Shared the same way AudioManager is, so the React level map and the Phaser
 * scene are guaranteed to be talking about one campaign rather than two that
 * happen to agree.
 */
export function getProgressionManager(): ProgressionManager {
  if (shared === null) shared = new ProgressionManager();

  return shared;
}