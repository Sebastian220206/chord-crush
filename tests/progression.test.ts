/**
 * Progression tests.
 *
 * Deliberately dependency-free: a handful of assertions run by node, with no test
 * framework added to the project. `npm test` bundles this file with the esbuild
 * that already ships with Vite and runs it, so the suite costs nothing to install.
 *
 * Storage is exercised through the same KeyValueStore interface the browser uses,
 * so a fake can stand in for localStorage and a reload is just a second manager
 * over the same store.
 */
import { ProgressionManager } from '../src/levels/ProgressionManager';
import { LevelManager } from '../src/levels/LevelManager';
import {
  PROGRESSION_STORAGE_KEY,
  createMemoryStore,
  createProgressionStorage,
  sanitizeProgression,
} from '../src/levels/ProgressionStorage';
import type { KeyValueStore, ProgressionStorage } from '../src/levels/ProgressionStorage';

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;

    return;
  }

  failures.push(`${name}${detail ? ` -- ${detail}` : ''}`);
}

function equal(name: string, actual: unknown, expected: unknown): void {
  check(name, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`);
}

/** A fresh campaign over an isolated store, i.e. a new player's first launch. */
function newCampaign(store: KeyValueStore = createMemoryStore()): {
  progression: ProgressionManager;
  store: KeyValueStore;
} {
  return { progression: new ProgressionManager(createProgressionStorage(store)), store };
}

/**
 * The gate GameScene.requestLevel applies before generating a board: the level
 * has to be earned and it has to exist. Expressed here against the real managers
 * so the rule is tested rather than restated.
 */
function canLaunch(progression: ProgressionManager, levels: LevelManager, levelId: number): boolean {
  return progression.isUnlocked(levelId) && levels.loadLevel(levelId);
}

// ---------------------------------------------------------------------------
// Required case 1 & 2: a new player has level 1 open and nothing else.
// ---------------------------------------------------------------------------
{
  const { progression } = newCampaign();

  check('1 new player: level 1 is unlocked', progression.isUnlocked(1));
  equal('2 new player: level 2 is locked', progression.isUnlocked(2), false);
  equal('1b new player: level 1 is not complete yet', progression.isCompleted(1), false);
  equal('1c new player: highest unlocked is 1', progression.getHighestUnlockedLevel(), 1);
  equal('1d new player: nothing completed', progression.getCompletedLevels().length, 0);
  equal('1e new player: level 1 reads as unlocked', progression.getStatus(1), 'unlocked');
  equal('1f new player: level 2 reads as locked', progression.getStatus(2), 'locked');
  equal('1g new player: no best score yet', progression.getBestScore(1), null);
}

// ---------------------------------------------------------------------------
// Required case 3: completing level 1 unlocks level 2.
// ---------------------------------------------------------------------------
{
  const { progression } = newCampaign();
  progression.completeLevel(1, { score: 1200 });

  equal('3 completing level 1 unlocks level 2', progression.isUnlocked(2), true);
  equal('3a level 3 stays locked', progression.isUnlocked(3), false);
  equal('3b level 1 is completed', progression.isCompleted(1), true);
  equal('3c level 1 reads as completed', progression.getStatus(1), 'completed');
  equal('3d highest unlocked is 2', progression.getHighestUnlockedLevel(), 2);
  equal('3e the best score is kept', progression.getBestScore(1), 1200);
}

// ---------------------------------------------------------------------------
// Required case 4: completing level 3 unlocks level 4, unlocking in order.
// ---------------------------------------------------------------------------
{
  const { progression } = newCampaign();
  progression.completeLevel(1);
  progression.completeLevel(2);
  progression.completeLevel(3);

  equal('4 completing level 3 unlocks level 4', progression.isUnlocked(4), true);
  equal('4a level 5 stays locked', progression.isUnlocked(5), false);
  equal('4b highest unlocked is 4', progression.getHighestUnlockedLevel(), 4);
  equal('4c completions are in order', progression.getCompletedLevels().join(','), '1,2,3');
}

// ---------------------------------------------------------------------------
// Required case 5: completing an already completed level changes nothing.
// ---------------------------------------------------------------------------
{
  const { progression } = newCampaign();
  progression.completeLevel(1, { score: 4000 });
  progression.completeLevel(2);
  progression.completeLevel(3);
  progression.completeLevel(4);
  progression.completeLevel(5);

  const before = progression.getSnapshot();

  progression.completeLevel(2);
  progression.completeLevel(5);
  progression.completeLevel(5);

  const after = progression.getSnapshot();

  equal('5 a repeat completion does not duplicate', after.completedLevels.join(','), '1,2,3,4,5');
  equal('5a the unlock level does not move backwards', after.highestUnlockedLevel, 6);
  equal('5b the snapshot is unchanged apart from scores', JSON.stringify(after.bestScores), JSON.stringify(before.bestScores));

  // Replaying an old level with a lower score must not lower a personal best.
  progression.completeLevel(1, { score: 10 });
  equal('5c a worse replay does not lower the best', progression.getBestScore(1), 4000);
  progression.completeLevel(1, { score: 99999 });
  equal('5d a better replay raises the best', progression.getBestScore(1), 99999);
  equal('5e completions are still unique', new Set(progression.getCompletedLevels()).size, 5);
}

// ---------------------------------------------------------------------------
// Required case 6: finishing the last level needs no level after it to exist.
// The count comes from the catalogue rather than a hardcoded 5, so adding a level
// does not quietly turn this into a false failure.
// ---------------------------------------------------------------------------
{
  const { progression } = newCampaign();
  const levels = new LevelManager();
  const lastId = levels.getLevelCount();

  for (const level of levels.getAllLevels()) progression.completeLevel(level.id);

  // One past the end is expected, and harmless: the level list simply has no such
  // id, so nothing unlocks that should not.
  equal(
    `6 completing level ${lastId} leaves the unlock one past the end`,
    progression.getHighestUnlockedLevel(),
    lastId + 1
  );
  equal('6a there is no level after the last one', levels.getLevel(lastId + 1), null);
  equal('6b and it cannot be launched', canLaunch(progression, levels, lastId + 1), false);
  equal(
    '6c every level in the list is complete',
    levels.getAllLevels().every((level) => progression.isCompleted(level.id)),
    true
  );
  equal('6d the level list still refuses to advance past the end', (function () {
    levels.loadFirstLevel();
    for (let step = 0; step < 20; step++) levels.nextLevel();

    return levels.nextLevel();
  })(), false);

  // Completing a level in the middle still opens the one after it, in order.
  const midway = newCampaign();

  midway.progression.completeLevel(5);

  equal('6e finishing level 5 opens level 6', midway.progression.isUnlocked(6), true);
}

// ---------------------------------------------------------------------------
// Required case 7: a locked level cannot be launched.
// ---------------------------------------------------------------------------
{
  const { progression } = newCampaign();
  const levels = new LevelManager();

  equal('7a a fresh campaign cannot launch level 3', canLaunch(progression, levels, 3), false);
  equal('7b a fresh campaign can launch level 1', canLaunch(progression, levels, 1), true);
  equal('7c a bad id is never unlocked', progression.isUnlocked(0), false);
  equal('7d a negative id is never unlocked', progression.isUnlocked(-1), false);
  equal('7e a fractional id is never unlocked', progression.isUnlocked(1.5), false);

  progression.completeLevel(1);

  equal('7f unlocking level 1 lets level 2 launch', canLaunch(progression, levels, 2), true);
  equal('7g level 3 is still refused', canLaunch(progression, levels, 3), false);

  // Earning the last level opens every level below it, never one above.
  progression.completeLevel(levels.getLevelCount());

  const lastId = levels.getLevelCount();

  equal('7h completing the last level does not open one past it', canLaunch(progression, levels, lastId + 1), false);
  equal('7i the whole played range is open', levels.getAllLevels().every((level) => canLaunch(progression, levels, level.id)), true);
}

// ---------------------------------------------------------------------------
// Required case 8: progress survives a reload.
// ---------------------------------------------------------------------------
{
  const store = createMemoryStore();
  const first = newCampaign(store);

  first.progression.completeLevel(1, { score: 1500 });
  first.progression.completeLevel(2, { score: 2400 });

  // "Reload": a brand new manager and storage over the same bytes.
  const reloaded = new ProgressionManager(createProgressionStorage(store));

  equal('8a completions survive a reload', reloaded.getCompletedLevels().join(','), '1,2');
  equal('8b the unlock level survives a reload', reloaded.getHighestUnlockedLevel(), 3);
  equal('8c level 3 is playable after the reload', reloaded.isUnlocked(3), true);
  equal('8d best scores survive a reload', reloaded.getBestScore(1), 1500);

  // And a second reload, to prove the save is written on every change.
  const reloadedAgain = new ProgressionManager(createProgressionStorage(store));

  equal('8e the save is stable across reloads', reloadedAgain.getHighestUnlockedLevel(), 3);
  equal('8f the stored key is the agreed one', store.getItem(PROGRESSION_STORAGE_KEY) !== null, true);

  // Only progress is persisted: no board, no attempt, no audio.
  const raw = JSON.parse(store.getItem(PROGRESSION_STORAGE_KEY) as string) as Record<string, unknown>;

  equal('8g nothing but progress is stored', Object.keys(raw).sort().join(','), 'bestScores,completedLevels,highestUnlockedLevel');
  equal('8h no board is stored', JSON.stringify(raw).indexOf('board'), -1);
  equal('8i no audio state is stored', JSON.stringify(raw).indexOf('muted'), -1);
}

// ---------------------------------------------------------------------------
// Required case 9: unusable stored data falls back safely.
// ---------------------------------------------------------------------------
{
  const cases: [string, string][] = [
    ['not JSON at all', 'this is not json'],
    ['truncated JSON', '{"highestUnlockedLevel": 3'],
    ['a JSON array', '[1,2,3]'],
    ['JSON null', 'null'],
    ['an empty string', ''],
    ['a JSON string', '"hello"'],
  ];

  for (const [label, contents] of cases) {
    const store = createMemoryStore();

    store.setItem(PROGRESSION_STORAGE_KEY, contents);

    const progression = new ProgressionManager(createProgressionStorage(store));

    equal(`9 malformed data (${label}) falls back to a fresh campaign`, progression.getHighestUnlockedLevel(), 1);
    equal(`9 malformed data (${label}) has no completions`, progression.getCompletedLevels().length, 0);
    check(`9 malformed data (${label}) still allows level 1`, progression.isUnlocked(1));
    check(`9 malformed data (${label}) still refuses level 2`, !progression.isUnlocked(2));
  }

  // Structurally valid JSON with the wrong field types is repaired, not trusted.
  const messy = createMemoryStore();

  messy.setItem(
    PROGRESSION_STORAGE_KEY,
    JSON.stringify({
      highestUnlockedLevel: 'four',
      completedLevels: [1, '2', 3, -4, 2.5, null],
      bestScores: { 1: 900, bad: 'x', 2: -50, 3: Number.NaN },
    })
  );

  const repaired = new ProgressionManager(createProgressionStorage(messy));

  equal('9a only real ids survive', repaired.getCompletedLevels().join(','), '1,3');
  equal('9b the unlock level is rebuilt from the completions', repaired.getHighestUnlockedLevel(), 4);
  equal('9c only sane best scores survive', JSON.stringify(repaired.getSnapshot().bestScores), JSON.stringify({ 1: 900 }));
  equal('9d unusable best score entries are dropped', repaired.getBestScore(2), null);

  // Contradictory data: level 5 finished but only level 1 unlocked.
  const contradiction = createMemoryStore();

  contradiction.setItem(
    PROGRESSION_STORAGE_KEY,
    JSON.stringify({ highestUnlockedLevel: 1, completedLevels: [5], bestScores: {} })
  );

  const recovered = new ProgressionManager(createProgressionStorage(contradiction));

  equal('9e a finished level forces its own unlock', recovered.getHighestUnlockedLevel(), 6);

  // A save claiming progress beyond the level list must not invent levels.
  const tooFar = createMemoryStore();

  tooFar.setItem(PROGRESSION_STORAGE_KEY, JSON.stringify({ highestUnlockedLevel: 99, completedLevels: [], bestScores: {} }));

  const clamped = new ProgressionManager(createProgressionStorage(tooFar));
  const levels = new LevelManager();

  equal('9f an inflated unlock cannot launch a missing level', canLaunch(clamped, levels, 99), false);
  equal('9g and the real levels still work', canLaunch(clamped, levels, 1), true);

  // Sanitiser used directly, since GameState-style callers may hand it anything.
  equal('9h sanitising null gives a fresh campaign', JSON.stringify(sanitizeProgression(null)), JSON.stringify({ highestUnlockedLevel: 1, completedLevels: [], bestScores: {} }));
}

// ---------------------------------------------------------------------------
// Required case 10: resetProgress returns to the initial state.
// ---------------------------------------------------------------------------
{
  const store = createMemoryStore();
  const { progression } = newCampaign(store);

  progression.completeLevel(1);
  progression.completeLevel(2);
  progression.completeLevel(3);
  progression.completeLevel(1, { score: 5000 });

  const afterReset = progression.resetProgress();

  equal('10a reset returns the unlock level to 1', afterReset.highestUnlockedLevel, 1);
  equal('10b reset clears completions', afterReset.completedLevels.length, 0);
  equal('10c reset clears best scores', JSON.stringify(afterReset.bestScores), '{}');
  equal('10d the live manager agrees', progression.getHighestUnlockedLevel(), 1);
  check('10e level 1 is playable again', progression.isUnlocked(1));
  check('10f level 2 is locked again', !progression.isUnlocked(2));
  equal('10g the save was cleared, not just the memory', store.getItem(PROGRESSION_STORAGE_KEY), null);
  equal('10h and a reload confirms it', new ProgressionManager(createProgressionStorage(store)).getCompletedLevels().length, 0);
}

// ---------------------------------------------------------------------------
// Extra safety: storage that refuses to work must not break the session.
// ---------------------------------------------------------------------------
{
  const blocked: KeyValueStore = {
    getItem: () => {
      throw new Error('storage disabled');
    },
    setItem: () => {
      throw new Error('quota exceeded');
    },
    removeItem: () => {
      throw new Error('storage disabled');
    },
  };

  const progression = new ProgressionManager(createProgressionStorage(blocked));

  equal('blocked storage still opens a campaign', progression.getHighestUnlockedLevel(), 1);

  progression.completeLevel(1);

  equal('a completion still works in memory', progression.isUnlocked(2), true);
  equal('progress survives for the session', progression.getHighestUnlockedLevel(), 2);

  progression.resetProgress();

  equal('reset works in memory too', progression.getHighestUnlockedLevel(), 1);

  // No browser storage at all falls back to memory rather than throwing.
  const noStorage = createProgressionStorage(null);
  const memoryOnly = new ProgressionManager(noStorage);

  memoryOnly.completeLevel(1);

  equal('with no storage the game still plays on', memoryOnly.isUnlocked(2), true);
}

// ---------------------------------------------------------------------------
// Extra safety: listeners see every change, and see a copy.
// ---------------------------------------------------------------------------
{
  const { progression } = newCampaign();
  const seen: number[] = [];

  const unsubscribe = progression.subscribe((data) => seen.push(data.highestUnlockedLevel));

  progression.completeLevel(1);
  progression.completeLevel(2);
  progression.resetProgress();

  equal('listeners are notified on every change', seen.join(','), '2,3,1');

  unsubscribe();
  progression.completeLevel(1);

  equal('unsubscribing stops the notifications', seen.length, 3);

  // Mutations to a handed-out snapshot must not reach the manager.
  const snapshot = progression.getSnapshot();

  equal('the snapshot started from the live state', snapshot.completedLevels.length, 1);

  snapshot.completedLevels.push(99);
  snapshot.highestUnlockedLevel = 50;

  equal('the snapshot is a copy, not the live state', progression.getCompletedLevels().length, 1);
  equal('and the unlock level is untouched', progression.getHighestUnlockedLevel(), 2);
}

// ---------------------------------------------------------------------------
// Extra safety: the storage adapter writes and clears through its own interface.
// ---------------------------------------------------------------------------
{
  const store = createMemoryStore();
  const storage: ProgressionStorage = createProgressionStorage(store);

  equal('an empty store reads as no save', storage.load(), null);

  storage.save({ highestUnlockedLevel: 3, completedLevels: [1, 2], bestScores: { 1: 800 } });

  const loaded = storage.load();

  equal('a saved campaign reads back', loaded === null ? null : loaded.highestUnlockedLevel, 3);

  storage.clear();

  equal('clearing removes the save', storage.load(), null);
}

console.log(`${passed} passed, ${failures.length} failed`);
for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);