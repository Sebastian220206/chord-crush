/**
 * Tests for the pure half of the effect system: the tuning data and the
 * calculations that decide how an event looks.
 *
 * The effects themselves are Phaser objects and are deliberately not tested here.
 * A test that needed a renderer would be testing Phaser, not this code, so what is
 * covered is the part that can be wrong on its own: which tier a depth maps to, what
 * a label says, and whether the tuning stays inside the bounds the effects rely on.
 */
import {
  CASCADE_TIERS,
  CHORD_EFFECT_STYLES,
  DEFAULT_CHORD_EFFECT,
  IMPACT,
  MATCH_POP,
  cascadeLabel,
  cascadeTier,
  formatScorePopup,
} from '../src/game/effects/effectConfig';
import type { CascadeTier } from '../src/game/effects/effectConfig';

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

// ---------------------------------------------------------------- cascade tier

equal('depth 1 is tier 1', cascadeTier(1), 1);
equal('depth 0 is tier 1', cascadeTier(0), 1);
equal('depth 2 is tier 2', cascadeTier(2), 2);
equal('depth 3 is tier 3', cascadeTier(3), 3);
equal('depth 4 is tier 4', cascadeTier(4), 4);
equal('depth 9 is tier 4', cascadeTier(9), 4);
equal('a fractional depth floors to a tier', cascadeTier(2.9), 2);
equal('a non-finite depth is tier 1', cascadeTier(Number.NaN), 1);

// The label and the tier must agree: a depth that earns a label must not be tier 1.
for (let depth = 1; depth <= 8; depth++) {
  const label = cascadeLabel(depth);
  const tier = cascadeTier(depth);

  check(
    `depth ${depth} label and tier agree`,
    (label === '') === (tier === 1),
    `label "${label}" tier ${tier}`
  );
}

equal('depth 1 has no cascade label', cascadeLabel(1), '');
equal('depth 2 label', cascadeLabel(2), 'CASCADE x2!');
equal('depth 3 label', cascadeLabel(3), 'CASCADE x3!');
equal('depth 4 label', cascadeLabel(4), 'CASCADE x4!');
equal('depth 7 label', cascadeLabel(7), 'CASCADE x7!');

// ---------------------------------------------------------------- tier tuning

// Each tier must be at least as strong as the one before it, or the climb from a
// small cascade to a big one would not read.
const tiers: CascadeTier[] = [1, 2, 3, 4];

for (let index = 1; index < tiers.length; index++) {
  const previous = CASCADE_TIERS[tiers[index - 1]];
  const current = CASCADE_TIERS[tiers[index]];

  check(
    `tier ${tiers[index]} is at least as strong as tier ${tiers[index - 1]}`,
    current.scaleTo >= previous.scaleTo && current.particles >= previous.particles,
    `scaleTo ${current.scaleTo} vs ${previous.scaleTo}, particles ${current.particles} vs ${previous.particles}`
  );
}

// Only the top tier shakes. A shake on every cascade would be noise, and the whole
// point of the tier system is that shake is reserved for the heavy end.
for (const tier of tiers) {
  check(
    `tier ${tier} shake flag matches its strength`,
    CASCADE_TIERS[tier].shake === (tier === 4),
    `shake ${CASCADE_TIERS[tier].shake}`
  );
}

// Every tier must actually animate, or the label would just appear.
for (const tier of tiers) {
  check(`tier ${tier} has a positive duration`, CASCADE_TIERS[tier].duration > 0);
  check(`tier ${tier} starts below its peak scale`, CASCADE_TIERS[tier].scaleFrom < CASCADE_TIERS[tier].scaleTo);
}

// ---------------------------------------------------------------- score popup

equal('a whole number formats plainly', formatScorePopup(100), '+100');
equal('a fractional score floors', formatScorePopup(250.9), '+250');
equal('zero formats as +0', formatScorePopup(0), '+0');
equal('a negative score clamps to +0', formatScorePopup(-50), '+0');
equal('a non-finite score is +0', formatScorePopup(Number.NaN), '+0');
equal('a large score is not abbreviated', formatScorePopup(12345), '+12345');

// ---------------------------------------------------------------- match pop

check('the pop swells past 1', MATCH_POP.scaleUp > 1);
check('the pop is quick', MATCH_POP.scaleUpDuration + MATCH_POP.scaleDownDuration <= 250);
check('a burst is a small number of particles', MATCH_POP.particlesPerTile <= 12);
check(
  'the burst cap keeps a stage bounded',
  MATCH_POP.maxBurstsPerStage * MATCH_POP.particlesPerTile <= 60,
  `${MATCH_POP.maxBurstsPerStage * MATCH_POP.particlesPerTile}`
);

// ---------------------------------------------------------------- chord styles

// The three playable qualities each have their own look, which is what lets a
// player tell them apart by colour.
check('major has a style', CHORD_EFFECT_STYLES.major !== undefined);
check('minor has a style', CHORD_EFFECT_STYLES.minor !== undefined);
check('diminished has a style', CHORD_EFFECT_STYLES.diminished !== undefined);

// The suspended qualities have no chord, so they must have no style to fall back on.
check('sus2 has no style of its own', CHORD_EFFECT_STYLES.sus2 === undefined);
check('sus4 has no style of its own', CHORD_EFFECT_STYLES.sus4 === undefined);

// Diminished is the rarest and least stable, so it should be the most intense.
const diminished = CHORD_EFFECT_STYLES.diminished;
const major = CHORD_EFFECT_STYLES.major;

check(
  'diminished is at least as intense as major',
  diminished !== undefined && major !== undefined && diminished.particles >= major.particles
);
check(
  'diminished pops in at least as fast',
  diminished !== undefined && major !== undefined && diminished.popDuration <= major.popDuration
);

// Every style needs a text colour and a particle colour, or the label and the
// burst would not match.
for (const [quality, style] of Object.entries(CHORD_EFFECT_STYLES)) {
  check(`the ${quality} style has a text colour`, typeof style?.cssColor === 'string' && style.cssColor.length > 0);
  check(`the ${quality} style has a particle colour`, typeof style?.color === 'number');
  check(`the ${quality} style throws particles`, (style?.particles ?? 0) > 0);
}

// The default is a complete style, so a quality with no entry still gets a full look.
check('the default style is complete', DEFAULT_CHORD_EFFECT.cssColor.length > 0 && DEFAULT_CHORD_EFFECT.particles > 0);

// ---------------------------------------------------------------- impact

// Shakes must stay tiny: enough to register as weight, far below anything that reads
// as a glitch. The values are the whole safety argument for the effect.
for (const [name, impact] of Object.entries(IMPACT)) {
  check(`the ${name} shake is brief`, impact.duration <= 150, `${impact.duration}ms`);
  check(`the ${name} shake is subtle`, impact.intensity <= 0.005, String(impact.intensity));
  check(`the ${name} shake is positive`, impact.duration > 0 && impact.intensity > 0);
}

// A color bomb is the biggest thing that can happen mid-level, so it should shake at
// least as hard as a line clear.
check(
  'a color bomb shakes at least as hard as a line clear',
  IMPACT.colorBomb.intensity >= IMPACT.lineClear.intensity
);

console.log(`${passed} passed, ${failures.length} failed`);
for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
