import Phaser from 'phaser';
import { Board } from '../board/Board';
import { NOTES, Tile } from '../board/Tile';
import type { NoteType } from '../board/Tile';
import { collectGroupTiles, findMatchGroups, findMatches } from '../mechanics/MatchEngine';
import { CascadePresenter, runCascade } from '../mechanics/CascadeEngine';
import { planMatchStage, planSpecialSwap, StagePlan } from '../mechanics/SpecialTileEngine';
import { TileFall } from '../mechanics/GravityEngine';
import { RefilledTile } from '../mechanics/RefillEngine';
import {
  calculateActivationBonus,
  calculateMatchScore,
  calculateSpecialCreationBonus,
} from '../mechanics/ScoreEngine';
import { chordLabel } from '../music/Chord';
import { ChordBuilder } from '../music/ChordEngine';
import { ChordComboEngine } from '../music/ChordComboEngine';
import type { ChordComboResult } from '../music/ChordComboEngine';
import { findValidMove, hasValidMove } from '../mechanics/MoveFinder';
import { createPlayableBoard } from '../mechanics/BoardGenerator';
import { shuffleBoard, ShuffleResult } from '../mechanics/BoardShuffleEngine';
import { LevelManager } from '../../levels/LevelManager';
import type { Level } from '../../levels/Level';
import { findObjective, formatNumber, levelOutcome, objectivesFor } from '../../levels/ObjectiveEngine';
import type { ObjectiveProgress } from '../../levels/ObjectiveEngine';
import { getProgressionManager } from '../../levels/ProgressionManager';
import { getGameBridge } from '../GameBridge';
import {
  MAX_RESULT_OBJECTIVE_ROWS,
  buildLevelResultView,
} from '../results/LevelResultView';
import type { LevelResultView, ResultMode } from '../results/LevelResultView';
import { computeResultPanelLayout } from '../results/resultPanelLayout';
import type { ResultButtonSlot, ResultPanelLayout, ResultPanelSlot } from '../results/resultPanelLayout';
import { getAudioManager } from '../../audio/AudioManager';
import { GameState } from '../state/GameState';
import { EffectsManager } from '../effects/EffectsManager';
import type { Point } from '../effects/EffectsManager';
import {
  CHORD_EFFECT_STYLES,
  DEFAULT_CHORD_EFFECT,
  IMPACT,
  MATCH_POP,
  cascadeLabel,
} from '../effects/effectConfig';

/**
 * The result panel's palette, read off the shell's design tokens (see app.css).
 *
 * Written as numbers because Phaser paints, not CSS: the values are the tokens,
 * so the canvas result and the DOM screens stay the same game.
 */
const RESULT_COLORS = {
  shade: 0x0b0b14,
  shadow: 0x0b0b14,
  panel: 0x23234a,
  accent: 0xffd166,
  accentBright: 0xffe09a,
  danger: 0xff8fab,
  focus: 0xffffff,
  primaryFill: 0xffd166,
  primaryFillHover: 0xffffff,
  secondaryFill: 0x2f2f55,
  secondaryFillHover: 0x3f3f6b,
};

/** The same palette as CSS colours, which is what Phaser's Text wants. */
const RESULT_TEXT = {
  heading: '#ffd166',
  headingFailed: '#ff8fab',
  muted: '#8a8aa8',
  text: '#ffffff',
  best: '#ffe09a',
  primaryLabel: '#23234a',
  secondaryLabel: '#ffd166',
  rowMet: '#ffffff',
  rowUnmet: '#8a8aa8',
};

/** Rounded corners, matching --radius in the design system. */
const RESULT_RADIUS = 10;
/** How far the focus ring sits outside its button. */
const RESULT_FOCUS_OFFSET = 5;
/**
 * Depth for the results panel.
 *
 * Above the board, the grid and the effects (FX_DEPTH 25, POPUP_DEPTH 30), because
 * the panel is built once in create() and the board is built later: without an
 * explicit depth the tiles would be drawn straight over the result.
 */
const RESULT_DEPTH = 100;
const RESULT_SHADE_DEPTH = 99;

// ------------------------------------------------------------ screen layout

/**
 * The gameplay screen is three stacked regions: header, board, dock.
 *
 * The shell owns a fixed bottom dock (see app.css) and the scene reserves the
 * same height so the board can never slide underneath it. The reserves are kept
 * deliberately generous: over-reserving costs a few pixels of background,
 * under-reserving hides tiles behind the dock.
 */
const DOCK_RESERVE = 112;
/** Below this height the shell compacts its dock, so the reserve shrinks with it. */
const SHORT_VIEWPORT = 560;
const DOCK_RESERVE_SHORT = 84;

/** Widest the header/dock "stage" column gets, so desktop reads as a column. */
const STAGE_MAX_WIDTH = 820;
/** Side margin for the header panel and the board's bounding region. */
const BOARD_MARGIN_X = 12;
/** Gap between the header panel and the top of the board region. */
const BOARD_GAP = 10;
const HEADER_TOP = 8;
const HEADER_INSET = 10;
const HEADER_ROW_GAP = 4;

/** Largest a tile may be, and smallest it may shrink to on a big board. */
const MAX_TILE_SIZE = 72;
const MIN_TILE_SIZE = 20;

/**
 * Header depth, above the tiles.
 *
 * Refill drops new tiles in from above the board, which is inside the header's
 * vertical band: with the header on top they fall behind it instead of crossing
 * the level name and the score.
 */
const HUD_PLATE_DEPTH = 40;
const HUD_TEXT_DEPTH = 41;

const SWAP_DURATION = 220;
const GRAVITY_DURATION = 220;
const REFILL_DURATION = 260;

const SHUFFLE_FADE_DURATION = 180;

/** A stage clearing at least this many tiles earns the removal chime. */
const LARGE_CLEAR_TILE_COUNT = 5;

/** Colour used by any notice that is not a chord announcement. */
const NOTICE_COLOR = '#ffd166';

/** Announcement look for a quality CHORD_EFFECT_STYLES does not cover. */
const DEFAULT_CHORD_STYLE = DEFAULT_CHORD_EFFECT;

/** How long a chord announcement stays fully visible before fading out. */
const CHORD_HOLD_DURATION = 900;

/** How long a chord announcement takes to fade back out. */
const CHORD_FADE_DURATION = 240;

const NOTE_COLORS: Record<Tile['noteType'], number> = {
  C: 0x4a9eff,
  D: 0x5ad19a,
  E: 0xffd166,
  F: 0xff8fab,
  G: 0xc792ea,
  A: 0x7be0d0,
  B: 0xffa45c,
};

/**
 * Drawn instead of a note letter for a color bomb, which has no note identity.
 */
const COLOR_BOMB_GLYPH = '*';

/**
 * Keys for the tile art, all of it generated into canvas textures at runtime.
 *
 * The project ships no image assets, so the rounded, bevelled faces and the
 * special-tile patterns are painted once in ensureTileTextures rather than
 * loaded. One face per note colour keeps the seven-note palette authoritative:
 * NOTE_COLORS feeds both the face gradient and the burst particles.
 */
const TILE_TEXTURE = {
  face: (note: NoteType): string => `note-face-${note}`,
  bomb: 'note-face-bomb',
  stripeH: 'note-stripe-h',
  stripeV: 'note-stripe-v',
} as const;

/**
 * Axis marker drawn under the note on a line-clear tile: '=' fires across the
 * row, '|' fires down the column.
 */
const LINE_CLEAR_GLYPHS: Record<'horizontal' | 'vertical', string> = {
  horizontal: '=',
  vertical: '|',
};

interface TileVisual {
  tile: Tile;
  container: Phaser.GameObjects.Container;
  text: Phaser.GameObjects.Text;
  /** Special tile marker, hidden for ordinary notes. */
  badge: Phaser.GameObjects.Text;
  /**
   * Soft elliptical drop shadow behind the tile.
   *
   * Stays the container's first child because EffectsManager flashes
   * container.list[0] on a match or a rejected swap, and only a Shape carries the
   * fill colour that flash tweens.
   */
  shadow: Phaser.GameObjects.Ellipse;
  /** Rounded, bevelled note face: a generated gradient texture, one per colour. */
  face: Phaser.GameObjects.Image;
  /** White pattern overlay for special tiles (stripes, ring). Hidden when ordinary. */
  overlay: Phaser.GameObjects.Image;
  /** Hover/selection halo; a Rectangle because effects stroke it on select. */
  innerGlow: Phaser.GameObjects.Rectangle;
}

/** Which end-of-level screen is up, if any. Drives the overlay's buttons. */
type OverlayMode = 'none' | ResultMode;

/**
 * The two actions the result panel offers, in the order the keyboard walks them.
 *
 * Named rather than inline strings because the focus ring, the hover state and the
 * click handlers all have to agree on which button is which.
 */
type ResultAction = 'primary' | 'secondary';

/**
 * The pause overlay, built once and re-labelled like the win/lose one.
 *
 * Separate from the end-of-level overlay because the two are never up at once: a
 * level cannot end while it is paused, and pausing is not an ending. The frame
 * draws the panel and all three buttons so hover and keyboard focus are one
 * redraw, exactly like the results panel; the zones are the hit areas.
 */
interface PauseOverlay {
  root: Phaser.GameObjects.Container;
  shade: Phaser.GameObjects.Rectangle;
  frame: Phaser.GameObjects.Graphics;
  heading: Phaser.GameObjects.Text;
  labels: Phaser.GameObjects.Text[];
  zones: Phaser.GameObjects.Rectangle[];
}

/** The three destinations the pause overlay offers, in keyboard order. */
type PauseAction = 'resume' | 'map' | 'menu';
const PAUSE_ACTIONS: readonly PauseAction[] = ['resume', 'map', 'menu'];
const PAUSE_LABELS: Record<PauseAction, string> = {
  resume: 'RESUME',
  map: 'LEVEL MAP',
  menu: 'MAIN MENU',
};

/** Where the pause overlay's panel and buttons sit on the current canvas. */
interface PauseLayout {
  panelX: number;
  panelY: number;
  panelW: number;
  panelH: number;
  buttons: Array<{ x: number; y: number; width: number; height: number }>
}

/**
 * The win/lose results panel, built once and re-labelled.
 *
 * Kept as one object graph so switching screens costs a few setText calls instead
 * of tearing down and rebuilding Phaser objects every time a level ends. Two
 * buttons rather than one: the primary continues play (next level, another run or
 * retry) and the secondary always offers the way back to the level map.
 *
 * The shade is deliberately *not* inside root. Root is scaled by the entrance
 * tween, and a shade that shrank with it would leave the board's edges uncovered
 * for the length of the animation.
 */
interface LevelOverlay {
  root: Phaser.GameObjects.Container;
  shade: Phaser.GameObjects.Rectangle;
  /** Draws the panel and both buttons: see drawResultFrame. */
  frame: Phaser.GameObjects.Graphics;
  heading: Phaser.GameObjects.Text;
  levelLine: Phaser.GameObjects.Text;
  scoreLabel: Phaser.GameObjects.Text;
  scoreValue: Phaser.GameObjects.Text;
  bestLine: Phaser.GameObjects.Text;
  objectivesLabel: Phaser.GameObjects.Text;
  /** One per objective kind the engine can produce, hidden when a level asks for less. */
  objectiveRows: Phaser.GameObjects.Text[];
  primaryLabel: Phaser.GameObjects.Text;
  secondaryLabel: Phaser.GameObjects.Text;
  /** Invisible, owned purely so the buttons have hit areas a resize can re-size. */
  primaryZone: Phaser.GameObjects.Rectangle;
  secondaryZone: Phaser.GameObjects.Rectangle;
}

export class GameScene extends Phaser.Scene {
  private board!: Board;
  private readonly gameState = new GameState();
  /**
   * Level definitions and the current position in them. Pure data with no
   * rendering, so level flow can be reasoned about without the scene.
   */
  private readonly levels = new LevelManager();
  /**
   * Audio is driven from here rather than from the engines, so the pure game
   * logic stays silent and testable. The manager is shared with the React shell
   * through getAudioManager, which keeps one mute state for the whole game.
   */
  private readonly audio = getAudioManager();
  /**
   * Counts the chords found in the move in progress. Reset when a new move
   * starts, grown by the cascade, and reset again by the next move.
   */
  private readonly chordCombo = new ChordComboEngine();
  private readonly chordBuilder = new ChordBuilder();
  private tileVisuals = new Map<number, TileVisual>();
  private selectionOutline!: Phaser.GameObjects.Graphics;
  /** Board frame, redrawn per level rather than recreated. */
  private boardFrame!: Phaser.GameObjects.Graphics;
  private selectedTile: Tile | null = null;
  /** Tracks a pointer/touch drag from a starting tile for swipe-to-swap. */
  private dragStartTile: Tile | null = null;
  private dragStartPoint: { x: number; y: number } | null = null;
  private dragSwapped = false;

  /**
   * Board geometry, recomputed for each level from its own dimensions.
   *
   * Nothing downstream asks "how big is the board": tiles, grid and hit boxes all
   * read these, so a 7x7 or 9x9 level needs no change outside Level.ts.
   */
  private boardRows = 8;
  private boardColumns = 8;
  private tileSize = MAX_TILE_SIZE;
  private boardOriginX = BOARD_MARGIN_X;
  // Both are derived by layoutBoard before anything reads them in earnest.
  private boardOriginY = 0;
  private boardCenterY = 0;

  private overlay!: LevelOverlay;
  private overlayMode: OverlayMode = 'none';
  /**
   * The content the panel is currently showing.
   *
   * Held rather than passed around because a resize has to re-run the layout, and
   * re-running it must not change what the panel says. Null whenever no result is up.
   */
  private overlayView: LevelResultView | null = null;
  /** The geometry last computed, so hover and focus can redraw without recomputing it. */
  private overlayLayout: ResultPanelLayout | null = null;
  /**
   * Where the keyboard would act.
   *
   * The canvas has no DOM focus to move, so the panel keeps its own and shows it
   * with a ring. It starts on the primary action, which is the one the result is
   * asking the player to take.
   */
  private overlayFocus: ResultAction = 'primary';
  /** Which button the pointer is over, so a redraw can lighten it. */
  private overlayHover: ResultAction | null = null;
  /**
   * Guards the overlay buttons so one click cannot start two level loads. The
   * overlay is also hidden immediately, so this is the second of two defences
   * rather than the only one.
   */
  private transitioning = false;

  private pauseOverlay!: PauseOverlay;
  /** Which pause button the keyboard is on; mirrors the results panel's focus. */
  private pauseFocus: PauseAction = 'resume';
  /** Which pause button the pointer is over, so a redraw can lighten it. */
  private pauseHover: PauseAction | null = null;
  /** The geometry drawPauseFrame paints, recomputed by layoutPauseOverlay. */
  private pauseLayout: PauseLayout | null = null;
  /**
   * True while the pause overlay is up.
   *
   * Separate from GameState's processing lock because pausing is a presentation
   * state, not a gameplay one: the attempt is still live underneath, and resuming
   * continues it rather than restarting it.
   */
  private paused = false;

  /**
   * Campaign progress and the React bridge, both singletons.
   *
   * The scene never touches React or the DOM: it asks the bridge to change screen,
   * and the bridge tells React. Progress is the same object the level map reads,
   * which is why a win unlocks the next level without either side reloading.
   */
  private readonly progression = getProgressionManager();
  private readonly bridge = getGameBridge();

  /**
   * Every visual effect: particles, popups, cascade labels, shake, board pulses.
   *
   * Created in create() because it needs the scene to exist. It is handed nothing but
   * the scene's factories and managers, so it has no way to reach the board, the
   * score or the move count: the juice cannot change the game.
   */
  private effects!: EffectsManager;

  /** The combo value last time the HUD updated, so the pulse fires on change only. */
  private lastCombo = 0;

