/**
 * Visual tuning for every effect in the game, plus the few pure calculations those
 * effects need.
 *
 * Everything here is data or arithmetic: no Phaser, no scene, no game state. That
 * split is deliberate. The numbers are the part that gets tweaked while polishing,
 * and keeping them in one place means a change to how a cascade feels is a change
 * to one object rather than a hunt through the scene. It also means the rules
 * ("what tier is depth 3?", "what does a popup say?") can be tested without a
 * renderer.
 *
 * Nothing here is a gameplay rule. Scores, moves, objectives and match detection
 * are untouched; this file only describes how already-decided events look.
 */

import type { ChordQuality } from '../music/Chord';

// ---------------------------------------------------------------- cascade

/**
 * How hard a cascade hits, as a four-step scale.
 *
 * Depth 1 is an ordinary match and gets no cascade treatment at all: the match pop
 * is its feedback, and labelling every match "CASCADE!" would be noise. From depth 2
 * up the tiers climb, with 4 and beyond sharing the top tier because the difference
 * between a four-stage and a six-stage cascade is not worth a fourth level of
 * chrome.
 */
export type CascadeTier = 1 | 2 | 3 | 4;

export function cascadeTier(depth: number): CascadeTier {
  if (!Number.isFinite(depth)) return 1;

  // Floored first: the depth is a counter in practice, but a fractional value should
  // land in the tier below it rather than falling through to the top.
  const level = Math.floor(depth);

  if (level < 2) return 1;
  if (level === 2) return 2;
  if (level === 3) return 3;

  return 4;
}

/** The label for a cascade, or '' when the depth is not a cascade worth naming. */
export function cascadeLabel(depth: number): string {
  if (!Number.isFinite(depth) || depth < 2) return '';

  return `CASCADE x${Math.floor(depth)}!`;
}

export interface CascadeTierConfig {
  /** Scale the label starts from, so it reads as popping in. */
  scaleFrom: number;
  /** Peak scale. Above 1 for the top tiers, which is what makes them feel bigger. */
  scaleTo: number;
  /** How long the pop-in takes. */
  duration: number;
  /** Particles thrown out, on top of the match bursts already happening. */
  particles: number;
  /** Whether this tier is heavy enough to nudge the camera. */
  shake: boolean;
}

export const CASCADE_TIERS: Record<CascadeTier, CascadeTierConfig> = {
  1: { scaleFrom: 0.7, scaleTo: 1, duration: 160, particles: 0, shake: false },
  2: { scaleFrom: 0.65, scaleTo: 1.05, duration: 180, particles: 10, shake: false },
  3: { scaleFrom: 0.6, scaleTo: 1.15, duration: 220, particles: 16, shake: false },
  4: { scaleFrom: 0.5, scaleTo: 1.25, duration: 240, particles: 24, shake: true },
};

// ---------------------------------------------------------------- match pop

export const MATCH_POP = {
  /** How far a matched tile grows before it collapses. */
  scaleUp: 1.18,
  scaleUpDuration: 90,
  scaleDownDuration: 110,
  /** Particles per tile that actually gets a burst. */
  particlesPerTile: 6,
  /**
   * Upper bound on bursts in one stage.
   *
   * A stage can clear a whole line, and a particle per tile would mean dozens of
   * emitters firing at once. Capping the bursts keeps the count flat no matter how
   * big the clear is, while every tile still gets its pop animation.
   */
  maxBurstsPerStage: 8,
};

// ---------------------------------------------------------------- selection

export const SELECTION = {
  /** Resting scale of the selected tile. */
  scale: 1.05,
  /** How long the scale-up takes. */
  duration: 120,
  /** Peak of the idle pulse. */
  pulseScale: 1.09,
  /** One pulse cycle. Long enough to read as alive without demanding attention. */
  pulseDuration: 340,
};

// ---------------------------------------------------------------- invalid swap

export const INVALID_SWAP = {
  /** Total time for the bounce back. Short: a rejection, not an event. */
  duration: 150,
  /** How far the tiles swell as they bounce back. */
  scale: 1.08,
};

// ---------------------------------------------------------------- score popup

export const SCORE_POPUP = {
  /** Total lifetime. Long enough to read, short enough to never pile up. */
  duration: 650,
  /** How far it rises while fading. */
  rise: 34,
  fontSize: 20,
  color: '#ffd166',
};

/** The text of a score popup. */
export function formatScorePopup(points: number): string {
  if (!Number.isFinite(points)) return '+0';

  return `+${Math.max(0, Math.floor(points))}`;
}

