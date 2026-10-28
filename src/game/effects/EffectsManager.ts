/**
 * Owns every visual effect in the game: particles, popups, cascade labels, screen
 * shake, board pulses and the level-end entrances.
 *
 * Presentation only, and that is enforced by what it is handed. The manager gets a
 * scene's factories, tween manager, camera manager and texture manager, and nothing
 * else: no Board, no GameState, no score, no moves. It cannot change the game even
 * if it wanted to, which is the property that makes the juice safe to add freely.
 *
 * Two rules keep it from rotting into a source of bugs:
 *
 * - Nothing is scheduled with setTimeout. Every effect is a Phaser tween or a
 *   one-shot particle burst, so the scene's own shutdown cleans up anything still
 *   running and an effect can never fire after the level it belonged to.
 * - Temporary objects destroy themselves. Popups and sweeps are removed in their
 *   tween's onComplete, and the particle emitters are a fixed pool that outlives
 *   any single effect rather than being created and destroyed per burst.
 */

import Phaser from 'phaser';
import type { ChordQuality } from '../music/Chord';
import {
  BOARD_PULSE,
  CASCADE_TIERS,
  COMBO_PULSE,
  CHORD_EFFECT_STYLES,
  DEFAULT_CHORD_EFFECT,
  FX_DEPTH,
  IMPACT,
  INVALID_SWAP,
  LEVEL_COMPLETE,
  LEVEL_FAILED,
  MATCH_POP,
  PARTICLES,
  POPUP_DEPTH,
  SCORE_POPUP,
  SELECTION,
  SPECIAL_EFFECT,
  cascadeTier,
} from './effectConfig';
import type { CascadeTier, ChordEffectStyle } from './effectConfig';

/**
 * The slice of a Phaser scene the manager uses.
 *
 * Structural rather than `Phaser.Scene` so the manager stays free of any scene
 * behaviour it does not need, and so the pure parts of the effect system can be
 * reasoned about without a renderer.
 */
export interface EffectHost {
  add: Phaser.GameObjects.GameObjectFactory;
  tweens: Phaser.Tweens.TweenManager;
  cameras: Phaser.Cameras.Scene2D.CameraManager;
  textures: Phaser.Textures.TextureManager;
}

/** A board cell in world coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** The tile visual the manager animates, narrowed to what it actually touches. */
export interface EffectTarget {
  container: Phaser.GameObjects.Container;
}

const WHITE = 0xffffff;

export class EffectsManager {
  private readonly host: EffectHost;

  /** One emitter per colour, created on first use. */
  private readonly emitters = new Map<number, Phaser.GameObjects.Particles.ParticleEmitter>();

  /** Live popups, so a level change can clear them. */
  private popups: Phaser.GameObjects.Text[] = [];

  /** The cascade label, created once and re-labelled per cascade. */
  private cascadeLabel: Phaser.GameObjects.Text | null = null;

  /** Whether the user prefers reduced motion. */
  private reducedMotion = false;

  constructor(host: EffectHost) {
    this.host = host;
    // Check for prefers-reduced-motion preference
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
  }