  /** Unsubscribes the play request listener when the scene shuts down. */
  private stopListeningForLevels: (() => void) | null = null;
  /** Unsubscribes the pause request listener when the scene shuts down. */
  private stopListeningForPause: (() => void) | null = null;
  /** Unsubscribes the hint request listener when the scene shuts down. */
  private stopListeningForHint: (() => void) | null = null;
  /** Unsubscribes the results panel's resize handler when the scene shuts down. */
  private stopListeningForResize: (() => void) | null = null;
  /** Unsubscribes the results panel's keyboard handlers when the scene shuts down. */
  private stopListeningForKeys: (() => void) | null = null;

  // ------------------------------------------------------------ gameplay screen

  /** Atmospheric backdrop, drawn once into a canvas texture and rebuilt on resize. */
  private background!: Phaser.GameObjects.Image;

  /**
   * The header plate and the cards, chips and pills drawn on it.
   *
   * One graphics object holds all of it, redrawn by layoutHud, because every
   * position and width in the header is derived from measured text and a resize
   * or a new score changes those measurements.
   */
  private hudPlate!: Phaser.GameObjects.Graphics;
  /**
   * Header text, one object per visual group. Never recreated, only moved and
   * re-labelled, so the HUD cannot allocate mid-play.
   */
  private hudLevelTag!: Phaser.GameObjects.Text;
  private hudLevelName!: Phaser.GameObjects.Text;
  private hudScoreLabel!: Phaser.GameObjects.Text;
  private hudScoreValue!: Phaser.GameObjects.Text;
  private hudMovesLabel!: Phaser.GameObjects.Text;
  private hudMovesValue!: Phaser.GameObjects.Text;
  /** Objective chips, visible only for objectives the level actually declares. */
  private hudChipChords!: Phaser.GameObjects.Text;
  private hudChipSpecials!: Phaser.GameObjects.Text;
  /** Live Chord Builder indicator showing collected notes and completing triad notes. */
  private hudChipVoices!: Phaser.GameObjects.Text;
  private hudCombo!: Phaser.GameObjects.Text;
  private hudNotice!: Phaser.GameObjects.Text;
  /** Bottom edge of the header panel; the board region starts below it. */
  private headerBottom = 0;

  /**
   * Set when a resize happened mid-cascade and the tile snap had to wait.
   *
   * Movement tweens carry coordinates captured before the resize, so snapping
   * their targets would end them in the wrong cells. The snap runs again when the
   * cascade finishes instead.
   */
  private pendingTileSnap = false;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    // Deep blue plate under everything, so the painted backdrop always has a
    // matching colour behind its edges.
    this.cameras.main.setBackgroundColor('#071a2c');

    this.createBackdrop();

    this.hudPlate = this.add.graphics();
    this.createHud();
    this.createLevelOverlay();
    this.createPauseOverlay();

    // The anchor is where the cascade label sits: near the top of the board, clear of
    // the chord announcement in the middle. layoutGameplay re-aims it for the real
    // board region once the header height is known.
    this.effects = new EffectsManager(this);
    this.effects.initialize({ x: this.scale.width / 2, y: this.scale.height / 2 });

    this.boardFrame = this.add.graphics();
    this.selectionOutline = this.add.graphics();

    // One pass places the whole composition: backdrop, header, board region and
    // every object that has a place in it, before any level exists.
    this.layoutGameplay();

    // No level is started here. The campaign screen decides which one to play and
    // asks for it over the bridge, so the game never drops the player straight
    // into level 1 with no way to see the rest of the progression.
    this.stopListeningForLevels = this.bridge.onPlayLevelRequest((levelId) =>
      this.requestLevel(levelId)
    );

    this.stopListeningForPause = this.bridge.onPauseRequest(() => this.pauseGame());
    this.stopListeningForHint = this.bridge.onHintRequest(() => this.showHint());

    // Scene-wide drag/swipe-to-swap support for mouse and touch
    const onPointerMove = (pointer: Phaser.Input.Pointer): void => {
      if (!this.dragStartTile || !this.dragStartPoint) return;
      if (this.paused || !this.gameState.canAcceptInput) {
        this.dragStartTile = null;
        this.dragStartPoint = null;
        return;
      }

      const dx = pointer.x - this.dragStartPoint.x;
      const dy = pointer.y - this.dragStartPoint.y;
      const threshold = Math.max(16, this.tileSize * 0.34);

      if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;

      const startTile = this.dragStartTile;
      let targetRow = startTile.row;
      let targetCol = startTile.column;

      if (Math.abs(dx) > Math.abs(dy)) {
        targetCol += dx > 0 ? 1 : -1;
      } else {
        targetRow += dy > 0 ? 1 : -1;
      }

      this.dragStartTile = null;
      this.dragStartPoint = null;
      this.dragSwapped = true;

      const neighbor = this.board ? this.board.getTileAt(targetRow, targetCol) : null;
      if (neighbor) {
        this.audio.initialize();
        this.selectedTile = startTile;
        this.board.selectTile(startTile.row, startTile.column);
        this.performSwap(startTile, neighbor);
      }
    };

    const onPointerUp = (): void => {
      this.dragStartTile = null;
      this.dragStartPoint = null;
    };

    this.input.on(Phaser.Input.Events.POINTER_MOVE, onPointerMove);
    this.input.on(Phaser.Input.Events.POINTER_UP, onPointerUp);