// ---------------------------------------------------------------- combo

export const COMBO_PULSE = {
  /** Peak scale, then back to 1. */
  scale: 1.25,
  duration: 130,
};

// ---------------------------------------------------------------- chord

export interface ChordEffectStyle {
  /** Particle tint. */
  color: number;
  /** The same colour as text, for the announcement label. */
  cssColor: string;
  /** How many particles the announcement throws out. */
  particles: number;
  /** Pop-in time for the announcement label. */
  popDuration: number;
}

/**
 * One look per chord quality.
 *
 * Three entries, because colour is the whole point: it is how a player tells a
 * major from a minor from a diminished without reading the label. Diminished gets
 * more particles and a faster pop, matching it being the rarest and least stable.
 *
 * Partial because ChordQuality also reserves the suspended qualities, which have no
 * chord to announce. Anything without an entry falls back to the default.
 */
export const CHORD_EFFECT_STYLES: Partial<Record<ChordQuality, ChordEffectStyle>> = {
  major: { color: 0xffd166, cssColor: '#ffd166', particles: 10, popDuration: 180 },
  minor: { color: 0x7be0d0, cssColor: '#7be0d0', particles: 8, popDuration: 180 },
  diminished: { color: 0xff8fab, cssColor: '#ff8fab', particles: 14, popDuration: 120 },
};

export const DEFAULT_CHORD_EFFECT: ChordEffectStyle = {
  color: 0xffd166,
  cssColor: '#ffd166',
  particles: 10,
  popDuration: 180,
};

// ---------------------------------------------------------------- special tiles

export const SPECIAL_EFFECT = {
  /** Width of the line-clear sweep, in pixels. */
  lineWidth: 6,
  lineColor: 0xffffff,
  /** How long the sweep lingers before fading. */
  lineDuration: 260,
  /** Particles dropped along the sweep, at intervals. */
  lineParticles: 3,
  lineParticleSteps: 6,
  /** Radial burst size for a color bomb. */
  radialParticles: 24,
  /** Extra white sparks mixed into a radial burst. */
  radialSparks: 12,
};

// ---------------------------------------------------------------- screen shake

export interface Impact {
  duration: number;
  intensity: number;
}

/**
 * Camera shake values, kept deliberately tiny.
 *
 * The numbers are small because a shake that is felt rather than seen is the goal:
 * enough to register as weight, far below anything that reads as a glitch or causes
 * discomfort. Normal matches never shake at all.
 */
export const IMPACT = {
  lineClear: { duration: 120, intensity: 0.004 } as Impact,
  colorBomb: { duration: 150, intensity: 0.005 } as Impact,
  bigCascade: { duration: 100, intensity: 0.003 } as Impact,
  levelComplete: { duration: 150, intensity: 0.005 } as Impact,
};

// ---------------------------------------------------------------- board pulse

export const BOARD_PULSE = {
  /** How far the whole board swells. */
  scale: 1.04,
  duration: 110,
};

// ---------------------------------------------------------------- level end

export const LEVEL_COMPLETE = {
  /** Board alpha while the overlay is up. */
  dimAlpha: 0.35,
  dimDuration: 300,
  /** Celebratory burst size. */
  particles: 30,
  particleColor: 0xffd166,
  /** Overlay entrance: 0.8 -> 1.1 -> 1.0. */
  overlayFrom: 0.8,
  overlayMid: 1.1,
  overlayIn: 180,
  overlaySettle: 140,
};

export const LEVEL_FAILED = {
  dimAlpha: 0.5,
  dimDuration: 400,
  /** Gentler entrance: a loss should not feel like a celebration. */
  overlayFrom: 0.9,
  overlayMid: 1.0,
  overlayIn: 200,
  overlaySettle: 120,
};

// ---------------------------------------------------------------- particles

export const PARTICLES = {
  /** Texture key for the shared dot. */
  textureKey: 'fx-dot',
  /** Texture size. One small texture for every effect in the game. */
  textureSize: 8,
  speedMin: 60,
  speedMax: 190,
  lifespanMin: 300,
  lifespanMax: 560,
  gravityY: 220,
  /** Depth above tiles and HUD, below popups. */
  depth: 20,
};

/** Depth for transient effect objects (sweeps, popups). */
export const FX_DEPTH = 25;

/** Depth for score popups, above the sweep. */
export const POPUP_DEPTH = 30;
