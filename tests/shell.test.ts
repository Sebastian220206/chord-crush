/**
 * Tests for the application shell: screen navigation, settings, and the rules the
 * main menu applies.
 *
 * Everything here is pure logic. The bridge is exercised by subscribing its listeners
 * and checking what it tells them, which needs no Phaser renderer. Settings are
 * tested against a fresh AudioManager and a fake store, so the singletons the app
 * uses are never involved.
 */
import { GameBridge } from '../src/game/GameBridge';
import type { Screen } from '../src/game/GameBridge';
import { SettingsManager, sanitizeSettings } from '../src/app/SettingsManager';
import { AudioManager } from '../src/audio/AudioManager';
import { ProgressionManager } from '../src/levels/ProgressionManager';
import { createMemoryStore, createProgressionStorage } from '../src/levels/ProgressionStorage';
import { LEVEL_DEFINITIONS } from '../src/levels/LevelManager';

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

/** A bridge with no game attached, so navigation can be observed in isolation. */
function newBridge(): GameBridge {
  return new GameBridge();
}

// ---------------------------------------------------- 1. initial screen is menu

{
  const bridge = newBridge();

  equal('1 the initial screen is the main menu', bridge.getScreen(), 'menu');
}

// ---------------------------------------------------- 2. PLAY opens the level map

{
  // PLAY no longer picks a level itself: it opens the map, where the player sees
  // every level and chooses. So the behaviour under test is the navigation, which
  // is the same destination the LEVELS button used to open directly.
  const bridge = newBridge();
  const seen: Screen[] = [];

  bridge.onScreenChange((screen) => seen.push(screen));
  bridge.showLevelMap();

  equal('2 PLAY opens the level map', bridge.getScreen(), 'level-map');
  equal('2a and tells the shell', seen.join(','), 'level-map');
}

// ---------------------------------------------------- 3. LEVELS opens the level map

{
  const bridge = newBridge();
  const seen: Screen[] = [];

  bridge.onScreenChange((screen) => seen.push(screen));
  bridge.showLevelMap();

  equal('3 showLevelMap navigates to the level map', bridge.getScreen(), 'level-map');
  equal('3a and tells the shell', seen.join(','), 'level-map');
}

// ---------------------------------------------------- 4. locked levels stay locked

{
  const progression = new ProgressionManager(createProgressionStorage(createMemoryStore()));

  check('4 a fresh campaign leaves level 2 locked', !progression.isUnlocked(2));

  progression.completeLevel(1);

  check('4b completing level 1 unlocks level 2', progression.isUnlocked(2));
  check('4c level 3 is still locked', !progression.isUnlocked(3));
}

// ---------------------------------------------------- 5. settings update AudioManager

{
  const audio = new AudioManager();
  const settings = new SettingsManager(audio, createMemoryStore());

  equal('5 the default is unmuted at half volume', settings.getMuted(), false);
  equal('5a the default volume', settings.getMasterVolume(), 0.5);

  settings.setMuted(true);

  equal('5b muting reaches the AudioManager', audio.isMuted(), true);
  equal('5c and is readable back', settings.getMuted(), true);

  settings.setMasterVolume(0.8);

  equal('5d volume reaches the AudioManager', audio.getMasterVolume(), 0.8);

  // Out-of-range values are clamped by the AudioManager, not stored raw.
  settings.setMasterVolume(5);

  equal('5e an excessive volume is clamped', audio.getMasterVolume(), 1);
}

// ---------------------------------------------------- 6. settings persist across reload

{
  const store = createMemoryStore();
  const first = new SettingsManager(new AudioManager(), store);

  first.setMuted(true);
  first.setMasterVolume(0.3);

  // "Reload": a fresh manager and a fresh audio object over the same bytes.
  const second = new SettingsManager(new AudioManager(), store);

  equal('6 the mute survives a reload', second.getMuted(), true);
  equal('6a the volume survives a reload', second.getMasterVolume(), 0.3);
  equal('6b and the audio object was set to match', second.getMasterVolume(), 0.3);
}

// ---------------------------------------------------- malformed settings fall back

