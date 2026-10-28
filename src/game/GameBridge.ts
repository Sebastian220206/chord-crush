/**
 * The channel between the React shell and the Phaser game.
 *
 * The project already had exactly one cross-boundary idea: AudioManager is a
 * shared singleton both sides hold. This follows that pattern rather than
 * inventing a second one, because what was missing was not a mechanism but a
 * vocabulary. Two rules keep it honest:
 *
 * - No state lives here. The bridge carries requests and events; the campaign
 *   lives in ProgressionManager and the attempt lives in GameState. If the bridge
 *   remembered "the current level", the two would be free to disagree.
 * - Phaser is described structurally rather than imported, so neither side
 *   reaches into the other's objects. React never touches a scene, and the scene
 *   never touches the DOM.
 *
 * Flow, both directions:
 *
 *   React level map --playLevel(id)--> GameScene --reportLevelCompleted--> React
 *
 * React screen state is owned by React, because the screen is a UI fact. Phaser
 * is told about it so it can stop drawing frames nobody can see.
 */

/** The screens the app has. Deliberately not a router. */
export type Screen = 'menu' | 'level-map' | 'game';

/** The one thing worth reporting about a finished attempt. */
export interface LevelResult {
  levelId: number;
  score: number;
  /** Swaps spent, which is the move limit minus what was left. */
  movesUsed: number;
}

type ScreenListener = (screen: Screen) => void;
type ResultListener = (result: LevelResult) => void;
type PlayRequestListener = (levelId: number) => void;
type PauseRequestListener = () => void;
type HintRequestListener = () => void;

/**
 * The slice of Phaser.Game the bridge needs: the RAF loop, so a hidden canvas
 * stops burning frames. Structural rather than imported to keep this file free of
 * Phaser and runnable outside a browser.
 */
export interface GameLoopHost {
  loop: { sleep(): void; wake(): void };
}

export class GameBridge {
  private screen: Screen = 'menu';
  private host: GameLoopHost | null = null;

  /**
   * A level asked for before the scene was listening.
   *
   * Without this, a player who clicked PLAY during the boot frames would have
   * their request silently dropped, because GameScene subscribes in create().
   */
  private queuedLevelId: number | null = null;

  private playRequestListeners = new Set<PlayRequestListener>();
  private pauseRequestListeners = new Set<PauseRequestListener>();
  private hintRequestListeners = new Set<HintRequestListener>();
  private screenListeners = new Set<ScreenListener>();
  private resultListeners = new Set<ResultListener>();

  // ------------------------------------------------------------ React -> Phaser

  /**
   * Hands over the running game. Called by React after it creates it, and again
   * with null when the game is destroyed.
   */
  attachGame(host: GameLoopHost | null): void {
    this.host = host;
    this.applyLoopState();
  }

  /**
   * The one way to change screen.
   *
   * Every navigation goes through here, so a button can never set the screen and
   * forget to stop the render loop, or stop the loop and forget to tell the scene.
   * The screen itself is React's to own; this only moves Phaser in step with it.
   */
  navigate(screen: Screen): void {
    this.setScreen(screen);
  }

  /**
   * Asks Phaser to play a level.
   *
   * The map only names the level: generating the board, resetting GameState and
   * refilling the HUD all stay in GameScene, so there is exactly one place where a
   * level is loaded. The return value says whether the request was dispatched or
   * queued, not whether it succeeded; refusing a locked level is GameScene's
   * decision, since only it knows the full rule.
   */
  playLevel(levelId: number): boolean {
    if (!Number.isInteger(levelId) || levelId <= 0) return false;

    this.navigate('game');

    if (this.playRequestListeners.size === 0) {
      this.queuedLevelId = levelId;

      return false;
    }

    this.queuedLevelId = null;

    // forEach rather than for...of: the project targets es5, where iterating a Set
    // directly needs a compiler flag the rest of the codebase does not use.
    this.playRequestListeners.forEach((listener) => listener(levelId));

    return true;
  }

  /** Shows the level map and stops the hidden canvas from drawing. */
  showLevelMap(): void {
    this.navigate('level-map');
  }

  /** Shows the main menu. */
  showMenu(): void {
    this.navigate('menu');
  }

  /**
   * Asks Phaser to pause the current attempt.
   *
   * The shell only asks; the scene decides whether a pause is possible right now,
   * since only it knows whether a cascade is mid-flight.
   */
  requestPause(): void {
    this.pauseRequestListeners.forEach((listener) => listener());
  }

  /** Asks Phaser to highlight a valid move on the current board. */
  requestHint(): void {
    this.hintRequestListeners.forEach((listener) => listener());
  }

  getScreen(): Screen {
    return this.screen;
  }

  onScreenChange(listener: ScreenListener): () => void {
    this.screenListeners.add(listener);

    return () => {
      this.screenListeners.delete(listener);
    };
  }

  /** Fires when a level is finished, so the map can refresh on return. */
  onLevelCompleted(listener: ResultListener): () => void {
    this.resultListeners.add(listener);

    return () => {
      this.resultListeners.delete(listener);
    };
  }

  // ------------------------------------------------------------ Phaser -> React

  /**
   * Subscribes the scene to level requests.
   *
   * Any request that arrived before the scene existed is delivered immediately,
   * which is what makes a click during the loading frames reliable.
   */
  onPlayLevelRequest(listener: PlayRequestListener): () => void {
    this.playRequestListeners.add(listener);

    if (this.queuedLevelId !== null) {
      const levelId = this.queuedLevelId;

      this.queuedLevelId = null;
      listener(levelId);
    }

    return () => {
      this.playRequestListeners.delete(listener);
    };
  }

  /** Subscribes the scene to pause requests. */
  onPauseRequest(listener: PauseRequestListener): () => void {
    this.pauseRequestListeners.add(listener);

    return () => {
      this.pauseRequestListeners.delete(listener);
    };
  }

  /** Subscribes the scene to hint requests from the shell dock. */
  onHintRequest(listener: HintRequestListener): () => void {
    this.hintRequestListeners.add(listener);

    return () => {
      this.hintRequestListeners.delete(listener);
    };
  }

  /** The scene reports a win. Carries no state, only the facts. */
  reportLevelCompleted(result: LevelResult): void {
    this.resultListeners.forEach((listener) => listener(result));
  }

  /** The scene asks for the map, e.g. the player pressed LEVEL MAP. */
  reportExitToMap(): void {
    this.showLevelMap();
  }

  /** The scene asks for the main menu. */
  reportExitToMenu(): void {
    this.showMenu();
  }

  // ------------------------------------------------------------ internals

  private setScreen(screen: Screen): void {
    if (this.screen === screen) {
      // Still sync the loop: attaching a fresh game needs the current screen.
      this.applyLoopState();

      return;
    }

    this.screen = screen;
    this.applyLoopState();

    this.screenListeners.forEach((listener) => listener(screen));
  }

  /**
   * Matches the loop to the screen.
   *
   * Phaser keeps animating a canvas nobody can see otherwise, which is a real
   * battery cost on a map screen full of DOM.
   */
  private applyLoopState(): void {
    if (this.host === null) return;

    if (this.screen === 'game') {
      this.host.loop.wake();

      return;
    }

    this.host.loop.sleep();
  }
}

let shared: GameBridge | null = null;

/** The game's single bridge. */
export function getGameBridge(): GameBridge {
  if (shared === null) shared = new GameBridge();

  return shared;
}