    // The panel is placed for the canvas it is on, not the one the game booted
    // with: a phone rotating mid-result would otherwise keep a panel sized for the
    // old screen. Both subscriptions are handed back so shutdown can drop them.
    this.stopListeningForResize = this.attachResultResize();
    this.stopListeningForKeys = this.attachResultKeys();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off(Phaser.Input.Events.POINTER_MOVE, onPointerMove);
      this.input.off(Phaser.Input.Events.POINTER_UP, onPointerUp);
      if (this.stopListeningForLevels) this.stopListeningForLevels();
      if (this.stopListeningForPause) this.stopListeningForPause();
      if (this.stopListeningForHint) this.stopListeningForHint();
      if (this.stopListeningForResize) this.stopListeningForResize();
      if (this.stopListeningForKeys) this.stopListeningForKeys();
      this.stopListeningForLevels = null;
      this.stopListeningForPause = null;
      this.stopListeningForHint = null;
      this.stopListeningForResize = null;
      this.stopListeningForKeys = null;
    });
  }

  /**
   * Loads a level the level map asked for.
   *
   * The single entry point for starting play, shared by the map, retry and
   * next-level. Two gates run before anything is generated: the id has to name a
   * real level, and the player has to have earned it. Refusing here rather than in
   * the UI means a locked level cannot be launched by any route, including a stale
   * request that arrived while the screen was changing.
   */
  private requestLevel(levelId: number): boolean {
    if (!this.progression.isUnlocked(levelId)) {
      console.log(`LEVEL ${levelId} REFUSED - still locked`);

      return false;
    }

    // loadLevel returns false for an id the level list does not contain, so a
    // progress file naming a level that no longer exists cannot start one.
    if (!this.levels.loadLevel(levelId)) {
      console.log(`LEVEL ${levelId} REFUSED - not in the level list`);

      return false;
    }

    this.startLevel(this.levels.getCurrentLevel());

    return true;
  }

  /**
   * Paints the atmospheric backdrop into a canvas texture sized to the screen.
   *
   * The game loads no image assets (PreloadScene loads nothing), so the teal
   * world is drawn procedurally: a deep vertical gradient, a soft glow under the
   * header where the board sits, light rays, bokeh, a faint staff and a few quiet
   * note glyphs, finished with a vignette. Repainted on resize so it always
   * covers the canvas exactly, and seeded so the same screen always looks the
   * same. No animation: it costs one draw per repaint, not a frame.
   */
  private createBackdrop(): void {
    const width = Math.max(2, Math.round(this.scale.width));
    const height = Math.max(2, Math.round(this.scale.height));
    const key = 'stage-backdrop';
    let texture: Phaser.Textures.CanvasTexture;

    if (this.textures.exists(key)) {
      texture = this.textures.get(key) as Phaser.Textures.CanvasTexture;
      if (texture.width !== width || texture.height !== height) texture.setSize(width, height);
    } else {
      const created = this.textures.createCanvas(key, width, height);
      if (!created) return;
      texture = created;
    }

    const ctx = texture.context;

    // Deterministic "random", so resizing back and forth never reshuffles the
    // bokeh and motifs into a different sky.
    let seed = 1337;
    const rand = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    ctx.clearRect(0, 0, width, height);

    // Deep blue to teal vertical gradient.
    const base = ctx.createLinearGradient(0, 0, 0, height);
    base.addColorStop(0, '#0a1e3a');
    base.addColorStop(0.45, '#0c3346');
    base.addColorStop(0.78, '#0a2438');
    base.addColorStop(1, '#061524');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, width, height);

    // Soft glow behind the board region.
    const glowY = this.headerBottom + Math.max(0, (height - this.headerBottom) / 2);
    const glow = ctx.createRadialGradient(
      width / 2,
      glowY,
      10,
      width / 2,
      glowY,
      Math.max(width, height) * 0.6
    );
    glow.addColorStop(0, 'rgba(94, 214, 224, 0.15)');
    glow.addColorStop(0.5, 'rgba(70, 160, 190, 0.06)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    // Light rays falling from the top edge.
    for (let i = 0; i < 5; i++) {
      const cx = width * (0.1 + 0.2 * i);
      const spread = width * 0.03;
      const ray = ctx.createLinearGradient(0, 0, 0, height * 0.92);
      ray.addColorStop(0, 'rgba(180, 240, 255, 0.07)');
      ray.addColorStop(1, 'rgba(180, 240, 255, 0)');
      ctx.fillStyle = ray;
      ctx.beginPath();
      ctx.moveTo(cx - spread * 0.5, -12);
      ctx.lineTo(cx + spread * 0.5, -12);
      ctx.lineTo(cx + spread * 3 + Math.sin(i * 2.1) * 40, height * 0.92);
      ctx.lineTo(cx - spread * 3 + Math.cos(i * 1.7) * 40, height * 0.92);
      ctx.closePath();
      ctx.fill();
    }

    // Bokeh: quiet circles of light in the note palette.
    for (let i = 0; i < 22; i++) {
      const x = rand() * width;
      const y = rand() * height;
      const radius = 14 + rand() * 56;
      const color =
        i % 3 === 0 ? '123, 224, 208' : i % 3 === 1 ? '74, 158, 255' : '255, 209, 102';
      const blob = ctx.createRadialGradient(x, y, 0, x, y, radius);
      blob.addColorStop(0, `rgba(${color}, ${0.05 + rand() * 0.04})`);
      blob.addColorStop(1, `rgba(${color}, 0)`);
      ctx.fillStyle = blob;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // A faint staff drifting behind the board.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    const staffY = Math.min(height - 70, glowY + 40);
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(0, staffY + i * 11);
      ctx.lineTo(width, staffY + i * 11);
      ctx.stroke();
    }

    // A handful of quiet note glyphs, the only literal music in the frame.
    const glyphs = ['♪', '♫', '♩', '♬'];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 9; i++) {
      const x = rand() * width;
      const y = rand() * height;
      const size = Math.round(16 + rand() * 26);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((rand() - 0.5) * 0.7);
      ctx.font = `bold ${size}px Arial`;
      ctx.fillStyle = `rgba(123, 224, 208, ${0.04 + rand() * 0.05})`;
      ctx.fillText(glyphs[i % glyphs.length], 0, 0);
      ctx.restore();
    }

    // Vignette: pull the edges down so the header, board and dock read clearly.
    const vignette = ctx.createRadialGradient(
      width / 2,
      height / 2,
      Math.min(width, height) * 0.35,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.75
    );
    vignette.addColorStop(0, 'rgba(4, 10, 20, 0)');
    vignette.addColorStop(1, 'rgba(3, 8, 16, 0.55)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    texture.refresh();

    if (this.background) {
      this.background
        .setTexture(key)
        .setPosition(width / 2, height / 2)
        .setDisplaySize(width, height);
    } else {
      this.background = this.add
        .image(width / 2, height / 2, key)
        .setDepth(-10);
    }
  }

  /**
   * Creates the header's text objects once, hidden and empty until a level fills
   * them. Every object is mutated afterwards, never recreated, so the HUD cannot
   * allocate a text object mid-play. layoutHud gives each of them a place.
   */
  private createHud(): void {
    const labelStyle: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {
      fontFamily: 'Arial',
      fontStyle: 'bold',
      fontSize: '10px',
      color: '#8fb7cf',
    };

    this.hudLevelTag = this.add
      .text(0, 0, 'LEVEL 1', { ...labelStyle, fontSize: '11px', color: '#ffd166' })
      .setOrigin(0, 0.5)
      .setDepth(HUD_TEXT_DEPTH);

    this.hudLevelName = this.add
      .text(0, 0, '', {
        fontFamily: 'Arial',
        fontStyle: 'bold',
        fontSize: '19px',
        color: '#ffffff',
      })
      .setOrigin(0, 0.5)
      .setDepth(HUD_TEXT_DEPTH);

    this.hudScoreLabel = this.add
      .text(0, 0, 'SCORE', labelStyle)
      .setOrigin(0, 0.5)
      .setDepth(HUD_TEXT_DEPTH);
    this.hudScoreValue = this.add
      .text(0, 0, '0 / 0', {
        fontFamily: 'Arial',
        fontStyle: 'bold',
        fontSize: '17px',
        color: '#ffe09a',
      })
      .setOrigin(0, 0.5)
      .setDepth(HUD_TEXT_DEPTH);

    this.hudMovesLabel = this.add
      .text(0, 0, 'MOVES', labelStyle)
      .setOrigin(0.5, 0.5)
      .setDepth(HUD_TEXT_DEPTH);
    this.hudMovesValue = this.add
      .text(0, 0, '0', {
        fontFamily: 'Arial',
        fontStyle: 'bold',
        fontSize: '28px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(HUD_TEXT_DEPTH);

    this.hudChipChords = this.add
      .text(0, 0, '', { ...labelStyle, fontSize: '13px', color: '#7be0d0' })
      .setOrigin(0, 0.5)
      .setDepth(HUD_TEXT_DEPTH)
      .setVisible(false);
    this.hudChipSpecials = this.add
      .text(0, 0, '', { ...labelStyle, fontSize: '13px', color: '#ff8fab' })
      .setOrigin(0, 0.5)
      .setDepth(HUD_TEXT_DEPTH)
      .setVisible(false);

    this.hudChipVoices = this.add
      .text(0, 0, '', { ...labelStyle, fontSize: '12px', color: '#ffe09a' })
      .setOrigin(0, 0.5)
      .setDepth(HUD_TEXT_DEPTH)
      .setVisible(false);

    this.hudCombo = this.add
      .text(0, 0, '', { ...labelStyle, fontSize: '12px', color: '#ffd166' })
      .setOrigin(0.5, 0.5)
      .setDepth(HUD_TEXT_DEPTH)
      .setVisible(false);

    // Transient centre-screen message, reused for shuffle notices and chord
    // announcements. Kept hidden and mutated rather than recreated. Its vertical
    // position follows the board, which layoutBoard sets per level.
    const canvasWidth = this.scale.width;
    this.hudNotice = this.add
      .text(canvasWidth / 2, this.boardCenterY, '', {
        fontSize: Math.min(28, canvasWidth / 22),
        fontFamily: 'Arial',
        color: '#ffd166',
        fontStyle: 'bold',
        stroke: '#23234a',
        strokeThickness: 6,
        align: 'center',
      })
      .setOrigin(0.5)
      .setVisible(false)
      .setDepth(HUD_TEXT_DEPTH + 1);

    this.hudPlate.setDepth(HUD_PLATE_DEPTH);
  }

  /**
   * Pushes the current game state into the header. Called after every change.
   *
   * Only objectives the current level declares are shown, so a level without a
   * special tile target never displays a SPECIALS chip. Every value comes from
   * real state: the level from LevelManager, the score, moves, chords and
   * specials from GameState through the same objective engine the win check uses.
   */
  private updateHud(): void {
    const level = this.levels.getCurrentLevel();
    const objectives = objectivesFor(level, this.progressSnapshot());

    this.hudLevelTag.setText(`LEVEL ${level.id}`);
    this.hudLevelName.setText(level.name.toUpperCase());

    const score = findObjective(objectives, 'score');
    if (score !== null) {
      this.hudScoreValue.setText(
        `${formatNumber(score.current)} / ${formatNumber(score.target)}`
      );
    }

    this.hudMovesValue.setText(`${this.gameState.movesRemaining}`);

    // Low-moves warning: when moves are low, tint the counter red. Phaser Text has
    // no CSS class list, so the warning is a direct color set (and a reset).
    if (this.gameState.movesRemaining <= 3) {
      this.hudMovesValue.setColor('#ff8fab');
    } else {
      this.hudMovesValue.setColor('#ffffff');
    }

    const chords = findObjective(objectives, 'chords');
    this.hudChipChords.setVisible(chords !== null);
    if (chords !== null) {
      this.hudChipChords.setText(`♪ CHORDS ${chords.current} / ${chords.target}`);
    }

    const specials = findObjective(objectives, 'specialTiles');
    this.hudChipSpecials.setVisible(specials !== null);
    if (specials !== null) {
      this.hudChipSpecials.setText(`★ SPECIALS ${specials.current} / ${specials.target}`);
    }

    const voices = this.chordBuilder.getNotes();
    const needed = this.chordBuilder.getNeededNotes();
    if (chords !== null) {
      this.hudChipVoices.setVisible(true);
      if (voices.length === 0) {
        this.hudChipVoices.setText('♩ VOICES: —');
      } else if (needed.length > 0) {
        this.hudChipVoices.setText(`♩ ${voices.join('·')} → ${needed.join('/')}`);
      } else {
        this.hudChipVoices.setText(`♩ ${voices.join('·')}`);
      }
    } else {
      this.hudChipVoices.setVisible(false);
    }

    const combo = this.gameState.comboLevel;
    this.hudCombo.setText(combo > 0 ? `COMBO x${combo}` : '');

    // The pulse fires only when the value changes, so a steady combo does not keep
    // re-animating itself.
    if (combo !== this.lastCombo) {
      this.lastCombo = combo;

      if (combo > 0) this.effects.pulseCombo(this.hudCombo);
    }

    // Score, chips and moves all change width, so the plate is re-measured around
    // them. Deriving positions from text widths is what stops a five-digit score
    // from reaching into the moves card.
    const previousBottom = this.headerBottom;
    this.layoutHud();

    // The header decides where the board region starts, so when its row count
    // changes - a level with different objectives, or a resize - the board has to
    // move with it rather than being re-laid out only on the next level start.
    if (this.headerBottom !== previousBottom) this.relayoutBoardRegion();
  }

  /** Re-derives the board region after the header changed height. */
  private relayoutBoardRegion(): void {
    if (!this.board) return;

    this.layoutBoard();
    this.drawGrid(this.boardFrame);

    if (this.gameState.processing) this.pendingTileSnap = true;
    else this.snapTilesToCells();

    this.drawSelection();
    this.effects.setAnchor({ x: this.scale.width / 2, y: this.headerBottom + BOARD_GAP + 16 });
  }

  /**
   * Places every header group for the canvas size right now.
   *
   * Two arrangements, chosen by width: wide canvases run level, score and moves
   * side by side over a chip row; narrow canvases give the level and the moves
   * their own row, then score, then chips. Each group is first given an allotted
   * width and only then a font size that fits inside it, so the bounds are
   * computed before the type is chosen and two groups can never claim the same
   * pixels. Called from layoutGameplay on every resize and from updateHud
   * whenever a value changes width.
   */
  private layoutHud(): void {
    const canvasWidth = this.scale.width;
    const canvasHeight = this.scale.height;
    const compact = canvasHeight < 680;
    const wide = canvasWidth >= 700;
    const level = this.levels.getCurrentLevel();
    const hasChips = level.chordTarget !== undefined || level.specialTileTarget !== undefined;
    const rows = wide || !hasChips ? 2 : 3;

    const rowH = compact ? 34 : 44;
    const scoreRowH = compact ? 30 : 36;
    const chipRowH = compact ? 22 : 26;
    const row2H = wide ? chipRowH : scoreRowH;
    const panelW = Math.min(canvasWidth - 20, STAGE_MAX_WIDTH);
    const panelX = Math.round((canvasWidth - panelW) / 2);
    const innerX = panelX + HEADER_INSET;
    const innerW = panelW - HEADER_INSET * 2;
    const panelY = HEADER_TOP;
    const row1Top = panelY + HEADER_TOP;
    const row2Top = row1Top + rowH + HEADER_ROW_GAP;
    const row3Top = row2Top + row2H + HEADER_ROW_GAP;
    const panelH =
      HEADER_TOP +
      rowH +
      HEADER_ROW_GAP +
      row2H +
      (rows === 3 ? HEADER_ROW_GAP + chipRowH : 0) +
      HEADER_TOP;
    this.headerBottom = panelY + panelH;

    // Shrinks a line until it fits its allotted width. Returns the size used.
    const fit = (
      text: Phaser.GameObjects.Text,
      maxWidth: number,
      base: number,
      floor: number
    ): number => {
      let size = base;

      text.setFontSize(size);

      while (size > floor && text.width > maxWidth) {
        size -= 1;
        text.setFontSize(size);
      }

      return size;
    };

    // Shrinks a line that is already at its floor by shortening it, so a very
    // long level name on a very small screen ends in an ellipsis rather than
    // running into its neighbour.
    const ellipsize = (text: Phaser.GameObjects.Text, maxWidth: number): void => {
      let value = text.text;

      while (value.length > 1 && text.width > maxWidth) {
        value = `${value.slice(0, -2).trim()}…`;
        text.setText(value);
      }
    };

    const plate = this.hudPlate;
    plate.clear();

    // Layered depth: a dark drop plate, the glass panel, then a hairline top edge.
    plate.fillStyle(0x000000, 0.35);
    plate.fillRoundedRect(panelX + 2, panelY + 4, panelW, panelH, 16);
    plate.fillStyle(0x08182a, 0.84);
    plate.fillRoundedRect(panelX, panelY, panelW, panelH, 16);
    plate.lineStyle(1.5, 0x7be0d0, 0.3);
    plate.strokeRoundedRect(panelX, panelY, panelW, panelH, 16);
    plate.lineStyle(1, 0xffffff, 0.12);
    plate.lineBetween(panelX + 18, panelY + 1.5, panelX + panelW - 18, panelY + 1.5);

    const card = (x: number, y: number, w: number, h: number, stroke: number, strokeAlpha: number): void => {
      plate.fillStyle(0xffffff, 0.06);
      plate.fillRoundedRect(x, y, w, h, 10);
      plate.lineStyle(1, stroke, strokeAlpha);
      plate.strokeRoundedRect(x, y, w, h, 10);
    };

    const pill = (x: number, y: number, w: number, h: number, fill: number, fillAlpha: number, stroke: number): void => {
      plate.fillStyle(fill, fillAlpha);
      plate.fillRoundedRect(x, y, w, h, h / 2);
      plate.lineStyle(1, stroke, 0.55);
      plate.strokeRoundedRect(x, y, w, h, h / 2);
    };

    const gap = 8;
    const cardPad = 9;

    // ---------------------------------------------------------- row 1: moves
    // Right-anchored and measured first: it is the number the player checks most,
    // so it takes its width before anything else is allotted.
    const movesFont = compact ? 24 : 28;
    this.hudMovesValue.setFontSize(movesFont);
    const movesW = Math.min(
      Math.round(innerW * 0.32),
      Math.max(70, Math.ceil(Math.max(this.hudMovesValue.width, this.hudMovesLabel.width)) + cardPad * 2)
    );
    const movesX = innerX + innerW - movesW;
    const movesCardH = rowH - 4;
    card(movesX, row1Top + 2, movesW, movesCardH, 0xffd166, 0.3);
    this.hudMovesLabel.setPosition(movesX + movesW / 2, row1Top + 2 + (compact ? 9 : 11));
    this.hudMovesValue.setPosition(movesX + movesW / 2, row1Top + 2 + (compact ? 24 : 29));

    // ------------------------------------------------- row 1: level identity
    const levelMaxW =
      (wide ? (innerW - movesW - gap * 2) * 0.55 : innerW - movesW - gap * 2) - cardPad;
    fit(this.hudLevelName, levelMaxW, compact ? 16 : 19, 12);
    ellipsize(this.hudLevelName, levelMaxW);
    fit(this.hudLevelTag, levelMaxW, compact ? 10 : 11, 9);
    const levelW = Math.max(this.hudLevelTag.width, this.hudLevelName.width) + cardPad * 2;
    card(innerX, row1Top + 2, levelW, movesCardH, 0xffffff, 0.1);
    this.hudLevelTag.setPosition(innerX + cardPad, row1Top + 2 + (compact ? 10 : 12));
    this.hudLevelName.setPosition(innerX + cardPad, row1Top + 2 + (compact ? 22 : 27));

    // ------------------------------------------------------ score and combo
    if (wide) {
      const scoreStart = innerX + levelW + gap;
      const scoreAvail = movesX - gap - scoreStart;
      fit(this.hudScoreValue, Math.max(40, scoreAvail - cardPad * 2), compact ? 15 : 17, 12);
      fit(this.hudScoreLabel, Math.max(40, scoreAvail - cardPad * 2), 10, 9);
      const scoreW = Math.min(
        Math.max(60, scoreAvail),
        Math.max(this.hudScoreLabel.width, this.hudScoreValue.width) + cardPad * 2
      );
      card(scoreStart, row1Top + 2, scoreW, movesCardH, 0xffffff, 0.1);
      this.hudScoreLabel.setPosition(scoreStart + cardPad, row1Top + 2 + (compact ? 9 : 11));
      this.hudScoreValue.setPosition(scoreStart + cardPad, row1Top + 2 + (compact ? 23 : 28));
    } else {
      const scoreY = row2Top + scoreRowH / 2;
      const scoreMaxW = innerW - 76 - gap;
      fit(this.hudScoreValue, scoreMaxW, compact ? 15 : 17, 12);
      fit(this.hudScoreLabel, scoreMaxW, 10, 9);
      const scoreW = Math.max(this.hudScoreLabel.width, this.hudScoreValue.width) + cardPad * 2;
      card(innerX, row2Top + 2, scoreW, scoreRowH - 4, 0xffffff, 0.1);
      this.hudScoreLabel.setPosition(innerX + cardPad, scoreY - (compact ? 6 : 7));
      this.hudScoreValue.setPosition(innerX + cardPad, scoreY + (compact ? 7 : 8));
    }

    // ------------------------------------------------------------ chips
    // Wide canvases carry the chips on row 2; narrow ones get their own third row
    // so a level asking for both objectives still fits a 320px screen without
    // touching the score.
    const chipsTop = wide ? row2Top : rows === 3 ? row3Top : row2Top;
    const chipsH = wide ? chipRowH : rows === 3 ? chipRowH : scoreRowH;
    let chipX = innerX;
    const chipBase = compact ? 11 : 13;
    let chipsTotal = 0;

    for (const chip of [this.hudChipChords, this.hudChipSpecials, this.hudChipVoices]) {
      if (!chip.visible) continue;

      fit(chip, innerW * 0.46 - 10, chipBase, 10);
      const w = chip.width + 18;
      if (chipX + w > innerX + innerW) break;
      const isVoices = chip === this.hudChipVoices;
      pill(
        chipX,
        chipsTop + 2,
        w,
        chipsH - 4,
        isVoices ? 0x1b2347 : 0x0d3246,
        0.95,
        isVoices ? 0xffd166 : 0x7be0d0
      );
      chip.setPosition(chipX + 9, chipsTop + chipsH / 2);
      chipX += w + gap;
      chipsTotal = chipX - innerX - gap;
    }

    // Combo: right-anchored on its row, drawn only when it does not collide with
    // whatever that row already carries (chips when wide, the score card when
    // narrow). Hidden otherwise rather than allowed to overlap.
    if (this.hudCombo.text !== '') {
      fit(this.hudCombo, innerW * 0.4, compact ? 11 : 12, 10);
      const comboW = this.hudCombo.width + 20;
      const comboX = innerX + innerW - comboW;
      const rowTop = wide ? row2Top : row2Top;
      const thisRowH = wide ? chipRowH : scoreRowH;
      const rowOccupied = wide ? chipsTotal : Math.max(70, this.hudScoreValue.width + cardPad * 2);

      if (comboX - gap >= innerX + rowOccupied) {
        pill(comboX, rowTop + 2, comboW, thisRowH - 4, 0xffd166, 0.16, 0xffd166);
        this.hudCombo.setPosition(comboX + comboW / 2, rowTop + thisRowH / 2);
        this.hudCombo.setVisible(true);
      } else {
        this.hudCombo.setVisible(false);
      }
    } else {
      this.hudCombo.setVisible(false);
    }
  }

  /** The progress the objectives are measured against, read from GameState. */
  private progressSnapshot(): ObjectiveProgress {
    return {
      score: this.gameState.score,
      chordsCompleted: this.gameState.chordsCompleted,
      specialTilesCompleted: this.gameState.specialTilesCompleted,
      movesRemaining: this.gameState.movesRemaining,
    };
  }

  /**
   * Works out the tile size and origin for the current board dimensions.
   *
   * The board lives in the region between the header panel and the shell's bottom
   * dock and is sized to fit it, then centred, so a level can ask for any square
   * or rectangular board and still fit without either end hiding under chrome.
   */
  private layoutBoard(): void {
    const canvasWidth = this.scale.width;
    const canvasHeight = this.scale.height;

    // Short viewports get the compacted dock reserve, which is what the shell's
    // own media query compacts it to at the same height.
    const dockReserve = canvasHeight < SHORT_VIEWPORT ? DOCK_RESERVE_SHORT : DOCK_RESERVE;
    const availableWidth = canvasWidth - BOARD_MARGIN_X * 2;
    const regionTop = this.headerBottom + BOARD_GAP;
    const regionBottom = canvasHeight - dockReserve;
    const availableHeight = Math.max(
      MIN_TILE_SIZE * this.boardRows,
      regionBottom - regionTop
    );

    this.tileSize = Math.max(
      MIN_TILE_SIZE,
      Math.min(
        MAX_TILE_SIZE,
        Math.floor(
          Math.min(availableWidth / this.boardColumns, availableHeight / this.boardRows)
        )
      )
    );

    const boardWidth = this.boardColumns * this.tileSize;
    const boardHeight = this.boardRows * this.tileSize;

    this.boardOriginX = Math.floor((canvasWidth - boardWidth) / 2);
    this.boardOriginY = Math.round(
      regionTop + Math.max(0, (regionBottom - regionTop - boardHeight) / 2)
    );
    this.boardCenterY = this.boardOriginY + boardHeight / 2;

    // The transient notice sits over the middle of the board, whatever its size.
    this.hudNotice.setPosition(canvasWidth / 2, this.boardCenterY);
  }

  /**
   * Lays out the whole gameplay screen for the canvas size right now: backdrop,
   * header, board region, tiles, notices and the pause panel.
   *
   * One entry point, called once from create() and again on every resize, so the
   * regions cannot drift apart: the header decides where the board starts and the
   * shell's dock reserve decides where it ends.
   */
  private layoutGameplay(): void {
    // Header first: its bottom edge is where the backdrop's glow sits and where
    // the board region starts.
    this.layoutHud();
    this.createBackdrop();
    this.layoutBoard();
    this.drawGrid(this.boardFrame);

    // Snap idle tiles to their new cells. During a cascade the movement tweens
    // still hold the coordinates captured before the resize, so snapping now would
    // land them in the wrong cells; the snap is deferred to the cascade's end.
    if (this.tileVisuals.size > 0) {
      if (this.gameState.processing) {
        this.pendingTileSnap = true;
      } else {
        this.snapTilesToCells();
      }
    }

    this.drawSelection();

    // The cascade label rides just above the board, below the header.
    this.effects.setAnchor({ x: this.scale.width / 2, y: this.headerBottom + BOARD_GAP + 16 });
    this.layoutPauseOverlay();
  }

  /** Moves every tile container onto its cell in the current geometry. */
  private snapTilesToCells(): void {
    for (const visual of Array.from(this.tileVisuals.values())) {
      visual.container.setPosition(this.cellX(visual.tile.column), this.cellY(visual.tile.row));
    }

    this.pendingTileSnap = false;
  }

  private cellX(column: number): number {
    return this.boardOriginX + column * this.tileSize + this.tileSize / 2;
  }

  private cellY(row: number): number {
    return this.boardOriginY + row * this.tileSize + this.tileSize / 2;
  }

  /**
   * Paints the recessed tray and the cell wells the tiles sit in.
   *
   * Redrawn rather than recreated, so a resize or a new board size is one clear()
   * away. The wells are a few pixels larger than the tile faces, which is what
   * gives each piece a dark ring to sit in and separates neighbouring tiles
   * without the hard grid lines the prototype used.
   */
  private drawGrid(graphics: Phaser.GameObjects.Graphics): void {
    graphics.clear();

    const width = this.boardColumns * this.tileSize;
    const height = this.boardRows * this.tileSize;
    const pad = Math.max(8, Math.round(this.tileSize * 0.18));
    const trayX = this.boardOriginX - pad;
    const trayY = this.boardOriginY - pad;
    const trayW = width + pad * 2;
    const trayH = height + pad * 2;
    const trayRadius = Math.max(12, Math.round(this.tileSize * 0.32));
    const wellPad = 3;
    const wellSize = this.tileSize - wellPad * 2;
    const wellRadius = Math.max(5, Math.round(this.tileSize * 0.2));

    // Drop plate, tray surface, then the recessed inner field.
    graphics.fillStyle(0x000000, 0.45);
    graphics.fillRoundedRect(trayX, trayY + 6, trayW, trayH, trayRadius);
    graphics.fillStyle(0x0a2438, 0.96);
    graphics.fillRoundedRect(trayX, trayY, trayW, trayH, trayRadius);
    graphics.lineStyle(2, 0x7be0d0, 0.35);
    graphics.strokeRoundedRect(trayX, trayY, trayW, trayH, trayRadius);
    graphics.fillStyle(0x04101d, 0.72);
    graphics.fillRoundedRect(
      trayX + 4,
      trayY + 4,
      trayW - 8,
      trayH - 8,
      Math.max(8, trayRadius - 4)
    );

    // Cell wells: one rounded socket per tile, kept just larger than the face.
    for (let row = 0; row < this.boardRows; row++) {
      for (let column = 0; column < this.boardColumns; column++) {
        const x = this.boardOriginX + column * this.tileSize + wellPad;
        const y = this.boardOriginY + row * this.tileSize + wellPad;

        graphics.fillStyle(0x000000, 0.34);
        graphics.fillRoundedRect(x, y, wellSize, wellSize, wellRadius);
        graphics.lineStyle(1, 0xffffff, 0.06);
        graphics.strokeRoundedRect(x, y, wellSize, wellSize, wellRadius);
      }
    }
  }

  private createTiles(): void {
    for (let row = 0; row < this.boardRows; row++) {
      for (let column = 0; column < this.boardColumns; column++) {
        const tile = this.board.getTileAt(row, column);
        if (!tile) continue;

        this.createTileVisual(tile);
      }
    }
  }

  /** Destroys every tile container, so a new level starts from nothing. */
  private destroyTileVisuals(): void {
    for (const visual of Array.from(this.tileVisuals.values())) {
      visual.container.destroy();
    }

    this.tileVisuals.clear();
  }

  /**
   * Builds the Phaser objects for one tile and registers it in the visual map
   * keyed by tile id. Shared by initial board creation and by refill, so a new
   * tile is drawn exactly like an original one.
   *
   * Layer order is a contract: the shadow stays the first child because
   * EffectsManager flashes container.list[0] on a match and on a rejected swap,
   * and only a Shape carries the fill colour that flash tweens.
   */
  private createTileVisual(tile: Tile): TileVisual {
    this.ensureTileTextures();

    const container = this.add.container(this.cellX(tile.column), this.cellY(tile.row));
    const faceSize = this.tileSize - 10;

    // Soft drop shadow: elliptical so the corners read as depth under a rounded
    // face, and a Shape so the flash effect can tint its fill.
    const shadow = this.add.ellipse(2, 3, this.tileSize - 6, this.tileSize - 8, 0x000000, 0.32);
    shadow.setOrigin(0.5);

    // Hover/selection halo. A Rectangle because EffectsManager strokes it when a
    // tile is selected; invisible at rest, so its squareness never shows.
    const innerGlow = this.add.rectangle(0, 0, faceSize - 2, faceSize - 2, 0xffffff, 1);
    innerGlow.setOrigin(0.5);
    innerGlow.setVisible(false);

    const face = this.add.image(0, 0, TILE_TEXTURE.face(tile.noteType));
    face.setDisplaySize(faceSize, faceSize);

    const overlay = this.add.image(0, 0, TILE_TEXTURE.stripeH);
    overlay.setDisplaySize(faceSize, faceSize);
    overlay.setVisible(false);

    const text = this.add
      .text(0, -Math.round(this.tileSize * 0.02), tile.noteType, {
        fontSize: `${Math.round(this.tileSize * 0.42)}px`,
        fontFamily: 'Arial',
        color: '#ffffff',
        fontStyle: 'bold',
        stroke: '#0b1a33',
        strokeThickness: Math.max(2, Math.round(this.tileSize * 0.06)),
        shadow: {
          offsetX: 0,
          offsetY: Math.max(1, Math.round(this.tileSize * 0.03)),
          color: 'rgba(0, 0, 0, 0.5)',
          blur: Math.max(2, Math.round(this.tileSize * 0.05)),
          fill: true,
        },
      })
      .setOrigin(0.5);

    const badge = this.add
      .text(0, Math.round(this.tileSize * 0.3), '', {
        fontSize: `${Math.round(this.tileSize * 0.26)}px`,
        fontFamily: 'Arial',
        color: '#ffd166',
        fontStyle: 'bold',
        stroke: '#0b1a33',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setVisible(false);

    // Bottom to top: shadow, halo, face, special pattern, note, badge.
    container.add([shadow, innerGlow, face, overlay, text, badge]);
    container.setSize(this.tileSize, this.tileSize);
    container.setInteractive(
      new Phaser.Geom.Rectangle(
        -this.tileSize / 2,
        -this.tileSize / 2,
        this.tileSize,
        this.tileSize
      ),
      Phaser.Geom.Rectangle.Contains
    );
    container.on(Phaser.Input.Events.POINTER_UP, () => this.handleTilePointerUp(tile));
    // Pointer down/over/out for pressed/hover states
    container.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) =>
      this.onTilePointerDown(tile, pointer)
    );
    container.on(Phaser.Input.Events.POINTER_OVER, () => this.onTilePointerOver(tile));
    container.on(Phaser.Input.Events.POINTER_OUT, () => this.onTilePointerOut(tile));

    const visual: TileVisual = { tile, container, text, badge, shadow, face, overlay, innerGlow };
    this.tileVisuals.set(tile.id, visual);

    this.syncVisual(visual);

    return visual;
  }

  /** Generates the tile art once, on the first tile that needs it. */
  private ensureTileTextures(): void {
    if (this.textures.exists(TILE_TEXTURE.stripeV)) return;

    for (const note of NOTES) this.paintFaceTexture(TILE_TEXTURE.face(note), NOTE_COLORS[note]);

    this.paintBombTexture();
    this.paintStripeTexture(TILE_TEXTURE.stripeH, 'horizontal');
    this.paintStripeTexture(TILE_TEXTURE.stripeV, 'vertical');
  }

  /**
   * One rounded, bevelled note face: vertical gradient, top sheen, bottom shade
   * and a two-tone rim. Painted at 128px and scaled down per tile, so a face
   * stays smooth at every board size the layout can choose.
   */
  private paintFaceTexture(key: string, color: number): void {
    const size = 128;
    const texture = this.textures.createCanvas(key, size, size);
    if (!texture) return;

    const ctx = texture.context;
    const r = (color >> 16) & 255;
    const g = (color >> 8) & 255;
    const b = color & 255;
    const lighten = (amount: number): string =>
      `rgb(${Math.round(r + (255 - r) * amount)}, ${Math.round(g + (255 - g) * amount)}, ${Math.round(
        b + (255 - b) * amount
      )})`;
    const darken = (amount: number): string =>
      `rgb(${Math.round(r * (1 - amount))}, ${Math.round(g * (1 - amount))}, ${Math.round(
        b * (1 - amount)
      )})`;
    const inset = 4;

    this.roundedRect(ctx, inset, inset, size - inset * 2, size - inset * 2, 30);
    ctx.save();
    ctx.clip();

    const body = ctx.createLinearGradient(0, inset, 0, size - inset);
    body.addColorStop(0, lighten(0.4));
    body.addColorStop(0.45, `rgb(${r}, ${g}, ${b})`);
    body.addColorStop(1, darken(0.38));
    ctx.fillStyle = body;
    ctx.fillRect(0, 0, size, size);

    // Top-edge sheen: the specular band that makes the piece read as bevelled.
    const sheen = ctx.createLinearGradient(0, inset, 0, size * 0.5);
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
    sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, size, size * 0.5);

    // Bottom shade, for weight.
    const shade = ctx.createLinearGradient(0, size * 0.6, 0, size - inset);
    shade.addColorStop(0, 'rgba(0, 0, 0, 0)');
    shade.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, size * 0.6, size, size);

    ctx.restore();

    // Rim: bright top edge over a dark outline, kept inside the shape.
    this.roundedRect(ctx, inset, inset, size - inset * 2, size - inset * 2, 30);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.stroke();
    this.roundedRect(ctx, inset + 1.5, inset + 1.5, size - inset * 2 - 3, size - inset * 2 - 3, 28);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(4, 12, 24, 0.5)';
    ctx.stroke();

    texture.refresh();
  }

  /**
   * The color bomb face: a dark orb with an orbit ring and sparkles, so the
   * piece that has no note identity still reads as special at a glance.
   */
  private paintBombTexture(): void {
    const size = 128;
    const texture = this.textures.createCanvas(TILE_TEXTURE.bomb, size, size);
    if (!texture) return;

    const ctx = texture.context;
    const inset = 4;

    this.roundedRect(ctx, inset, inset, size - inset * 2, size - inset * 2, 30);
    ctx.save();
    ctx.clip();

    const body = ctx.createLinearGradient(0, inset, 0, size - inset);
    body.addColorStop(0, '#3d3d78');
    body.addColorStop(0.5, '#23234a');
    body.addColorStop(1, '#101027');
    ctx.fillStyle = body;
    ctx.fillRect(0, 0, size, size);

    // Orbit ring.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 40, 0, Math.PI * 2);
    ctx.stroke();

    // Sparkles, placed rather than random so the piece is identical every run.
    const sparks: Array<[number, number, number]> = [
      [size / 2, 34, 4],
      [size - 34, size / 2, 3.5],
      [size / 2, size - 34, 4],
      [34, size / 2, 3.5],
      [size / 2, size / 2, 7],
      [44, 44, 3],
      [size - 44, size - 44, 3],
    ];
    ctx.fillStyle = '#ffe09a';
    for (const [x, y, radius] of sparks) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    this.roundedRect(ctx, inset, inset, size - inset * 2, size - inset * 2, 30);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255, 224, 154, 0.8)';
    ctx.stroke();

    texture.refresh();
  }

  /**
   * The line-clear pattern: a bright rim plus two bars running the direction the
   * tile will fire in. Shape and orientation carry the meaning as well as colour,
   * and the '=' / '|' badge stays on as a second, textual cue.
   */
  private paintStripeTexture(key: string, orientation: 'horizontal' | 'vertical'): void {
    const size = 128;
    const texture = this.textures.createCanvas(key, size, size);
    if (!texture) return;

    const ctx = texture.context;
    const inset = 4;

    this.roundedRect(ctx, inset, inset, size - inset * 2, size - inset * 2, 30);
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
    if (orientation === 'horizontal') {
      for (const y of [size * 0.26, size * 0.66]) {
        this.roundedRect(ctx, 16, y, size - 32, 13, 6.5);
        ctx.fill();
      }
    } else {
      for (const x of [size * 0.26, size * 0.66]) {
        this.roundedRect(ctx, x, 16, 13, size - 32, 6.5);
        ctx.fill();
      }
    }

    texture.refresh();
  }

  /** A rounded rectangle path, written by hand for older canvas implementations. */
  private roundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ): void {
    const r = Math.min(radius, width / 2, height / 2);

    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  private handleTilePointerUp(tile: Tile): void {
    // A tap is a real user gesture, which is what unlocks the AudioContext. The
    // call is idempotent, so doing it on every tap costs nothing.
    this.audio.initialize();

    if (this.dragSwapped) {
      this.dragSwapped = false;
      return;
    }

    // One flag covers everything: a running cascade, a won or lost level, an
    // overlay that is swallowing input and an exhausted move list all say no here.
    // Pausing joins them: the attempt is frozen, so the board must not answer.
    if (this.paused || !this.gameState.canAcceptInput) return;

    if (this.selectedTile === null) {
      this.selectTile(tile);
      return;
    }

    if (this.selectedTile === tile) {
      this.clearSelection();
      return;
    }

    if (!this.board.isAdjacent(this.selectedTile, tile)) {
      this.clearSelection();
      this.selectTile(tile);
      return;
    }

    this.performSwap(this.selectedTile, tile);
  }

  /** Pointer down on a tile - pressed state feedback and drag start */
  private onTilePointerDown(tile: Tile, pointer?: Phaser.Input.Pointer): void {
    if (this.paused || !this.gameState.canAcceptInput) return;
    this.dragStartTile = tile;
    this.dragStartPoint = pointer ? { x: pointer.x, y: pointer.y } : null;
    this.dragSwapped = false;
    const visual = this.tileVisuals.get(tile.id);
    if (!visual) return;
    // Pressed state: slight scale down, inner glow
    this.tweens.killTweensOf(visual.container);
    visual.container.setScale(0.95);
    visual.innerGlow.setVisible(true);
    visual.innerGlow.setAlpha(0.15);
  }

  /** Pointer over a tile - hover state feedback */
  private onTilePointerOver(tile: Tile): void {
    if (this.paused || !this.gameState.canAcceptInput) return;
    if (this.selectedTile === tile) return; // Already selected, handled by selection effect
    const visual = this.tileVisuals.get(tile.id);
    if (!visual) return;
    // Hover state: subtle scale up, inner glow
    this.tweens.killTweensOf(visual.container);
    this.tweens.add({
      targets: visual.container,
      scale: 1.03,
      duration: 80,
      ease: 'Quad.easeOut',
    });
    visual.innerGlow.setVisible(true);
    this.tweens.add({
      targets: visual.innerGlow,
      alpha: 0.12,
      duration: 100,
      ease: 'Quad.easeOut',
    });
  }

  /** Pointer out from a tile - return to idle state */
  private onTilePointerOut(tile: Tile): void {
    if (this.selectedTile === tile) return; // Selected tile keeps its selection effect
    const visual = this.tileVisuals.get(tile.id);
    if (!visual) return;

    // Tiles move under a resting pointer during swaps and cascades, so this event
    // fires while the tile's swap/gravity/pop tween is in flight. Those tweens
    // drive the cascade's promise chain: killing one strands its resolve() and
    // soft-locks the game (empty cells, no input) — so while input is locked only
    // the cosmetic hover glow is cleared and the animations are left alone.
    if (this.paused || !this.gameState.canAcceptInput) {
      this.tweens.killTweensOf(visual.innerGlow);
      visual.innerGlow.setVisible(false);
      visual.innerGlow.setAlpha(0);
      // A leftover hover scale is safe to undo only when nothing is animating
      // the container; otherwise the running tween owns the scale.
      if (!this.tweens.isTweening(visual.container)) visual.container.setScale(1);
      return;
    }

    // Return to idle: scale 1, no inner glow
    this.tweens.killTweensOf(visual.container);
    this.tweens.add({
      targets: visual.container,
      scale: 1,
      duration: 120,
      ease: 'Quad.easeOut',
    });
    this.tweens.add({
      targets: visual.innerGlow,
      alpha: 0,
      duration: 150,
      ease: 'Quad.easeOut',
      onComplete: () => visual.innerGlow.setVisible(false),
    });
  }

  private selectTile(tile: Tile): void {
    this.audio.playSelect();
    this.selectedTile = tile;
    this.board.selectTile(tile.row, tile.column);
    this.drawSelection();

    const visual = this.tileVisuals.get(tile.id);
    if (visual) this.effects.playSelection(visual);
  }

  private clearSelection(): void {
    const visual = this.selectedTile ? this.tileVisuals.get(this.selectedTile.id) : undefined;

    this.selectedTile = null;

    // The scene can exist before any board does: it waits for a play request. There
    // is never a selection in that state, so there is nothing to deselect.
    if (this.board) this.board.deselectTile();

    this.drawSelection();

    if (visual) this.effects.playDeselection(visual);
  }

  private drawSelection(): void {
    this.selectionOutline.clear();

    if (!this.selectedTile) return;

    const x = this.cellX(this.selectedTile.column);
    const y = this.cellY(this.selectedTile.row);
    const inset = Math.max(1, Math.round(this.tileSize * 0.04));
    const size = this.tileSize - inset * 2;
    const radius = Math.max(6, Math.round(this.tileSize * 0.22));
    const left = x - size / 2;
    const top = y - size / 2;

    // A soft lift under the ring, then the ring itself: rounded so it matches
    // the face rather than boxing it in.
    this.selectionOutline.fillStyle(0xffffff, 0.14);
    this.selectionOutline.fillRoundedRect(left, top, size, size, radius);
    this.selectionOutline.lineStyle(3, 0xffffff, 0.95);
    this.selectionOutline.strokeRoundedRect(left, top, size, size, radius);
  }

  /**
   * Draws a tile from its current data state.
   *
   * Special tiles are drawn from the same objects as ordinary notes, so a tile
   * that is promoted mid-cascade simply re-renders instead of being replaced.
   * That is what keeps the tile, its id and its hit box intact.
   */
  private syncVisual(visual: TileVisual): void {
    const tile = visual.tile;
    const faceSize = this.tileSize - 10;

    visual.face.setDisplaySize(faceSize, faceSize);
    visual.overlay.setDisplaySize(faceSize, faceSize);

    if (tile.special === 'color-bomb') {
      visual.text.setText(COLOR_BOMB_GLYPH);
      visual.badge.setVisible(false);
      visual.face.setTexture(TILE_TEXTURE.bomb);
      visual.overlay.setVisible(false);
      visual.innerGlow.setVisible(false);
      // Color bomb: pulsing glow
      if (!visual.container.getData('colorBombPulse')) {
        visual.container.setData('colorBombPulse', true);
        this.tweens.add({
          targets: visual.face,
          alpha: { from: 1, to: 0.7 },
          duration: 800,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
      return;
    }

    visual.face.setTexture(TILE_TEXTURE.face(tile.noteType));
    visual.face.setAlpha(1);
    visual.text.setText(tile.noteType);
    visual.innerGlow.setVisible(false);
    visual.innerGlow.setAlpha(1);

    const isLineClear = tile.special === 'line-clear';

    if (isLineClear) {
      // Pattern plus glyph: the stripes say which way it fires and the '=' / '|'
      // badge repeats it in text, so the tile is distinguishable without colour.
      visual.overlay.setTexture(
        tile.orientation === 'vertical' ? TILE_TEXTURE.stripeV : TILE_TEXTURE.stripeH
      );
      visual.overlay.setVisible(true);
      visual.badge.setText(LINE_CLEAR_GLYPHS[tile.orientation ?? 'horizontal']);
      visual.badge.setVisible(true);

      if (!visual.container.getData('lineClearPulse')) {
        visual.container.setData('lineClearPulse', true);
        this.tweens.add({
          targets: visual.face,
          alpha: { from: 1, to: 0.8 },
          duration: 1000,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    } else {
      // Regular tile
      visual.overlay.setVisible(false);
      visual.badge.setVisible(false);
      visual.container.setData('lineClearPulse', false);
      visual.container.setData('colorBombPulse', false);
    }
  }

  private performSwap(tileA: Tile, tileB: Tile): void {
    const visualA = this.tileVisuals.get(tileA.id);
    const visualB = this.tileVisuals.get(tileB.id);
    if (!visualA || !visualB) return;

    const outcome = planSpecialSwap(this.board, tileA, tileB);

    // Special + special combinations are not implemented yet. Refusing the swap
    // costs the player nothing and leaves the board exactly as it was.
    if (outcome.type === 'unsupported') {
      console.log('SPECIAL + SPECIAL SWAP NOT SUPPORTED YET');
      this.audio.playInvalidSwap();
      return;
    }

    // A swap into a special tile fires it in place. No literal swap happens:
    // the activation already consumes the tile it was swapped with, so the
    // notes are left where they are and the effect just plays out.
    if (outcome.type === 'plan') {
      this.activateSpecialTile(outcome.plan);
      return;
    }

    if (!this.board.swapAdjacentTiles(tileA, tileB)) return;

    this.syncVisual(visualA);
    this.syncVisual(visualB);

    this.gameState.lock();
    this.clearSelection();

    this.animateSwap(visualA, visualB, () => {
      const groups = findMatchGroups(this.board);
      const matched = collectGroupTiles(groups);

      const swapCreatedMatch = matched.some(
        (tile) => tile === tileA || tile === tileB
      );

      if (swapCreatedMatch) {
        this.audio.playSwap();

        // Cascade logging (MATCH FOUND / REMOVING / GRAVITY / REFILL) is owned
        // by CascadeEngine; only the note detail is worth printing here.
        console.log('Notes:', matched.map((tile) => tile.noteType).join(' '));
        console.log(
          'Positions:',
          matched.map((tile) => `(${tile.row}, ${tile.column})`).join(' ')
        );

        // A valid swap costs exactly one move, no matter how many cascade
        // stages follow it.
        this.beginScoredTurn();

        // The special tile is created where the player's swap landed, so a 4- or
        // 5-match made by hand hands back the cell the player aimed at.
        const stage = planMatchStage(this.board, groups, {
          row: tileB.row,
          column: tileB.column,
        });

        void this.runCascadeFor(stage);
        return;
      }

      console.log('NO MATCH - REVERTING SWAP');
      this.audio.playInvalidSwap();

      // Invalid swap: no move, no score, no cascade.
      this.revertDataSwap(tileA, tileB);
      this.syncVisual(visualA);
      this.syncVisual(visualB);

      // The data is already back where it started, so this is purely the visual
      // rejection: the tiles travel home and swell slightly as they arrive.
      this.effects.playInvalidSwap(
        visualA,
        visualB,
        { x: this.cellX(tileA.column), y: this.cellY(tileA.row) },
        { x: this.cellX(tileB.column), y: this.cellY(tileB.row) },
        () => {
          this.gameState.unlock();
        }
      );
    });
  }

  /**
   * Runs a stage planned by a direct swap into a special tile.
   *
   * The move is charged here because the swap was legal and did something. Only
   * one move is ever charged: the cascade that follows is part of this same
   * turn, so activations and further cascades cannot cost extra moves.
   */
  private activateSpecialTile(plan: StagePlan): void {
    console.log(
      `ACTIVATING ${String(plan.activation).toUpperCase()} - ${plan.removals.length} TILES CLEARED`
    );

    this.gameState.lock();
    this.clearSelection();

    this.beginScoredTurn();

    void this.runCascadeFor(plan);
  }

  /**
   * Starts the turn that follows a successful swap.
   *
   * Both ways into a turn go through here, so the per-move counters can never be
   * reset at one call site and forgotten at the other: the move is charged, the
   * chord chain starts over, and the cascade multiplier goes back to x1.
   *
   * Never reached by an invalid swap, which is why an illegal move cannot create
   * a chord chain or spend anything.
   */
  private beginScoredTurn(): void {
    this.gameState.addMove();
    this.chordCombo.reset();
    this.gameState.beginTurn();
    this.updateHud();
  }

  private revertDataSwap(tileA: Tile, tileB: Tile): void {
    this.board.selectTile(tileA.row, tileA.column);
    this.board.swapAdjacentTiles(tileA, tileB);
    this.board.deselectTile();
  }

  /**
   * Runs the whole post-match cascade while holding the input lock. The lock is
   * released in a finally block so a thrown animation can never soft-lock the
   * board, but the failure is logged loudly rather than swallowed.
   */
  private async runCascadeFor(stage: StagePlan): Promise<void> {
    try {
      await runCascade(this.board, this.createPresenter(), stage);
    } catch (error) {
      console.error('CASCADE FAILED - board may be inconsistent', error);
    } finally {
      this.gameState.endTurn();

      // A resize that arrived mid-cascade deferred its tile snap; the tweens are
      // finished now, so the cells are safe to move them to.
      if (this.pendingTileSnap) this.snapTilesToCells();

      this.updateHud();
      // The chord stays up for the whole cascade, then clears with the combo.
      this.hideNotice();
    }

    // Settle the level before looking for deadlocks: a won or lost attempt no
    // longer needs a playable board, and reshuffling would spend the player's
    // attention on a game that has already ended.
    this.evaluateOutcome();

    if (this.gameState.status !== 'playing') return;

    // The turn is over and the lock is released, so a deadlock found here can
    // safely re-acquire it for the shuffle.
    await this.ensurePlayableBoard();
  }

  // ============================================================ LEVEL FLOW

  /**
   * Starts a level from scratch.
   *
   * The whole attempt is rebuilt in one place, so a retry cannot inherit a
   * leftover score, move count, objective or tile from the attempt before it:
   * geometry first, then a freshly generated board, then a state reset, then the
   * HUD. LevelManager owns which level this is; GameState owns what has happened
   * in it.
   */
  private startLevel(level: Level): void {
    this.hideOverlay();
    // Nothing from the attempt before may outlive this board: popups, sweeps and
    // in-flight particles are cleared before the new one is built.
    this.effects.clearTransient();

    // A previous attempt may have been paused when it was abandoned. Its tweens are
    // still frozen and its promises still pending, so they are destroyed here: left
    // alone they would resume on the new board. The manager's own pause flag is
    // cleared too, so the new level's tweens are never born paused.
    this.tweens.killAll();
    this.tweens.resumeAll();
    this.time.paused = false;
    this.paused = false;

    // Geometry comes from the level, so 7x7 or 9x9 needs nothing else changed.
    this.boardRows = level.boardHeight;
    this.boardColumns = level.boardWidth;

    // The previous attempt's tiles are destroyed rather than hidden: a new board
    // must not have a single stale tile on it.
    this.destroyTileVisuals();

    // Whole-screen layout first: the header decides where the board region
    // starts, and the tray is drawn from the geometry this level just declared.
    this.layoutGameplay();

    // Match-free and provably playable before the player ever sees it.
    //
    // Created before clearSelection because deselectTile needs a board, and on the
    // first level there is not one yet. Getting this order wrong throws mid-start
    // and leaves the scene with a header, a default HUD and no board at all.
    this.board = createPlayableBoard(level.boardHeight, level.boardWidth);
    this.createTiles();

    // Now that the board exists, drop any selection. There never is one here, but
    // this is shared with mid-game calls where there might be.
    this.clearSelection();

    // Score, moves, objectives, chord chain and status all clear here.
    this.gameState.startLevel(level.moveLimit);
    this.chordCombo.reset();
    this.chordBuilder.reset();

    this.updateHud();
    this.audio.playLevelStart();

    console.log(
      `LEVEL ${level.id} "${level.name}": ${level.boardWidth}x${level.boardHeight}, ` +
        `${level.moveLimit} moves, target ${level.scoreTarget}, ` +
        `${findMatches(this.board).length} starting matches, playable=${hasValidMove(this.board)}`
    );
  }

  /**
   * Decides whether the level just ended in a win or a loss, and shows it.
   *
   * Called once per turn, after the cascade has fully finished, so a level can
   * never be judged mid-animation. GameState.finish only transitions out of
   * 'playing', which is what stops a second call from re-triggering the result,
   * and the input lock falls out of the status change with no extra flag.
   */
  private evaluateOutcome(): void {
    if (this.gameState.status !== 'playing') return;

    const level = this.levels.getCurrentLevel();
    const progress = this.progressSnapshot();
    const outcome = levelOutcome(level, progress);

    if (outcome === 'playing') return;

    // Locks input and settles the status before anything is drawn, so the board
    // cannot be touched while the overlay appears.
    if (!this.gameState.finish(outcome)) return;

    this.clearSelection();
    this.audio.initialize();

    if (outcome === 'won') {
      // The campaign's number is read *before* the attempt is recorded, because
      // completeLevel raises it to this attempt's score. Read afterwards, "was this
      // a personal best?" would be comparing the score with itself.
      const bestBefore = this.progression.getBestScore(level.id);

      // Progress is recorded before the panel is drawn, so the campaign is
      // already up to date by the time the player presses LEVEL MAP. It is
      // idempotent, so reaching this point twice cannot double-count.
      this.progression.completeLevel(level.id, { score: progress.score });
      this.bridge.reportLevelCompleted({
        levelId: level.id,
        score: progress.score,
        movesUsed: level.moveLimit - progress.movesRemaining,
      });

      this.audio.playWin();
      // The final level is the one with nothing after it, so it gets a heading and
      // a primary action that promise nothing the campaign cannot deliver.
      this.showResultOverlay(
        buildLevelResultView({
          mode: this.levels.hasNextLevel() ? 'win' : 'final',
          level,
          progress,
          bestBefore,
        })
      );
      this.effects.playLevelComplete(this.tileContainers(), this.overlay.root, {
        x: this.scale.width / 2,
        y: this.boardCenterY,
      });

      return;
    }

    this.audio.playLose();
    this.showResultOverlay(
      buildLevelResultView({
        mode: 'lose',
        level,
        progress,
        // A loss records nothing, so the campaign's number is exactly what it was
        // before the attempt: showing it is honest, and claiming a best would not be.
        bestBefore: this.progression.getBestScore(level.id),
      })
    );
    this.effects.playLevelFailed(this.tileContainers(), this.overlay.root, {
      x: this.scale.width / 2,
      y: this.boardCenterY,
    });
  }

  /**
   * Builds the results panel once.
   *
   * One graphics object draws the panel and both buttons, because they are all
   * rounded rectangles in one palette; three rectangles would be the same numbers
   * three times and three sets of stroke styles to keep in step. The hit areas are
   * separate invisible rectangles, because a hit area has to be re-sized in place
   * when the panel is re-laid out and a mutable Geom.Rectangle does exactly that.
   *
   * Nothing here is positioned from the canvas size: layoutResultPanel() places
   * every part and runs again on resize, so the panel fits the screen it is on
   * rather than the one the game booted with.
   */
  private createLevelOverlay(): void {
    const canvasWidth = Math.max(1, this.scale.width);
    const canvasHeight = Math.max(1, this.scale.height);

    // The shade swallows pointer events, so a tile underneath cannot be dragged
    // through the panel while it is up. Created at 1x1 and stretched by the layout,
    // which keeps its hit area correct at every size without touching it.
    const shade = this.add.rectangle(0, 0, 1, 1, RESULT_COLORS.shade, 0.9);

    shade.setDisplaySize(canvasWidth, canvasHeight);
    shade.setPosition(Math.round(canvasWidth / 2), Math.round(canvasHeight / 2));
    shade.setDepth(RESULT_SHADE_DEPTH);
    shade.setInteractive();
    shade.setVisible(false);

    const frame = this.add.graphics();

    const heading = this.createResultText(34, RESULT_TEXT.heading, true);
    const levelLine = this.createResultText(16, RESULT_TEXT.muted, false);
    const scoreLabel = this.createResultText(12, RESULT_TEXT.muted, false);
    const scoreValue = this.createResultText(44, RESULT_TEXT.text, true);
    const bestLine = this.createResultText(15, RESULT_TEXT.best, true);
    const objectivesLabel = this.createResultText(12, RESULT_TEXT.muted, false);
    const objectiveRows: Phaser.GameObjects.Text[] = [];

    // One row per objective kind the engine can produce, so the pool can never be
    // too small for a level that asks for everything.
    for (let index = 0; index < MAX_RESULT_OBJECTIVE_ROWS; index++) {
      objectiveRows.push(this.createResultText(17, RESULT_TEXT.rowMet, false));
    }

    const primaryLabel = this.createResultText(21, RESULT_TEXT.primaryLabel, true);
    const secondaryLabel = this.createResultText(18, RESULT_TEXT.secondaryLabel, true);
    const primaryZone = this.createResultHitZone('primary');
    const secondaryZone = this.createResultHitZone('secondary');

    const root = this.add.container(0, 0, [
      frame,
      heading,
      levelLine,
      scoreLabel,
      scoreValue,
      bestLine,
      objectivesLabel,
      ...objectiveRows,
      primaryZone,
      secondaryZone,
      primaryLabel,
      secondaryLabel,
    ]);

    root.setDepth(RESULT_DEPTH);
    root.setVisible(false);

    this.overlay = {
      root,
      shade,
      frame,
      heading,
      levelLine,
      scoreLabel,
      scoreValue,
      bestLine,
      objectivesLabel,
      objectiveRows,
      primaryLabel,
      secondaryLabel,
      primaryZone,
      secondaryZone,
    };
  }

  /** One unpositioned result text. The layout gives it a place and a size. */
  private createResultText(
    fontSize: number,
    color: string,
    bold: boolean
  ): Phaser.GameObjects.Text {
    return this.add
      .text(0, 0, '', {
        fontSize: `${fontSize}px`,
        fontFamily: 'Arial',
        color,
        fontStyle: bold ? 'bold' : 'normal',
      })
      .setOrigin(0.5);
  }

  /**
   * One button's invisible hit area, wired for hover feedback and a click.
   *
   * The visuals are the graphics, so this only has to own the target. It is handed
   * to Phaser by reference, which is what makes re-sizing it in place the whole of
   * moving a button.
   */
  private createResultHitZone(action: ResultAction): Phaser.GameObjects.Rectangle {
    const zone = this.add.rectangle(0, 0, 1, 1, 0x000000, 0);

    zone.setInteractive(new Phaser.Geom.Rectangle(-0.5, -0.5, 1, 1), Phaser.Geom.Rectangle.Contains);

    zone.on(Phaser.Input.Events.POINTER_UP, () => {
      if (action === 'primary') this.handleOverlayPrimary();
      else this.handleOverlaySecondary();
    });
    zone.on(Phaser.Input.Events.POINTER_OVER, () => this.setResultHover(action));
    zone.on(Phaser.Input.Events.POINTER_OUT, () => this.setResultHover(null));

    return zone;
  }

  /**
   * Puts a finished attempt on screen.
   *
   * Everything shown comes from the view, and the view was built from real state:
   * the score from GameState, the objectives from the engine the HUD reads, the
   * best line from the campaign. This method decides none of it.
   */
  private showResultOverlay(view: LevelResultView): void {
    // The two overlays are never up at once: a level cannot end while it is paused.
    // Hiding the pause panel here is what keeps that true if the order ever changes.
    this.pauseOverlay.root.setVisible(false);

    this.overlayMode = view.mode;
    this.overlayView = view;
    // The result is asking the player to take the primary action, so that is where
    // the keyboard starts.
    this.overlayFocus = 'primary';
    this.overlayHover = null;

    const overlay = this.overlay;
    const failed = view.mode === 'lose';

    overlay.heading
      .setText(view.heading)
      .setColor(failed ? RESULT_TEXT.headingFailed : RESULT_TEXT.heading);
    overlay.levelLine.setText(view.levelLine);
    overlay.scoreLabel.setText(view.scoreLabel);
    overlay.scoreValue.setText(view.scoreValue);
    overlay.bestLine.setText(view.bestLine === null ? '' : view.bestLine);
    overlay.objectivesLabel.setText(view.objectivesLabel);
    overlay.primaryLabel.setText(view.primaryLabel);
    overlay.secondaryLabel.setText(view.secondaryLabel);

    overlay.objectiveRows.forEach((row, index) => {
      const data = index < view.objectiveRows.length ? view.objectiveRows[index] : null;

      row.setText(data === null ? '' : data.text);
      // Met reads bright, unmet reads quiet. The tick or cross in the text is the
      // real cue, so this is emphasis rather than the only signal.
      row.setColor(data !== null && data.complete ? RESULT_TEXT.rowMet : RESULT_TEXT.rowUnmet);
    });

    // Text first, then geometry: the layout needs the strings to know how small the
    // type has to be, and whether a best line exists changes the whole stack.
    this.layoutResultPanel();
    this.setOverlayVisible(true);
  }

  private hideOverlay(): void {
    this.overlayMode = 'none';
    this.overlayView = null;
    this.overlayLayout = null;
    this.overlayHover = null;
    this.overlayFocus = 'primary';
    this.setOverlayVisible(false);
  }

  /** Shows or hides the panel and its shade together: they are two objects. */
  private setOverlayVisible(visible: boolean): void {
    this.overlay.shade.setVisible(visible);
    this.overlay.root.setVisible(visible);
  }

  /**
   * Places every part of the panel for the canvas size right now.
   *
   * Called when a result appears and again on every resize, which is what keeps
   * the panel complete on a 320px screen and on a phone that has just been turned
   * sideways. A no-op while no result is up, so the resize handler needs no guard.
   */
  private layoutResultPanel(): void {
    const view = this.overlayView;

    if (view === null) return;

    const layout = computeResultPanelLayout({
      width: this.scale.width,
      height: this.scale.height,
      heading: view.heading,
      levelLine: view.levelLine,
      scoreLabel: view.scoreLabel,
      scoreValue: view.scoreValue,
      bestLine: view.bestLine,
      objectivesLabel: view.objectivesLabel,
      objectiveLines: view.objectiveRows.map((row) => row.text),
      primaryLabel: view.primaryLabel,
      secondaryLabel: view.secondaryLabel,
    });

    this.overlayLayout = layout;
    this.overlayHover = null;

    // The shade owns the whole canvas, whatever size that is now.
    const canvasWidth = Math.max(1, this.scale.width);
    const canvasHeight = Math.max(1, this.scale.height);

    this.overlay.shade.setDisplaySize(canvasWidth, canvasHeight);
    this.overlay.shade.setPosition(Math.round(canvasWidth / 2), Math.round(canvasHeight / 2));

    // Root sits on the canvas centre and every part is placed relative to it, so
    // the entrance tween swells the panel about the middle of the screen rather
    // than about its own top-left corner.
    const origin = this.resultOrigin();

    this.overlay.root.setPosition(origin.x, origin.y);

    this.placeResultText(this.overlay.heading, layout.heading, origin);
    this.placeResultText(this.overlay.levelLine, layout.levelLine, origin);
    this.placeResultText(this.overlay.scoreLabel, layout.scoreLabel, origin);
    this.placeResultText(this.overlay.scoreValue, layout.scoreValue, origin);
    this.placeResultText(this.overlay.bestLine, layout.bestLine, origin);
    this.placeResultText(this.overlay.objectivesLabel, layout.objectivesLabel, origin);

    this.overlay.objectiveRows.forEach((row, index) => {
      const slot: ResultPanelSlot | null =
        index < layout.objectiveRows.length ? layout.objectiveRows[index] : null;

      this.placeResultText(row, slot, origin);
    });

    this.placeResultButton(this.overlay.primaryLabel, this.overlay.primaryZone, layout.primary, origin);
    this.placeResultButton(
      this.overlay.secondaryLabel,
      this.overlay.secondaryZone,
      layout.secondary,
      origin
    );

    this.drawResultFrame();
  }

  /** The canvas centre, which is the coordinate root of the whole panel. */
  private resultOrigin(): { x: number; y: number } {
    const layout = this.overlayLayout;

    return {
      x: layout ? layout.centerX : Math.round(Math.max(1, this.scale.width) / 2),
      y: Math.round(Math.max(1, this.scale.height) / 2),
    };
  }

  /** Moves and re-sizes one line of text, or hides it when the layout dropped it. */
  private placeResultText(
    text: Phaser.GameObjects.Text,
    slot: ResultPanelSlot | null,
    origin: { x: number; y: number }
  ): void {
    if (slot === null) {
      text.setVisible(false);

      return;
    }

    text.setPosition(0, Math.round(slot.y - origin.y));
    text.setFontSize(slot.fontSize);
    text.setVisible(true);
  }

  /** Moves one button's label and re-aims its hit area, without rebuilding either. */
  private placeResultButton(
    label: Phaser.GameObjects.Text,
    zone: Phaser.GameObjects.Rectangle,
    button: ResultButtonSlot,
    origin: { x: number; y: number }
  ): void {
    const y = Math.round(button.y - origin.y);

    label.setPosition(0, y);
    label.setFontSize(button.fontSize);

    zone.setPosition(0, y);

    // The hit area Phaser already holds is mutated rather than replaced: it is the
    // same shape object, so this re-aims the button instead of stacking a second
    // interactive configuration on top of the first.
    if (zone.input) {
      zone.input.hitArea.setTo(
        -button.width / 2,
        -button.height / 2,
        button.width,
        button.height
      );
    }
  }

  /** A button's top-left corner, in root-local coordinates. */
  private resultButtonBox(
    button: ResultButtonSlot,
    origin: { x: number; y: number }
  ): { x: number; y: number; width: number; height: number } {
    return {
      x: Math.round(-button.width / 2),
      y: Math.round(button.y - origin.y - button.height / 2),
      width: Math.round(button.width),
      height: Math.round(button.height),
    };
  }

  /**
   * Paints the panel and both buttons.
   *
   * Redrawn rather than re-created, because hover and focus change one fill and one
   * stroke. Local coordinates are used so the drawing travels with root when the
   * entrance tween scales it.
   */
  private drawResultFrame(): void {
    const layout = this.overlayLayout;

    if (layout === null) return;

    const origin = this.resultOrigin();
    const frame = this.overlay.frame;
    const left = Math.round(layout.panelX - origin.x);
    const top = Math.round(layout.panelY - origin.y);
    const stroke = this.overlayMode === 'lose' ? RESULT_COLORS.danger : RESULT_COLORS.accent;

    frame.clear();

    // A darker plate behind the panel gives it an edge without a blur, which
    // Phaser's graphics cannot draw. Two layers, no shadow texture.
    frame.fillStyle(RESULT_COLORS.shadow, 0.85);
    frame.fillRoundedRect(
      left - RESULT_FOCUS_OFFSET,
      top - RESULT_FOCUS_OFFSET,
      layout.panelWidth + RESULT_FOCUS_OFFSET * 2,
      layout.panelHeight + RESULT_FOCUS_OFFSET * 2,
      RESULT_RADIUS + RESULT_FOCUS_OFFSET
    );

    frame.fillStyle(RESULT_COLORS.panel, 1);
    frame.fillRoundedRect(left, top, layout.panelWidth, layout.panelHeight, RESULT_RADIUS);
    frame.lineStyle(2, stroke, 1);
    frame.strokeRoundedRect(left, top, layout.panelWidth, layout.panelHeight, RESULT_RADIUS);

    this.drawResultButton(layout.primary, origin, 'primary');
    this.drawResultButton(layout.secondary, origin, 'secondary');

    // The focus ring goes last so it reads as being in front of everything, and it
    // is a ring rather than a colour change, so focus is visible without depending
    // on one hue being distinguishable from another.
    const focused =
      this.overlayFocus === 'primary' ? this.resultButtonBox(layout.primary, origin) : this.resultButtonBox(layout.secondary, origin);

    frame.lineStyle(3, RESULT_COLORS.focus, 1);
    frame.strokeRoundedRect(
      focused.x - RESULT_FOCUS_OFFSET,
      focused.y - RESULT_FOCUS_OFFSET,
      focused.width + RESULT_FOCUS_OFFSET * 2,
      focused.height + RESULT_FOCUS_OFFSET * 2,
      RESULT_RADIUS + RESULT_FOCUS_OFFSET
    );
  }

  /** One button, in the fill its hover state calls for. */
  private drawResultButton(
    button: ResultButtonSlot,
    origin: { x: number; y: number },
    action: ResultAction
  ): void {
    const box = this.resultButtonBox(button, origin);
    const frame = this.overlay.frame;
    const hovered = this.overlayHover === action;
    let fill = RESULT_COLORS.secondaryFill;

    if (action === 'primary') {
      fill = hovered ? RESULT_COLORS.primaryFillHover : RESULT_COLORS.primaryFill;
    } else if (hovered) {
      fill = RESULT_COLORS.secondaryFillHover;
    }

    frame.fillStyle(fill, 1);
    frame.fillRoundedRect(box.x, box.y, box.width, box.height, RESULT_RADIUS);
    frame.lineStyle(2, RESULT_COLORS.accent, 1);
    frame.strokeRoundedRect(box.x, box.y, box.width, box.height, RESULT_RADIUS);
  }

  private setResultHover(action: ResultAction | null): void {
    if (this.overlayHover === action) return;

    this.overlayHover = action;
    this.drawResultFrame();
  }

  /**
   * Re-places the panel whenever the canvas changes size.
   *
   * Resize rather than orientation, because that is the event the scale manager
   * actually emits once the canvas has changed. The panel only cares how much room
   * it has, not what caused the change.
   */
  private attachResultResize(): () => void {
    // One listener for the whole screen: the result panel needs re-placing, and
    // so does everything else the canvas size determines — backdrop, header,
    // board, tiles and the pause panel.
    const onResize = (): void => {
      this.layoutGameplay();
      this.layoutResultPanel();
    };

    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);

    return () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
    };
  }

  /**
   * Wires the keyboard for the results panel.
   *
   * A canvas has no DOM focus to move, so the panel keeps its own: Tab and the
   * arrow keys step between the two actions, Enter and Space take the focused one,
   * and Escape goes to the map — the destination the secondary button already
   * offers, reached a second way.
   *
   * Defaults are only prevented while a result is up, so Tab still reaches the
   * shell's own buttons during play and Escape keeps whatever meaning it has
   * outside a result.
   */
  private attachResultKeys(): () => void {
    const keyboard = this.input.keyboard;

    if (keyboard === null) return () => undefined;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (this.overlayMode === 'none') {
        this.handleGameplayKey(event);

        return;
      }

      const key = event.key;

      if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        this.activateResultAction();

        return;
      }

      if (key === 'Escape') {
        event.preventDefault();
        this.handleOverlaySecondary();

        return;
      }

      if (
        key === 'Tab' ||
        key === 'ArrowDown' ||
        key === 'ArrowUp' ||
        key === 'ArrowLeft' ||
        key === 'ArrowRight'
      ) {
        event.preventDefault();
        this.moveResultFocus();
      }
    };

    keyboard.on('keydown', onKeyDown);

    return () => {
      keyboard.off('keydown', onKeyDown);
    };
  }

  /** Steps between the two actions. Two buttons need a toggle, not a traversal. */
  private moveResultFocus(): void {
    this.overlayFocus = this.overlayFocus === 'primary' ? 'secondary' : 'primary';
    this.drawResultFrame();
  }

  /**
   * Pause keyboard, active only while no result panel is up so the two overlays
   * can never both answer for a key.
   *
   * Escape opens and closes the pause; while paused, the arrows and Tab choose a
   * button and Enter or Space takes it, which is what keeps the overlay reachable
   * without a pointer. During play every other key keeps whatever meaning the
   * shell has given it.
   */
  private handleGameplayKey(event: KeyboardEvent): void {
    const key = event.key;

    if (!this.paused) {
      if (key === 'Escape' && this.gameState.status === 'playing') {
        event.preventDefault();
        this.pauseGame();
        return;
      }

      if ((key === 'h' || key === 'H') && this.gameState.canAcceptInput) {
        event.preventDefault();
        this.showHint();
      }

      return;
    }

    if (key === 'Escape') {
      event.preventDefault();
      this.resumeGame();

      return;
    }

    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      this.activatePauseAction(this.pauseFocus);

      return;
    }

    if (
      key === 'Tab' ||
      key === 'ArrowDown' ||
      key === 'ArrowUp' ||
      key === 'ArrowLeft' ||
      key === 'ArrowRight'
    ) {
      event.preventDefault();

      const index = PAUSE_ACTIONS.indexOf(this.pauseFocus);
      const backwards =
        key === 'ArrowUp' || key === 'ArrowLeft' || (key === 'Tab' && event.shiftKey);
      const step = backwards ? -1 : 1;

      this.pauseFocus = PAUSE_ACTIONS[(index + step + PAUSE_ACTIONS.length) % PAUSE_ACTIONS.length];
      this.drawPauseFrame();
    }
  }

  /** Takes whichever action the keyboard is currently on. */
  private activateResultAction(): void {
    if (this.overlayFocus === 'secondary') {
      this.handleOverlaySecondary();

      return;
    }

    this.handleOverlayPrimary();
  }

  /**
   * Builds the pause overlay once: shade, heading, three buttons and their hit
   * zones, all as one rounded frame in the same language as the results panel.
   *
   * Nothing is positioned here. layoutPauseOverlay places every part and runs
   * again on resize and whenever the overlay is shown, so the panel is centred on
   * the canvas it is on rather than the one the game booted with. Three buttons
   * rather than one, because leaving a level is a real decision and the player
   * should not have to pause just to change their mind.
   */
  private createPauseOverlay(): void {
    // The shade swallows pointer events, so the frozen board underneath cannot be
    // tapped through. Created at 1x1 and stretched by the layout.
    const shade = this.add.rectangle(0, 0, 1, 1, 0x0b0b14, 0.82);
    shade.setInteractive();

    const frame = this.add.graphics();

    const heading = this.add
      .text(0, 0, 'PAUSED', {
        fontSize: '32px',
        fontFamily: 'Arial',
        color: '#ffd166',
        fontStyle: 'bold',
        stroke: '#0b1a33',
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    // Three distinct destinations, laid out in keyboard order.
    const labels: Phaser.GameObjects.Text[] = [];
    const zones: Phaser.GameObjects.Rectangle[] = [];

    for (const action of PAUSE_ACTIONS) {
      labels.push(
        this.add
          .text(0, 0, PAUSE_LABELS[action], {
            fontSize: '19px',
            fontFamily: 'Arial',
            fontStyle: 'bold',
            color: action === 'resume' ? '#23234a' : '#ffd166',
          })
          .setOrigin(0.5)
      );
      zones.push(this.createPauseZone(action));
    }

    const root = this.add.container(0, 0, [shade, frame, heading, ...zones, ...labels]);
    // Same depth as the results panel and for the same reason: this container is
    // built before the board, so without it the tiles would be drawn over it.
    root.setDepth(RESULT_DEPTH);
    root.setVisible(false);

    this.pauseOverlay = { root, shade, frame, heading, labels, zones };
    this.layoutPauseOverlay();
  }

  /** One pause button's invisible hit area, wired for hover feedback and a click. */
  private createPauseZone(action: PauseAction): Phaser.GameObjects.Rectangle {
    const zone = this.add.rectangle(0, 0, 1, 1, 0x000000, 0);

    zone.setInteractive(new Phaser.Geom.Rectangle(-0.5, -0.5, 1, 1), Phaser.Geom.Rectangle.Contains);

    zone.on(Phaser.Input.Events.POINTER_UP, () => this.activatePauseAction(action));
    zone.on(Phaser.Input.Events.POINTER_OVER, () => {
      this.pauseHover = action;
      this.drawPauseFrame();
    });
    zone.on(Phaser.Input.Events.POINTER_OUT, () => {
      if (this.pauseHover !== action) return;
      this.pauseHover = null;
      this.drawPauseFrame();
    });

    return zone;
  }

  /** Takes whichever pause action the pointer or the keyboard is on. */
  private activatePauseAction(action: PauseAction): void {
    if (action === 'resume') {
      this.resumeGame();

      return;
    }

    this.exitPausedTo(action === 'map' ? 'level-map' : 'menu');
  }

  /**
   * Places every part of the pause overlay for the canvas size right now.
   *
   * Called when the overlay is shown and again on every resize, so a phone
   * rotated while paused still gets a centred panel with reachable buttons.
   */
  private layoutPauseOverlay(): void {
    if (!this.pauseOverlay) return;

    const width = Math.max(1, this.scale.width);
    const height = Math.max(1, this.scale.height);
    const panelW = Math.min(420, Math.max(240, width * 0.86));
    const buttonH = 54;
    const buttonGap = 14;
    const innerX = 26;
    const headingH = 66;
    const padY = 24;
    const panelH = Math.round(
      padY + headingH + PAUSE_ACTIONS.length * buttonH + (PAUSE_ACTIONS.length - 1) * buttonGap + padY
    );
    const panelX = Math.round(width / 2 - panelW / 2);
    const panelY = Math.round(height / 2 - panelH / 2);
    const buttons = PAUSE_ACTIONS.map((_, index) => ({
      x: panelX + innerX,
      y: Math.round(panelY + padY + headingH + index * (buttonH + buttonGap)),
      width: Math.round(panelW - innerX * 2),
      height: buttonH,
    }));

    this.pauseLayout = { panelX, panelY, panelW, panelH, buttons };

    this.pauseOverlay.shade.setDisplaySize(width, height).setPosition(width / 2, height / 2);
    this.pauseOverlay.heading.setPosition(width / 2, panelY + padY + headingH / 2);

    this.pauseOverlay.labels.forEach((label, index) => {
      const button = buttons[index];
      const zone = this.pauseOverlay.zones[index];

      label.setPosition(button.x + button.width / 2, button.y + button.height / 2);
      zone.setPosition(button.x + button.width / 2, button.y + button.height / 2);

      // The hit area Phaser already holds is mutated rather than replaced, so the
      // zone re-aims instead of stacking a second interactive configuration.
      if (zone.input) {
        zone.input.hitArea.setTo(
          -button.width / 2,
          -button.height / 2,
          button.width,
          button.height
        );
      }
    });

    this.drawPauseFrame();
  }

  /**
   * Paints the pause panel and its three buttons.
   *
   * Redrawn rather than re-created, because hover and keyboard focus change one
   * fill and one ring.
   */
  private drawPauseFrame(): void {
    const layout = this.pauseLayout;

    if (!layout || !this.pauseOverlay) return;

    const frame = this.pauseOverlay.frame;

    frame.clear();

    // Drop plate, panel, gold edge, hairline highlight: the results panel's stack.
    frame.fillStyle(0x000000, 0.45);
    frame.fillRoundedRect(layout.panelX + 3, layout.panelY + 6, layout.panelW, layout.panelH, 22);
    frame.fillStyle(0x23234a, 0.98);
    frame.fillRoundedRect(layout.panelX, layout.panelY, layout.panelW, layout.panelH, 20);
    frame.lineStyle(2, 0xffd166, 0.9);
    frame.strokeRoundedRect(layout.panelX, layout.panelY, layout.panelW, layout.panelH, 20);
    frame.lineStyle(1, 0xffffff, 0.14);
    frame.lineBetween(
      layout.panelX + 24,
      layout.panelY + 2,
      layout.panelX + layout.panelW - 24,
      layout.panelY + 2
    );

    layout.buttons.forEach((button, index) => {
      const action = PAUSE_ACTIONS[index];
      const primary = action === 'resume';
      const hovered = this.pauseHover === action;
      let fill = primary ? 0xffd166 : 0x2f2f55;

      if (hovered) fill = primary ? 0xffffff : 0x3f3f6b;

      frame.fillStyle(fill, 1);
      frame.fillRoundedRect(button.x, button.y, button.width, button.height, 12);
      frame.lineStyle(2, 0xffd166, primary ? 1 : 0.5);
      frame.strokeRoundedRect(button.x, button.y, button.width, button.height, 12);
    });

    // Focus ring last so it reads as being in front, and as a ring rather than a
    // colour change, so focus does not depend on one hue being distinguishable.
    const focused = layout.buttons[PAUSE_ACTIONS.indexOf(this.pauseFocus)];
    frame.lineStyle(3, 0xffffff, 1);
    frame.strokeRoundedRect(
      focused.x - 5,
      focused.y - 5,
      focused.width + 10,
      focused.height + 10,
      16
    );
  }

  // ------------------------------------------------------------------ pause

  /**
   * Freezes the attempt and shows the pause overlay.
   *
   * Pausing the tween manager is what stops tiles moving and effects continuing,
   * without touching the board, the score or the move count. The scene itself is
   * not paused, so the overlay's own buttons keep working. Audio is suspended
   * rather than muted, so the player's sound settings survive the pause.
   */
  private pauseGame(): void {
    if (this.paused || this.gameState.status !== 'playing') return;

    this.paused = true;
    this.tweens.pauseAll();
    this.time.paused = true;
    this.audio.suspend();
    this.clearSelection();
    // The panel is asked for its place every time it appears, so a resize that
    // happened behind another screen cannot leave it stranded.
    this.pauseFocus = 'resume';
    this.pauseHover = null;
    this.layoutPauseOverlay();
    this.pauseOverlay.root.setVisible(true);
  }

  /** Unfreezes the attempt and hides the pause overlay. */
  private resumeGame(): void {
    if (!this.paused) return;

    this.paused = false;
    this.pauseHover = null;
    this.pauseOverlay.root.setVisible(false);
    this.tweens.resumeAll();
    this.time.paused = false;
    this.audio.resume();
  }

  /**
   * Highlights a valid move on the board with a golden pulse and sparkle.
   */
  private showHint(): void {
    if (this.paused || !this.gameState.canAcceptInput || !this.board) return;

    const move = findValidMove(this.board);
    if (!move) return;

    const tileA = this.board.getTileAt(move.from.row, move.from.column);
    const tileB = this.board.getTileAt(move.to.row, move.to.column);
    if (!tileA || !tileB) return;

    const visualA = this.tileVisuals.get(tileA.id);
    const visualB = this.tileVisuals.get(tileB.id);
    if (!visualA || !visualB) return;

    this.audio.initialize();
    this.audio.playSelect();
    this.effects.playHintPulse(visualA, visualB);
    this.effects.burst(this.cellX(tileA.column), this.cellY(tileA.row), 0xffd166, 6);
    this.effects.burst(this.cellX(tileB.column), this.cellY(tileB.row), 0xffd166, 6);
  }

  /**
   * Leaves the pause overlay for another screen.
   *
   * The attempt is abandoned, so the pause is lifted before navigating: the shell
   * will put the canvas to sleep, and the next level start clears whatever is left.
   */
  private exitPausedTo(screen: 'level-map' | 'menu'): void {
    if (this.transitioning) return;

    this.transitioning = true;

    try {
      this.resumeGame();

      if (screen === 'level-map') this.bridge.reportExitToMap();
      else this.bridge.reportExitToMenu();
    } finally {
      this.transitioning = false;
    }
  }

  /**
   * The overlay's primary button: carry on playing.
   *
   * Next level and retry both run through runTransition, which is what guarantees
   * the load happens once even if the button is clicked twice: the guard rejects
   * the second call and the overlay is hidden before the new level is built.
   */
  private handleOverlayPrimary(): void {
    if (this.transitioning) return;

    if (this.overlayMode === 'lose') {
      // Retry is the same level with a fresh attempt, so the level index stays put
      // and startLevel is what clears the score, moves and objectives.
      this.levels.restartLevel();
      this.runTransition(() => this.startLevel(this.levels.getCurrentLevel()));
      return;
    }

    if (this.overlayMode === 'win') {
      // requestLevel re-checks the unlock, so a next-level press can never start
      // something the campaign has not earned.
      this.runTransition(() => {
        if (this.levels.nextLevel()) {
          this.requestLevel(this.levels.getCurrentLevel().id);
        }
      });
      return;
    }

    if (this.overlayMode === 'final') {
      this.runTransition(() => {
        this.levels.loadFirstLevel();
        this.requestLevel(this.levels.getCurrentLevel().id);
      });
    }
  }

  /**
   * The overlay's secondary button: back to the level map.
   *
   * Leaves the board and the attempt exactly as they are; returning to a level
   * starts it fresh, which is what the map's PLAY button means.
   */
  private handleOverlaySecondary(): void {
    if (this.transitioning) return;

    this.transitioning = true;

    try {
      this.hideOverlay();
      this.clearSelection();
      this.bridge.reportExitToMap();
    } finally {
      this.transitioning = false;
    }
  }

  /** Runs a level change exactly once, restoring input either way. */
  private runTransition(action: () => void): void {
    if (this.transitioning) return;

    this.transitioning = true;
    this.hideOverlay();
    this.clearSelection();

    try {
      action();
    } finally {
      this.transitioning = false;
    }
  }

  /**
   * Detects a deadlocked board once a turn has finished, and reshuffles it.
   *
   * Detection and repair are deliberately separate: hasValidMove is asked first
   * and only a real "no legal move" answer leads to a shuffle, so a playable
   * board is never disturbed. The search itself lives in MoveFinder, so this
   * method only decides when to run it and what to show while it happens.
   */
  private async ensurePlayableBoard(): Promise<void> {
    if (this.gameState.processing) return;
    if (hasValidMove(this.board)) return;

    console.log('NO VALID MOVES - BOARD DEADLOCKED');

    this.gameState.lock();
    this.showNotice('NO MOVES - SHUFFLING');
    this.updateHud();

    try {
      const result = await this.animateShuffle();
      const move = findValidMove(this.board);

      console.log(
        `SHUFFLE COMPLETE: ${result.attempts} attempt(s), playable=${result.playable}`
      );

      if (move) {
        console.log(`Possible move: (${move.from.row}, ${move.from.column}) -> (${move.to.row}, ${move.to.column})`);
      }
    } catch (error) {
      console.error('SHUFFLE FAILED - board may be deadlocked', error);
    } finally {
      this.hideNotice();
      this.gameState.unlock();
      this.updateHud();
    }
  }

  /**
   * The transient centre-screen message, used for the shuffle notice and for
   * chord announcements. One shared element, because the two never need to be on
   * screen at the same time and a second overlapping label would just be noise.
   */
  private showNotice(message: string): void {
    // A chord announcement may still be animating out when a shuffle starts.
    this.tweens.killTweensOf(this.hudNotice);
    this.hudNotice.setText(message);
    this.hudNotice.setColor(NOTICE_COLOR);
    this.hudNotice.setScale(1);
    this.hudNotice.setAlpha(1);
    this.hudNotice.setVisible(true);
  }

  private hideNotice(): void {
    this.tweens.killTweensOf(this.hudNotice);
    this.hudNotice.setText('');
    this.hudNotice.setScale(1);
    this.hudNotice.setVisible(false);
  }

  /**
   * Announces a chord: name, chain position and points, popped in and faded back
   * out on the existing notice label.
   *
   * The label is reused rather than recreated, and the three tweens are killed
   * before new ones start, so a fast cascade can retarget one object instead of
   * stacking up copies of itself. The colour comes from CHORD_STYLES, which is
   * what makes a diminished chord read as different from a major one.
   */
  private announceChord(result: ChordComboResult): void {
    if (result.chord === null) return;

    const style = CHORD_EFFECT_STYLES[result.chord.quality] ?? DEFAULT_CHORD_STYLE;
    const lines = [
      chordLabel(result.chord).toUpperCase(),
      // The chain line only appears once there is a chain to talk about.
      result.comboCount >= 2 ? `CHORD COMBO x${result.multiplier}` : '',
      `+${result.bonus}`,
    ].filter((line) => line !== '');

    this.tweens.killTweensOf(this.hudNotice);
    this.hudNotice.setText(lines.join('\n'));
    this.hudNotice.setColor(style.cssColor);
    this.hudNotice.setScale(0.6);
    this.hudNotice.setAlpha(0);
    this.hudNotice.setVisible(true);

    // The burst sits under the label, in the chord's own colour, so the announcement
    // and the particles read as one event rather than two things happening at once.
    this.effects.playChordBurst(this.hudNotice.x, this.hudNotice.y, style);

    // Pop in, hold long enough to read, then fade out. The deltas keep this to
    // three tweens with no timers, all of which hideNotice can cancel at once.
    this.tweens.add({
      targets: this.hudNotice,
      scale: 1,
      alpha: 1,
      duration: style.popDuration,
      ease: 'Back.easeOut',
    });
    this.tweens.add({
      targets: this.hudNotice,
      alpha: 1,
      scale: 1,
      duration: CHORD_HOLD_DURATION,
      delay: style.popDuration,
    });
    this.tweens.add({
      targets: this.hudNotice,
      alpha: 0,
      duration: CHORD_FADE_DURATION,
      delay: style.popDuration + CHORD_HOLD_DURATION,
      onComplete: () => {
        // Leave the label at a clean rest state for whoever uses it next.
        this.hudNotice.setAlpha(1).setScale(1);
      },
    });
  }

  /**
   * Fades the board out, reshuffles, then fades it back in.
   *
   * Tiles keep their identity and their cells across a shuffle, so nothing has
   * to be repositioned: the notes simply change underneath the same containers.
   * That keeps the whole effect to two tweens and one re-render.
   */
  private async animateShuffle(): Promise<ShuffleResult> {
    await this.fadeAllTiles(0);

    try {
      const result = shuffleBoard(this.board);
      this.syncAllTileVisuals();

      return result;
    } finally {
      // Always bring the tiles back, even if the shuffle threw, so the board
      // can never be left invisible.
      await this.fadeAllTiles(1);
    }
  }

  private syncAllTileVisuals(): void {
    for (const visual of Array.from(this.tileVisuals.values())) {
      this.syncVisual(visual);
    }
  }

  /** Scales and fades every tile towards fully visible or fully hidden. */
  private fadeAllTiles(target: 0 | 1): Promise<void> {
    const hidden = target === 0;

    const animations = Array.from(this.tileVisuals.values()).map(
      (visual) =>
        new Promise<void>((resolve) => {
          this.tweens.add({
            targets: visual.container,
            scale: hidden ? 0 : 1,
            alpha: hidden ? 0 : 1,
            duration: SHUFFLE_FADE_DURATION,
            ease: hidden ? 'Quad.easeIn' : 'Quad.easeOut',
            onComplete: () => {
              // Land on the exact end state so values never drift.
              visual.container.setScale(hidden ? 0 : 1);
              visual.container.setAlpha(hidden ? 0 : 1);
              resolve();
            },
          });
        })
    );

    return Promise.all(animations).then(() => undefined);
  }

  /** Bridges the Phaser-free CascadeEngine to this scene's visuals and state. */
  private createPresenter(): CascadePresenter {
    return {
      log: (message: string) => console.log(message),

      onStage: (stage: StagePlan, depth: number) => {
        // Cascade level and scoring both come from the engine's depth counter,
        // so the combo shown on the HUD can never disagree with the points.
        this.gameState.setCascade(depth);

        // Cascade feedback. Depth 1 is an ordinary match and gets no cascade
        // treatment; from depth 2 up the label and the intensity climb.
        const cascadeText = cascadeLabel(depth);

        if (cascadeText !== '') {
          this.effects.playCascade(depth, cascadeText);
          if (depth >= 3) {
            this.effects.pulseBoard(this.tileContainers());
          }
        }

        // Special tiles were written to the data before this hook ran, so the
        // new special tile is on screen before the rest of its run is removed.
        for (const special of stage.specials) {
          const visual = this.tileVisuals.get(special.tile.id);
          if (visual) this.syncVisual(visual);
        }

        // Musical analysis of the notes this stage is about to clear.
        // Feeds cleared notes into the progressive ChordBuilder so matching
        // triad tones across consecutive moves or cascade stages voices a chord.
        const stageNotes = stage.removals.map((tile) => tile.noteType);
        const analysis = this.chordBuilder.ingestStageNotes(stageNotes);
        const combo = this.chordCombo.processChord(analysis.chord, analysis.notes);

        if (combo.chord === null) {
          console.log(`VOICES COLLECTED: ${analysis.notes.join(' ') || 'none'}`);
        } else {
          console.log(
            `CHORD DETECTED: ${chordLabel(combo.chord)} chain=${combo.comboCount} x${combo.multiplier} +${combo.bonus}`
          );
          this.announceChord(combo);
        }

        // Level objectives are counted here and only here. This hook runs inside a
        // real cascade caused by a player swap: board generation, shuffling and
        // every MoveFinder simulation never reach it, so none of them can inflate
        // a target.
        if (combo.chord !== null) this.gameState.addChord();
        if (stage.specials.length > 0) {
          this.gameState.addSpecialTile(stage.specials.length);
        }

        // Audio is emitted once per stage, never per tile, so a nine-stage
        // cascade stays audible instead of turning into a wall of noise.
        this.audio.playMatchedNotes(stageNotes);
        this.audio.playCascade(combo.comboCount >= 2 ? combo.comboCount : depth);

        if (combo.chord !== null) {
          // Play the triad itself, not a chord effect: those pitches really were
          // on the board when the stage cleared.
          this.audio.playChord(combo.chord.notes);

          // The burst sits under the announcement, in the chord's own colour, so the
          // label and the particles read as one event.
          this.effects.playChordBurst(
            this.scale.width / 2,
            this.boardCenterY,
            this.effects.chordStyleFor(combo.chord.quality)
          );
        }

        // Only the stages that changed the board's rules get the special cue.
        if (stage.specials.length > 0 || stage.activation !== null) {
          this.audio.playSpecial();
        }

        // Special tile presentation. The activation logic is untouched; this is only
        // how the event looks and feels.
        if (stage.activation === 'line-clear') {
          this.playLineClearEffect(stage.removals);
        } else if (stage.activation === 'color-bomb') {
          const center = this.centroid(stage.removals);

          this.effects.playRadialBurst(center.x, center.y);
          this.effects.shake(IMPACT.colorBomb.duration, IMPACT.colorBomb.intensity);
        }

        // The removal chime is reserved for a large clear, which is when a
        // whole line or colour actually disappeared.
        if (stage.removals.length >= LARGE_CLEAR_TILE_COUNT) {
          this.audio.playRemove();
        }

        // Four separate components, and the stage's removals are already
        // de-duplicated by SpecialTileEngine, so no tile can score twice.
        const tilePoints = calculateMatchScore(stage.removals.length, depth);
        const creationPoints = calculateSpecialCreationBonus(stage.specials.length);
        const activationPoints = calculateActivationBonus(stage.activation);
        // The chord is added on top of the tile score, never instead of it: the
        // tiles pay once, through calculateMatchScore.
        const points = tilePoints + creationPoints + activationPoints + combo.bonus;

        this.gameState.addScore(points);
        this.updateHud();

        // One popup per stage, at the centre of what was cleared, so a big clear reads
        // as a single reward rather than a dozen competing numbers.
        if (points > 0 && stage.removals.length > 0) {
          const popupAt = this.centroid(stage.removals);

          this.effects.showScorePopup(popupAt.x, popupAt.y, points);
        }

        const breakdown = [
          `${stage.removals.length} tiles at x${depth} = ${tilePoints}`,
          creationPoints > 0 ? `special creation +${creationPoints}` : null,
          activationPoints > 0 ? `activation +${activationPoints}` : null,
          combo.chord === null ? null : `chord ${chordLabel(combo.chord)} +${combo.bonus}`,
        ]
          .filter((part): part is string => part !== null)
          .join(', ');

        console.log(`SCORE +${points} (${breakdown}) -> total ${this.gameState.score}`);
      },

      animateRemoval: (tiles: Tile[]) => this.animateRemoval(tiles),
      animateGravity: (falls: TileFall[]) => this.animateGravity(falls),
      animateRefill: (created: RefilledTile[]) => this.animateRefill(created),
    };
  }

  /**
   * Wraps a single Phaser tween in a promise that resolves on completion, so
   * the cascade can await animations instead of using setTimeout.
   */
  private tweenContainer(
    container: Phaser.GameObjects.Container,
    x: number,
    y: number,
    duration: number,
    ease: string
  ): Promise<void> {
    return new Promise((resolve) => {
      this.tweens.add({
        targets: container,
        x,
        y,
        duration,
        ease,
        onComplete: () => {
          // Land exactly on the target cell so positions never drift.
          container.setPosition(x, y);
          resolve();
        },
      });
    });
  }

  /**
   * Pops matched tiles: swell, burst, collapse, fade. Resolves when all are gone.
   *
   * Every tile gets the pop, but only the first few get a particle burst. A stage can
   * clear a whole line, and a burst per tile would mean dozens of emitters firing at
   * once; capping the bursts keeps the count flat however big the clear is.
   */
  private animateRemoval(tiles: Tile[]): Promise<void> {
    const burstCount = Math.min(tiles.length, MATCH_POP.maxBurstsPerStage);

    // Subtle highlight on all matched tiles before removal - a quick "glow" to
    // signal "these tiles are about to go"
    for (const tile of tiles) {
      const visual = this.tileVisuals.get(tile.id);
      if (visual) {
        this.effects.playMatchHighlight(visual);
      }
    }

    // Small delay to let the highlight be visible before removal starts. Wrapped
    // in a promise because the cascade awaits this stage like every other one.
    return new Promise<void>((resolve) => {
      this.time.delayedCall(100, () => {
        const burstCount = Math.min(tiles.length, MATCH_POP.maxBurstsPerStage);

        const animations = tiles.map((tile, index) => {
          const visual = this.tileVisuals.get(tile.id);
          if (!visual) return Promise.resolve();

          if (index < burstCount) {
            this.effects.playMatchBurst(this.cellX(tile.column), this.cellY(tile.row), NOTE_COLORS[tile.noteType]);
          }

          return new Promise<void>((done) => {
            this.effects.playMatchPop(visual, () => {
              this.tileVisuals.delete(visual.tile.id);
              // Destroying the container also destroys its face and text children.
              visual.container.destroy();
              done();
            });
          });
        });

        Promise.all(animations).then(() => resolve());
      });
    });
  }

  /**
   * Moves the containers of tiles that fell. The board has already been updated
   * by GravityEngine, so each fall record supplies both the old and new cell.
   */
  private animateGravity(falls: TileFall[]): Promise<void> {
    const animations = falls.map((fall) => {
      const visual = this.tileVisuals.get(fall.tile.id);
      if (!visual) return Promise.resolve();

      // Add a slight bounce at the end for physical feel
      return this.tweenContainer(
        visual.container,
        this.cellX(fall.toColumn),
        this.cellY(fall.toRow),
        GRAVITY_DURATION,
        'Bounce.easeOut'
      );
    });

    return Promise.all(animations).then(() => undefined);
  }

  /**
   * Creates a visual for each new tile above the board and drops it into place.
   * Tiles in a column start at increasing heights so the refill reads as a
   * stream entering from off-screen rather than a single pop.
   */
  private animateRefill(created: RefilledTile[]): Promise<void> {
    // Group by column for staggered entry
    const byColumn = new Map<number, RefilledTile[]>();
    for (const ct of created) {
      const arr = byColumn.get(ct.tile.column) ?? [];
      arr.push(ct);
      byColumn.set(ct.tile.column, arr);
    }

    const animations: Promise<void>[] = [];

    for (const [, columnTiles] of byColumn) {
      // Sort by row (top to bottom)
      columnTiles.sort((a, b) => a.row - b.row);

      columnTiles.forEach(({ tile, row }, index) => {
        const visual = this.createTileVisual(tile);

        visual.container.y = this.cellY(0) - (row + 1) * this.tileSize;
        // Stagger the start of each tile in the column
        const delay = index * 40;

        const tween = this.tweens.add({
          targets: visual.container,
          y: this.cellY(row),
          x: this.cellX(tile.column),
          duration: REFILL_DURATION,
          delay,
          ease: 'Bounce.easeOut',
          onComplete: () => {
            visual.container.setPosition(this.cellX(tile.column), this.cellY(row));
          },
        });

        animations.push(new Promise<void>((resolve) => {
          tween.on('complete', () => resolve());
        }));
      });
    }

    return Promise.all(animations).then(() => undefined);
  }

  /**
   * The centre of a set of tiles, in world coordinates.
   *
   * Used to place a single popup or burst for a whole stage, so the effect lands
   * where the player was looking rather than at some arbitrary corner.
   */
  private centroid(removals: Tile[]): Point {
    const x = removals.reduce((sum, tile) => sum + this.cellX(tile.column), 0) / removals.length;
    const y = removals.reduce((sum, tile) => sum + this.cellY(tile.row), 0) / removals.length;

    return { x, y };
  }

  /** The live tile containers, for board-wide effects. */
  private tileContainers(): Phaser.GameObjects.Container[] {
    return Array.from(this.tileVisuals.values()).map((visual) => visual.container);
  }

  /**
   * Works out which row or column a line clear swept, and shows it.
   *
   * The removals are the tiles the line cleared, so they all share a row (a
   * horizontal clear) or a column (a vertical one). The sweep is drawn across the
   * full board either way, so it reads as a line crossing the grid rather than a
   * highlight of the few cells that happened to be cleared.
   */
  private playLineClearEffect(removals: Tile[]): void {
    if (removals.length === 0) return;

    const rows = new Set(removals.map((tile) => tile.row));
    const columns = new Set(removals.map((tile) => tile.column));

    if (rows.size === 1) {
      const row = removals[0].row;

      this.effects.playLineSweep(
        this.cellX(0),
        this.cellY(row),
        this.cellX(this.boardColumns - 1),
        this.cellY(row)
      );
    } else if (columns.size === 1) {
      const column = removals[0].column;

      this.effects.playLineSweep(
        this.cellX(column),
        this.cellY(0),
        this.cellX(column),
        this.cellY(this.boardRows - 1)
      );
    }

    this.effects.shake(IMPACT.lineClear.duration, IMPACT.lineClear.intensity);
  }

  private animateSwap(
    visualA: TileVisual,
    visualB: TileVisual,
    onComplete: () => void
  ): void {
    const tileA = visualA.tile;
    const tileB = visualB.tile;

    this.tweens.add({
      targets: visualA.container,
      x: this.cellX(tileB.column),
      y: this.cellY(tileB.row),
      duration: SWAP_DURATION,
      ease: 'Quad.easeInOut',
    });

    this.tweens.add({
      targets: visualB.container,
      x: this.cellX(tileA.column),
      y: this.cellY(tileA.row),
      duration: SWAP_DURATION,
      ease: 'Quad.easeInOut',
      onComplete: () => {
        visualA.container.setPosition(this.cellX(tileA.column), this.cellY(tileA.row));
        visualB.container.setPosition(this.cellX(tileB.column), this.cellY(tileB.row));
        onComplete();
      },
    });
  }
}