  /**
   * Creates the shared particle texture and the cascade label.
   *
   * Called once from the scene's create(). The anchor is where the cascade label
   * sits: near the top of the board, clear of the chord announcement in the middle.
   */
  initialize(anchor: Point): void {
    this.createParticleTexture();

    this.cascadeLabel = this.host.add
      .text(anchor.x, anchor.y, '', {
        fontSize: '30px',
        fontFamily: 'Arial',
        color: '#ffd166',
        fontStyle: 'bold',
        stroke: '#23234a',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(FX_DEPTH)
      .setVisible(false);
  }

  /**
   * Moves the cascade label to a new anchor.
   *
   * The scene re-derives its layout whenever the canvas changes size, and the
   * label sits near the top of the board, so the anchor has to follow it. The
   * label is only repositioned while it is idle; an announcement in flight keeps
   * its own coordinates for the few hundred milliseconds it is on screen.
   */
  setAnchor(anchor: Point): void {
    if (this.cascadeLabel && !this.cascadeLabel.visible) {
      this.cascadeLabel.setPosition(anchor.x, anchor.y);
    }
  }

  /**
   * Checks if reduced motion is preferred. Returns true if animations should be
   * minimized or skipped.
   */
  private shouldReduceMotion(): boolean {
    // Check both the stored preference and the current media query (in case it changed)
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return this.reducedMotion;
  }

  // ---------------------------------------------------------------- particles

  /** The one dot every particle in the game is drawn from. */
  private createParticleTexture(): void {
    if (this.host.textures.exists(PARTICLES.textureKey)) return;

    const graphics = this.host.add.graphics();

    graphics.fillStyle(WHITE, 1);
    graphics.fillCircle(PARTICLES.textureSize / 2, PARTICLES.textureSize / 2, PARTICLES.textureSize / 2);
    graphics.generateTexture(PARTICLES.textureKey, PARTICLES.textureSize, PARTICLES.textureSize);
    graphics.destroy();
  }

  /** The emitter for a colour, made on first use and reused thereafter. */
  private emitterFor(color: number): Phaser.GameObjects.Particles.ParticleEmitter {
    const existing = this.emitters.get(color);

    if (existing) return existing;

    const emitter = this.host.add.particles(0, 0, PARTICLES.textureKey, {
      speed: { min: PARTICLES.speedMin, max: PARTICLES.speedMax },
      angle: { min: 0, max: 360 },
      scale: { start: 1, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: { min: PARTICLES.lifespanMin, max: PARTICLES.lifespanMax },
      gravityY: PARTICLES.gravityY,
      tint: color,
      emitting: false,
    });

    emitter.setDepth(PARTICLES.depth);
    this.emitters.set(color, emitter);

    return emitter;
  }

  /**
   * Throws out a one-shot burst.
   *
   * `explode` rather than switching the emitter on, so a burst is a single event
   * with no emitter left running afterwards.
   */
  burst(x: number, y: number, color: number, count: number): void {
    if (count <= 0) return;

    this.emitterFor(color).explode(count, x, y);
  }

  // ---------------------------------------------------------------- match pop

  /**
   * The removal of one matched tile: swell, burst, glow, collapse, fade.
   *
   * The caller owns the tile's lifetime, so this reports completion through a
   * callback rather than destroying anything itself. That keeps the visual
   * lifecycle in the scene and the effect here.
   *
   * Particles are a separate call (playMatchBurst), so the scene can cap how many
   * tiles in one stage get a burst without the effect layer deciding for itself.
   */
  playMatchPop(target: EffectTarget, onComplete: () => void): void {
    const container = target.container;
    const panel = container.list[0] as Phaser.GameObjects.Rectangle | undefined;

    this.host.tweens.killTweensOf(container);

    if (this.shouldReduceMotion()) {
      // Reduced motion: immediate removal with simple fade
      this.host.tweens.add({
        targets: container,
        alpha: 0,
        duration: 60,
        ease: 'Quad.easeOut',
        onComplete: () => {
          container.setScale(0).setAlpha(0);
          onComplete();
        },
      });
      return;
    }

    // Quick scale up with glow
    this.host.tweens.add({
      targets: container,
      scale: MATCH_POP.scaleUp,
      duration: MATCH_POP.scaleUpDuration,
      ease: 'Back.easeOut',
      onComplete: () => {
        // Flash glow on the panel
        if (panel) {
          this.host.tweens.add({
            targets: panel,
            fillColor: 0xffffff,
            duration: 40,
            yoyo: true,
            repeat: 1,
            ease: 'Quad.easeOut',
            onComplete: () => {
              panel.fillColor = panel.fillColor; // Keep original color
            },
          });
        }

        // Collapse with glow fade
        this.host.tweens.add({
          targets: container,
          scale: 0,
          alpha: 0,
          duration: MATCH_POP.scaleDownDuration,
          ease: 'Back.easeIn',
          onComplete: () => {
            container.setScale(0).setAlpha(0);
            onComplete();
          },
        });
      },
    });
  }

  /**
   * The particle half of a match pop.
   *
   * The note's colour with a white core under it, which is what makes a burst read
   * as a flash rather than a spray of coloured dots.
   */
  playMatchBurst(x: number, y: number, color: number): void {
    this.burst(x, y, color, MATCH_POP.particlesPerTile);
    this.burst(x, y, WHITE, 3);
  }

  /**
   * Highlights a tile briefly before removal - a subtle glow to indicate
   * "this tile is about to be matched and removed".
   */
  playMatchHighlight(target: EffectTarget): void {
    const container = target.container;
    const panel = container.list[0] as Phaser.GameObjects.Rectangle | undefined;

    if (!panel) return;

    this.host.tweens.killTweensOf(panel);

    // Brief white glow on the tile
    this.host.tweens.add({
      targets: panel,
      fillColor: 0xffffff,
      duration: 80,
      yoyo: true,
      repeat: 1,
      ease: 'Quad.easeOut',
      onComplete: () => {
        panel.fillColor = panel.fillColor;
      },
    });
  }

  // ---------------------------------------------------------------- selection

  /** Scales a tile up and sets a slow idle pulse going. Also shows inner glow. */
  playSelection(target: EffectTarget): void {
    const container = target.container;

    this.host.tweens.killTweensOf(container);
    container.setScale(SELECTION.scale);

    this.host.tweens.add({
      targets: container,
      scale: SELECTION.pulseScale,
      duration: SELECTION.pulseDuration,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Show inner glow for selected tile (assumes target has innerGlow property)
    if ('innerGlow' in target && target.innerGlow) {
      const innerGlow = target.innerGlow as Phaser.GameObjects.Rectangle;
      innerGlow.setVisible(true);
      innerGlow.setAlpha(0.18);
      innerGlow.setStrokeStyle(2, 0xffffff, 0.5);
    }
  }

  /** Returns a selected tile to rest and stops its pulse. */
  playDeselection(target: EffectTarget): void {
    const container = target.container;

    this.host.tweens.killTweensOf(container);

    this.host.tweens.add({
      targets: container,
      scale: 1,
      duration: SELECTION.duration,
      ease: 'Sine.easeOut',
      onComplete: () => container.setScale(1),
    });

    // Hide inner glow on deselection
    if ('innerGlow' in target && target.innerGlow) {
      const innerGlow = target.innerGlow as Phaser.GameObjects.Rectangle;
      innerGlow.setVisible(false);
      innerGlow.setAlpha(0);
      innerGlow.setStrokeStyle(0, 0, 0);
    }
  }

  /**
   * Gently pulses two adjacent tiles to hint a valid move to the player.
   */
  playHintPulse(targetA: EffectTarget, targetB: EffectTarget): void {
    if (this.shouldReduceMotion()) return;

    for (const target of [targetA, targetB]) {
      const container = target.container;
      this.host.tweens.killTweensOf(container);
      container.setScale(1);

      this.host.tweens.add({
        targets: container,
        scale: 1.12,
        duration: 210,
        yoyo: true,
        repeat: 1,
        ease: 'Sine.easeInOut',
        onComplete: () => container.setScale(1),
      });

      if ('innerGlow' in target && target.innerGlow) {
        const innerGlow = target.innerGlow as Phaser.GameObjects.Rectangle;
        innerGlow.setVisible(true);
        innerGlow.setAlpha(0.28);
        innerGlow.setStrokeStyle(2, 0xffd166, 0.85);
        this.host.tweens.add({
          targets: innerGlow,
          alpha: 0,
          duration: 500,
          ease: 'Quad.easeOut',
          onComplete: () => {
            innerGlow.setVisible(false);
            innerGlow.setStrokeStyle(0, 0, 0);
          },
        });
      }
    }
  }

  // ---------------------------------------------------------------- invalid swap

  /**
   * Rejects a swap: the tiles bounce back to their own cells and swell slightly.
   *
   * The data has already been reverted by the caller, so this only has to move the
   * containers home. The travel back is the bounce; the swell is what keeps it from
   * reading as a silent snap.
   */
  playInvalidSwap(
    targetA: EffectTarget,
    targetB: EffectTarget,
    homeA: Point,
    homeB: Point,
    onComplete: () => void
  ): void {
    const a = targetA.container;
    const b = targetB.container;

    this.host.tweens.killTweensOf(a);
    this.host.tweens.killTweensOf(b);

    // Quick shake for rejection feedback
    this.shake(INVALID_SWAP.duration, 0.002);

    // Quick flash of red on both tiles
    this.flashRejection(targetA);
    this.flashRejection(targetB);

    this.host.tweens.add({ targets: a, x: homeA.x, y: homeA.y, duration: INVALID_SWAP.duration, ease: 'Quad.easeOut' });
    this.host.tweens.add({ targets: b, x: homeB.x, y: homeB.y, duration: INVALID_SWAP.duration, ease: 'Quad.easeOut' });

    this.host.tweens.add({
      targets: [a, b],
      scale: INVALID_SWAP.scale,
      duration: INVALID_SWAP.duration,
      yoyo: true,
      ease: 'Sine.easeOut',
      onComplete: () => {
        a.setScale(1).setPosition(homeA.x, homeA.y);
        b.setScale(1).setPosition(homeB.x, homeB.y);
        onComplete();
      },
    });
  }

  /**
   * Brief red flash on a tile to indicate rejection.
   */
  private flashRejection(target: EffectTarget): void {
    const container = target.container;
    const panel = container.list[0] as Phaser.GameObjects.Rectangle | undefined;
    if (!panel) return;

    const originalColor = panel.fillColor;
    const originalAlpha = panel.fillAlpha;

    this.host.tweens.add({
      targets: panel,
      fillColor: 0xff4444,
      duration: 60,
      yoyo: true,
      repeat: 1,
      ease: 'Quad.easeOut',
      onComplete: () => {
        panel.fillColor = originalColor;
        panel.fillAlpha = panel.fillAlpha; // Ensure alpha is restored
      },
    });
  }

  // ---------------------------------------------------------------- cascade

  /**
   * Announces a cascade, harder the deeper it goes.
   *
   * Depth 1 never reaches here: an ordinary match is not a cascade, and labelling
   * one would be noise.
   */
  playCascade(depth: number, label: string): void {
    const text = this.cascadeLabel;

    if (!text) return;

    const tier = cascadeTier(depth);
    const config = CASCADE_TIERS[tier];

    this.host.tweens.killTweensOf(text);
    text.setText(label);
    text.setColor(tier >= 3 ? '#ff8fab' : '#ffd166');
    text.setScale(config.scaleFrom);
    text.setAlpha(1);
    text.setVisible(true);

    // Add a subtle glow behind the label
    text.setStroke('#000000', 4);
    text.setShadow(2, 2, '#000000', 4, true, true);

    if (this.shouldReduceMotion()) {
      // Reduced motion: immediate show/hide
      text.setScale(config.scaleTo);
      text.setAlpha(1);
      this.host.tweens.add({
        targets: text,
        alpha: 0,
        duration: 100,
        onComplete: () => {
          text.setAlpha(1).setScale(1);
          text.setVisible(false);
          text.setStroke('#000000', 0);
          text.setShadow(0, 0, '#000000', 0, false, false);
        },
      });
    } else {
      this.host.tweens.add({
        targets: text,
        scale: config.scaleTo,
        duration: config.duration,
        ease: 'Back.easeOut',
        onComplete: () => {
          this.host.tweens.add({
            targets: text,
            alpha: 0,
            duration: 200,
            onComplete: () => {
              text.setAlpha(1).setScale(1);
              text.setVisible(false);
              text.setStroke('#000000', 0);
              text.setShadow(0, 0, '#000000', 0, false, false);
            },
          });
        },
      });
    }

    if (config.particles > 0 && text.visible) {
      this.burst(text.x, text.y, tier >= 3 ? 0xff8fab : 0xffd166, config.particles);
      // Additional white sparkle for higher tiers
      if (tier >= 3) {
        this.burst(text.x, text.y, WHITE, Math.floor(config.particles * 0.5));
      }
    }

    if (config.shake) {
      this.shake(100, 0.003);
    }
  }

  // ---------------------------------------------------------------- score popup

  /** A floating "+N" that rises, fades and destroys itself. */
  showScorePopup(x: number, y: number, points: number): void {
    const popup = this.host.add
      .text(x, y, `+${Math.max(0, Math.floor(points))}`, {
        fontSize: `${SCORE_POPUP.fontSize}px`,
        fontFamily: 'Arial',
        color: SCORE_POPUP.color,
        fontStyle: 'bold',
        stroke: '#23234a',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(POPUP_DEPTH)
      .setAlpha(0);

    this.popups.push(popup);

    // Fade in, rise and fade out. One tween chain, no timers.
    this.host.tweens.add({
      targets: popup,
      alpha: 1,
      duration: 90,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.host.tweens.add({
          targets: popup,
          y: y - SCORE_POPUP.rise,
          alpha: 0,
          duration: SCORE_POPUP.duration,
          ease: 'Quad.easeIn',
          onComplete: () => {
            const index = this.popups.indexOf(popup);

            if (index !== -1) this.popups.splice(index, 1);
            popup.destroy();
          },
        });
      },
    });
  }

  // ---------------------------------------------------------------- combo

  /** Pops the combo label. Only called when the value actually changes. */
  pulseCombo(text: Phaser.GameObjects.Text): void {
    this.host.tweens.killTweensOf(text);
    text.setScale(1);

    this.host.tweens.add({
      targets: text,
      scale: COMBO_PULSE.scale,
      duration: COMBO_PULSE.duration,
      yoyo: true,
      ease: 'Back.easeOut',
      onComplete: () => text.setScale(1),
    });
  }

  // ---------------------------------------------------------------- chord

  // ---------------------------------------------------------------- chord

  /** Throws a chord's colour out from where the announcement sits. */
  playChordBurst(x: number, y: number, style: ChordEffectStyle): void {
    if (this.shouldReduceMotion()) {
      // Reduced motion: simple single burst
      this.burst(x, y, style.color, style.particles);
      this.burst(x, y, WHITE, Math.floor(style.particles / 2));
      return;
    }

    // Multi-wave burst for richer feel
    this.burst(x, y, style.color, style.particles);
    this.burst(x, y, WHITE, Math.floor(style.particles / 2));

    // Add a glowing ring that expands and fades
    const ring = this.host.add.graphics();
    ring.lineStyle(4, style.color, 0.8);
    ring.strokeCircle(x, y, 8);
    ring.setDepth(FX_DEPTH + 5);

    this.host.tweens.add({
      targets: ring,
      scale: 3,
      alpha: 0,
      duration: 300,
      ease: 'Quad.easeOut',
      onComplete: () => ring.destroy(),
    });

    // Additional finer particles for sparkle
    this.burst(x, y, style.color, Math.floor(style.particles * 0.5));
    this.burst(x, y, WHITE, Math.floor(style.particles * 0.25));
  }

  /**
   * The look for a chord quality.
   *
   * Partial because the suspended qualities have no chord to announce, so they
   * have no style of their own and fall back to the default rather than needing an
   * entry kept up to date.
   */
  chordStyleFor(quality: ChordQuality | undefined): ChordEffectStyle {
    if (quality === undefined) return DEFAULT_CHORD_EFFECT;

    return CHORD_EFFECT_STYLES[quality] ?? DEFAULT_CHORD_EFFECT;
  }

  // ---------------------------------------------------------------- special tiles

/**
   * A line clear: a bright sweep along the cleared row or column.
   *
   * The endpoints come from the caller, which knows the board geometry. This draws
   * and fades, and drops particles along the path so the sweep reads as a streak
   * rather than a line appearing and vanishing.
   */
  playLineSweep(fromX: number, fromY: number, toX: number, toY: number): void {
    const graphics = this.host.add.graphics();

    graphics.lineStyle(SPECIAL_EFFECT.lineWidth, SPECIAL_EFFECT.lineColor, 0.9);
    graphics.lineBetween(fromX, fromY, toX, toY);
    graphics.setDepth(FX_DEPTH);

    this.host.tweens.add({
      targets: graphics,
      alpha: 0,
      duration: SPECIAL_EFFECT.lineDuration,
      ease: 'Quad.easeOut',
      onComplete: () => graphics.destroy(),
    });

    const steps = SPECIAL_EFFECT.lineParticleSteps;

    for (let step = 0; step <= steps; step++) {
      const t = steps === 0 ? 0 : step / steps;

      this.burst(
        fromX + (toX - fromX) * t,
        fromY + (toY - fromY) * t,
        0xffd166,
        SPECIAL_EFFECT.lineParticles
      );
    }

    // Add a perpendicular flash at the center for emphasis
    const midX = (fromX + toX) / 2;
    const midY = (fromY + toY) / 2;
    this.burst(midX, midY, 0xffd166, 12);
    this.burst(midX, midY, WHITE, 6);

    // Small screen shake
    this.shake(SPECIAL_EFFECT.lineDuration * 0.5, 0.002);
  }

  /** A color bomb: a radial burst with white sparks on top. */
  playRadialBurst(x: number, y: number): void {
    // Multi-ring burst for more impact
    this.burst(x, y, LEVEL_COMPLETE.particleColor, SPECIAL_EFFECT.radialParticles);
    this.burst(x, y, WHITE, SPECIAL_EFFECT.radialSparks);

    // Expanding ring
    const ring = this.host.add.graphics();
    ring.lineStyle(6, LEVEL_COMPLETE.particleColor, 0.9);
    ring.strokeCircle(x, y, 12);
    ring.setDepth(FX_DEPTH + 10);

    this.host.tweens.add({
      targets: ring,
      scale: 4,
      alpha: 0,
      duration: 400,
      ease: 'Quad.easeOut',
      onComplete: () => ring.destroy(),
    });

    // Second ring
    const ring2 = this.host.add.graphics();
    ring2.lineStyle(4, 0xffd166, 0.8);
    ring2.strokeCircle(x, y, 20);
    ring2.setDepth(FX_DEPTH + 10);

    this.host.tweens.add({
      targets: ring2,
      scale: 3,
      alpha: 0,
      duration: 500,
      ease: 'Quad.easeOut',
      onComplete: () => ring2.destroy(),
    });

    // Additional white sparks
    this.burst(x, y, WHITE, SPECIAL_EFFECT.radialSparks * 2);

    // Screen shake for impact
    this.shake(IMPACT.colorBomb.duration, IMPACT.colorBomb.intensity);
  }

  // ---------------------------------------------------------------- impact

  /** A very small camera shake. Reserved for events with real weight. */
  shake(duration: number, intensity: number): void {
    if (duration <= 0 || intensity <= 0) return;

    this.host.cameras.main.shake(duration, intensity);
  }

  /** Swells the whole board briefly. Visual only: no cell is touched. */
  pulseBoard(containers: Phaser.GameObjects.Container[]): void {
    for (const container of containers) {
      this.host.tweens.add({
        targets: container,
        scale: BOARD_PULSE.scale,
        duration: BOARD_PULSE.duration,
        yoyo: true,
        ease: 'Sine.easeInOut',
      });
    }
  }

  // ---------------------------------------------------------------- level end

  /**
   * The win moment: dim the board, swell it, throw a celebration, and pop the
   * overlay in.
   *
   * The overlay's content is already set by the caller; this only animates how it
   * arrives.
   */
  playLevelComplete(
    containers: Phaser.GameObjects.Container[],
    overlayRoot: Phaser.GameObjects.Container,
    center: Point
  ): void {
    this.dimBoard(containers, LEVEL_COMPLETE.dimAlpha, LEVEL_COMPLETE.dimDuration);
    this.entrance(overlayRoot, LEVEL_COMPLETE);

    // Reduced motion: the result still arrives and the board still settles, but
    // nothing swells, bursts or shakes on the way in.
    if (this.shouldReduceMotion()) return;

    this.pulseBoard(containers);
    this.burst(center.x, center.y, LEVEL_COMPLETE.particleColor, LEVEL_COMPLETE.particles);
    this.burst(center.x, center.y, WHITE, 12);
    this.shake(150, 0.005);
  }

  /** The loss moment: a gentler dim and a quieter entrance. */
  playLevelFailed(
    containers: Phaser.GameObjects.Container[],
    overlayRoot: Phaser.GameObjects.Container,
    center: Point
  ): void {
    this.dimBoard(containers, LEVEL_FAILED.dimAlpha, LEVEL_FAILED.dimDuration);
    this.entrance(overlayRoot, LEVEL_FAILED);
  }

  /** Fades every tile towards an alpha and leaves it there. */
  private dimBoard(containers: Phaser.GameObjects.Container[], alpha: number, duration: number): void {
    for (const container of containers) {
      this.host.tweens.add({
        targets: container,
        alpha,
        duration,
        ease: 'Quad.easeOut',
      });
    }
  }

  /** Scale in: from below, past 1, then settle back to exactly 1. */
  private entrance(
    overlayRoot: Phaser.GameObjects.Container,
    config: { overlayFrom: number; overlayMid: number; overlayIn: number; overlaySettle: number }
  ): void {
    this.host.tweens.killTweensOf(overlayRoot);

    // Reduced motion: the panel is simply there, at its final size and position,
    // and stays interactive throughout because nothing is animating it.
    if (this.shouldReduceMotion()) {
      overlayRoot.setScale(1);

      return;
    }

    overlayRoot.setScale(config.overlayFrom);

    this.host.tweens.add({
      targets: overlayRoot,
      scale: config.overlayMid,
      duration: config.overlayIn,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.host.tweens.add({
          targets: overlayRoot,
          scale: 1,
          duration: config.overlaySettle,
          ease: 'Back.easeIn',
          onComplete: () => overlayRoot.setScale(1),
        });
      },
    });
  }

  // ---------------------------------------------------------------- cleanup

  /**
   * Clears anything transient before a new level.
   *
   * Called when a level starts, so a popup or a sweep from the attempt before
   * cannot outlive the board it belonged to. The particle emitters are stopped
   * rather than destroyed: they are a fixed pool, and in-flight particles are
   * short-lived enough to fade on their own.
   */
  clearTransient(): void {
    for (const popup of this.popups) {
      this.host.tweens.killTweensOf(popup);
      popup.destroy();
    }

    this.popups = [];

    // forEach rather than for...of: the project targets es5, where iterating a Map's
    // values directly needs a compiler flag the rest of the codebase does not use.
    this.emitters.forEach((emitter) => emitter.stop(true));

    const label = this.cascadeLabel;

    if (label) {
      this.host.tweens.killTweensOf(label);
      label.setText('');
      label.setAlpha(1);
      label.setScale(1);
      label.setVisible(false);
    }
  }
}