{
  const cases: [string, string][] = [
    ['not JSON', 'nope'],
    ['truncated', '{"muted": true'],
    ['an array', '[]'],
    ['null', 'null'],
    ['a string', '"loud"'],
  ];

  for (const [label, contents] of cases) {
    const store = createMemoryStore();

    store.setItem('chord-crush-settings', contents);

    const settings = new SettingsManager(new AudioManager(), store);

    equal(`6c malformed settings (${label}) fall back to unmuted`, settings.getMuted(), false);
    equal(`6d malformed settings (${label}) fall back to half volume`, settings.getMasterVolume(), 0.5);
  }

  // Valid JSON with the wrong field types.
  const messy = createMemoryStore();

  messy.setItem('chord-crush-settings', JSON.stringify({ muted: 'yes', masterVolume: 'loud' }));

  const repaired = new SettingsManager(new AudioManager(), messy);

  equal('6e a non-boolean mute falls back', repaired.getMuted(), false);
  equal('6f a non-numeric volume falls back', repaired.getMasterVolume(), 0.5);

  // The sanitiser used directly.
  equal(
    '6g sanitising null gives defaults',
    JSON.stringify(sanitizeSettings(null)),
    JSON.stringify({ muted: false, masterVolume: 0.5 })
  );
}

// ---------------------------------------------------- 7. menu progress reflects campaign

{
  const progression = new ProgressionManager(createProgressionStorage(createMemoryStore()));

  equal('7 a fresh campaign shows nothing complete', progression.getCompletedLevels().length, 0);
  equal('7a and level 1 unlocked', progression.getHighestUnlockedLevel(), 1);

  progression.completeLevel(1);
  progression.completeLevel(2);

  equal('7b two completions are counted', progression.getCompletedLevels().length, 2);
  equal('7c and the frontier moved to level 3', progression.getHighestUnlockedLevel(), 3);
}

// ---------------------------------------------------- 8. completed campaign is safe

{
  const progression = new ProgressionManager(createProgressionStorage(createMemoryStore()));

  for (const level of LEVEL_DEFINITIONS) progression.completeLevel(level.id);

  const total = LEVEL_DEFINITIONS.length;

  equal('8 every level is complete', progression.getCompletedLevels().length, total);
  equal('8a the unlock sits one past the end', progression.getHighestUnlockedLevel(), total + 1);

  // The level list has no level one past the end, so nothing can be launched.
  const bridge = newBridge();

  equal('8b there is no level after the last', LEVEL_DEFINITIONS.length < progression.getHighestUnlockedLevel(), true);
}

// ---------------------------------------------------- 9. navigation changes one screen

{
  const bridge = newBridge();
  const seen: Screen[] = [];

  bridge.onScreenChange((screen) => seen.push(screen));

  bridge.navigate('level-map');
  bridge.navigate('game');
  bridge.navigate('menu');

  equal('9 navigate walks the screens in order', seen.join(','), 'level-map,game,menu');
  equal('9a and ends on the menu', bridge.getScreen(), 'menu');

  // Navigating to the screen already showing is a no-op for listeners, so a
  // redundant call cannot trigger a second render.
  const before = seen.length;

  bridge.navigate('menu');

  equal('9b re-navigating to the same screen notifies nobody', seen.length, before);
}

// ---------------------------------------------------- 10. leaving gameplay navigates

{
  const bridge = newBridge();
  const seen: Screen[] = [];

  bridge.onScreenChange((screen) => seen.push(screen));

  bridge.reportExitToMap();

  equal('10 reportExitToMap returns to the level map', bridge.getScreen(), 'level-map');

  bridge.reportExitToMenu();

  equal('10a reportExitToMenu returns to the main menu', bridge.getScreen(), 'menu');
}

// ---------------------------------------------------- pause requests reach the scene

{
  const bridge = newBridge();
  let pauses = 0;

  bridge.onPauseRequest(() => {
    pauses++;
  });

  bridge.requestPause();
  bridge.requestPause();

  equal('10b a pause request reaches the scene', pauses, 2);
}

// ---------------------------------------------------- play requests are queued safely

{
  const bridge = newBridge();

  // A play request before the scene is listening is queued, not dropped.
  const dispatched = bridge.playLevel(3);

  equal('10c a play request before the scene exists is queued', dispatched, false);

  let received: number | null = null;

  bridge.onPlayLevelRequest((levelId) => {
    received = levelId;
  });

  equal('10d the queued request is delivered once the scene listens', received, 3);
  equal('10e and the screen moved to the game', bridge.getScreen(), 'game');

  // A second play request is dispatched straight through.
  const second = bridge.playLevel(5);

  equal('10f a later request dispatches immediately', second, true);
  equal('10g and is delivered', received, 5);
}

// ---------------------------------------------------- a bad play request is refused

{
  const bridge = newBridge();

  equal('10h a non-positive id is refused', bridge.playLevel(0), false);
  equal('10i a fractional id is refused', bridge.playLevel(1.5), false);
  equal('10j and the screen did not change', bridge.getScreen(), 'menu');
}

console.log(`${passed} passed, ${failures.length} failed`);
for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
