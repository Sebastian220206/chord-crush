/**
 * Where campaign progress is kept between sessions.
 *
 * A storage adapter rather than a direct localStorage call, for three reasons:
 * the rules for "is this level unlocked" never have to know where bytes live, the
 * game keeps working when storage is missing or blocked, and tests can drive it
 * without a browser.
 */

export interface ProgressionData {
  /** Highest level id the player may start. Level 1 is always unlocked. */
  highestUnlockedLevel: number;
  /** Ids of levels finished at least once, ascending. */
  completedLevels: number[];
  /**
   * Best score per level id, as a string-keyed record because that is what JSON
   * object keys are. Absent means "never finished", which is not the same as zero.
   */
  bestScores: Record<string, number>;
}

/** A fresh campaign: level 1 open, nothing finished. */
export function createEmptyProgression(): ProgressionData {
  return { highestUnlockedLevel: 1, completedLevels: [], bestScores: {} };
}

export interface ProgressionStorage {
  load(): ProgressionData | null;
  save(data: ProgressionData): void;
  clear(): void;
}

export const PROGRESSION_STORAGE_KEY = 'chord-crush-progress';

/**
 * The subset of the Web Storage API this module uses.
 *
 * Declared locally so the tests can supply a plain object with the same three
 * methods, and so nothing here assumes a browser.
 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * In-memory stand-in for localStorage.
 *
 * Used when the browser has no storage (private modes and locked-down browsers
 * throw on access rather than returning null) and by the tests. Progress then
 * lasts for the session instead of across reloads, which is the degradation the
 * game is designed around rather than a failure.
 */
export function createMemoryStore(): KeyValueStore {
  const entries = new Map<string, string>();

  return {
    getItem: (key) => (entries.has(key) ? (entries.get(key) as string) : null),
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

/** The browser's localStorage, or null when it cannot be reached at all. */
function browserStore(): KeyValueStore | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;

    return window.localStorage;
  } catch {
    // Access itself can throw when storage is disabled by policy.
    return null;
  }
}

/**
 * Forces stored data into the shape the game expects.
 *
 * Anything unrecognised is replaced rather than repaired: a half-valid save is
 * not worth guessing at, and a campaign that starts over is far better than a
 * game that crashes on launch. Every field is checked independently, so a save
 * with a good completed list but a broken bestScores still keeps the completions.
 *
 * The one thing worth reconstructing is the unlock level, because losing it would
 * lock a player out of levels they have already finished: completing level N
 * implies N+1 is open.
 */
export function sanitizeProgression(value: unknown): ProgressionData {
  if (typeof value !== 'object' || value === null) return createEmptyProgression();

  const raw = value as Partial<ProgressionData>;

  const completedLevels = Array.isArray(raw.completedLevels)
    ? Array.from(
        new Set(
          raw.completedLevels.filter(
            (id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0
          )
        )
      ).sort((a, b) => a - b)
    : [];

  const bestScores: Record<string, number> = {};

  if (typeof raw.bestScores === 'object' && raw.bestScores !== null) {
    // Object.keys rather than Object.entries: the project targets es5 with the es6
    // library, where entries() is not available.
    const scores = raw.bestScores as Record<string, unknown>;

    for (const key of Object.keys(scores)) {
      const id = Number(key);
      const score = scores[key];

      if (!Number.isInteger(id) || id <= 0) continue;
      if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) continue;

      bestScores[key] = Math.floor(score);
    }
  }

  const highestCompleted = completedLevels.length > 0 ? completedLevels[completedLevels.length - 1] : 0;

  const storedHighest =
    typeof raw.highestUnlockedLevel === 'number' &&
    Number.isFinite(raw.highestUnlockedLevel) &&
    raw.highestUnlockedLevel >= 1
      ? Math.floor(raw.highestUnlockedLevel)
      : 1;

  // Never below 1, and never below one past the best completed level.
  const highestUnlockedLevel = Math.max(1, storedHighest, highestCompleted + 1);

  return { highestUnlockedLevel, completedLevels, bestScores };
}

/**
 * Reads and writes campaign progress as JSON under one key.
 *
 * Deliberately holds nothing but progress: no board, no in-flight gameplay, no
 * audio settings. That keeps the save small, and means a corrupt or partial save
 * can only ever cost the player their campaign, never their board.
 */
export function createProgressionStorage(
  store: KeyValueStore | null = browserStore(),
  key: string = PROGRESSION_STORAGE_KEY
): ProgressionStorage {
  const target = store ?? createMemoryStore();

  return {
    load(): ProgressionData | null {
      let raw: string | null = null;

      try {
        raw = target.getItem(key);
      } catch {
        // A storage that throws on read behaves the same as no save at all.
        return null;
      }

      if (raw === null || raw === '') return null;

      try {
        return sanitizeProgression(JSON.parse(raw));
      } catch {
        // Malformed JSON, or JSON of the wrong shape entirely.
        return null;
      }
    },

    save(data: ProgressionData): void {
      try {
        target.setItem(key, JSON.stringify(sanitizeProgression(data)));
      } catch {
        // A full or blocked quota must not interrupt play; the campaign simply
        // will not survive a reload.
      }
    },

    clear(): void {
      try {
        target.removeItem(key);
      } catch {
        // Nothing to do: the value was never there, or cannot be removed.
      }
    },
  };
}