/**
 * The single authoritative game state.
 *
 * Score, moves, cascade level, level objectives and the processing lock all live
 * here so there is exactly one source of truth. The Phaser HUD only reads from
 * this object, and nothing else keeps a parallel copy. Deliberately
 * dependency-free: no Phaser, no React, no state-management library, and no
 * Level either, so the level list can change without touching this file.
 */

/** Where the current attempt stands. */
export type GameStatus = 'playing' | 'won' | 'lost';

export interface GameStateSnapshot {
  readonly score: number;
  /** Swaps spent in this level. */
  readonly moves: number;
  readonly moveLimit: number;
  readonly movesRemaining: number;
  /** Cascade level of the turn in progress, or 0 when no turn is active. */
  readonly cascade: number;
  /** True while tiles are animating and input must be ignored. */
  readonly processing: boolean;
  readonly status: GameStatus;
  readonly chordsCompleted: number;
  readonly specialTilesCompleted: number;
}

export class GameState {
  private _score = 0;
  private _moves = 0;
  private _moveLimit = 0;
  private _cascade = 0;
  private _processing = false;
  private _status: GameStatus = 'playing';
  private _chordsCompleted = 0;
  private _specialTilesCompleted = 0;

  get score(): number {
    return this._score;
  }

  get moves(): number {
    return this._moves;
  }

  get moveLimit(): number {
    return this._moveLimit;
  }

  /** Swaps still available, never negative. */
  get movesRemaining(): number {
    return Math.max(0, this._moveLimit - this._moves);
  }

  get cascade(): number {
    return this._cascade;
  }

  /** Input lock. While true the player cannot select or swap. */
  get processing(): boolean {
    return this._processing;
  }

  get status(): GameStatus {
    return this._status;
  }

  get chordsCompleted(): number {
    return this._chordsCompleted;
  }

  get specialTilesCompleted(): number {
    return this._specialTilesCompleted;
  }

  /**
   * The one flag the scene asks before touching the board.
   *
   * Folding status, the animation lock and the move count into a single answer is
   * what stops the scene from growing a second, competing "can I play?" flag: a
   * won or lost level, a running cascade and an exhausted move list all report
   * false here.
   */
  get canAcceptInput(): boolean {
    return this._status === 'playing' && !this._processing && this.movesRemaining > 0;
  }

  /**
   * Combo multiplier to display. Only non-zero while a turn is actually being
   * processed, which keeps a stale multiplier from ever leaking into the HUD
   * between turns.
   */
  get comboLevel(): number {
    return this._processing ? this._cascade : 0;
  }

  getSnapshot(): GameStateSnapshot {
    return {
      score: this._score,
      moves: this._moves,
      moveLimit: this._moveLimit,
      movesRemaining: this.movesRemaining,
      cascade: this._cascade,
      processing: this._processing,
      status: this._status,
      chordsCompleted: this._chordsCompleted,
      specialTilesCompleted: this._specialTilesCompleted,
    };
  }

  /** Locks input without starting a scored turn. Used for swap animations. */
  lock(): void {
    this._processing = true;
  }

  unlock(): void {
    this._processing = false;
    this._cascade = 0;
  }

  /**
   * Starts a scored turn: locks input and resets the combo to x1. Called once
   * per successful player swap, never per cascade stage.
   */
  beginTurn(): void {
    this._processing = true;
    this._cascade = 1;
  }

  /**
   * Sets the combo level for the current cascade stage.
   *
   * The cascade engine owns the depth counter, so this mirrors it rather than
   * incrementing locally. Two independent counters could drift apart; one
   * cannot.
   */
  setCascade(level: number): void {
    this._cascade = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  }

  /** Ends the turn, clears the combo and releases the input lock. */
  endTurn(): void {
    this.unlock();
  }

  /**
   * Consumes one move. Only ever called for a swap that actually produced a
   * match, so invalid swaps never cost the player anything. Cascades, special
   * activations, shuffles and every board simulation leave this alone.
   */
  addMove(): void {
    this._moves = this._moves + 1;
  }

  /** Adds points, ignoring non-positive or non-finite input. */
  addScore(points: number): void {
    if (!Number.isFinite(points) || points <= 0) return;

    this._score = this._score + Math.floor(points);
  }

  /**
   * Counts a chord formed in real play.
   *
   * Only the cascade presenter calls this, which is why generation, shuffling and
   * MoveFinder simulations cannot inflate a level objective: none of them run a
   * cascade.
   */
  addChord(count: number = 1): void {
    if (!Number.isFinite(count) || count <= 0) return;

    this._chordsCompleted = this._chordsCompleted + Math.floor(count);
  }

  /**
   * Counts special tiles the player actually created.
   *
   * SpecialTileEngine still decides when a tile is promoted; this only records the
   * outcome that already happened.
   */
  addSpecialTile(count: number = 1): void {
    if (!Number.isFinite(count) || count <= 0) return;

    this._specialTilesCompleted = this._specialTilesCompleted + Math.floor(count);
  }

  /**
   * Records the end of a level attempt.
   *
   * Returns false when the level had already finished, so a second win or lose
   * check cannot overwrite the first. That, plus the status check in
   * canAcceptInput, is what makes the end-of-level transition happen exactly once
   * even if it is evaluated from more than one place.
   */
  finish(status: 'won' | 'lost'): boolean {
    if (this._status !== 'playing') return false;

    this._status = status;

    return true;
  }

  /**
   * Clears everything for a new attempt.
   *
   * A retry and a fresh level both land here, so neither can inherit the previous
   * board's score, move count or objective progress.
   */
  reset(): void {
    this._score = 0;
    this._moves = 0;
    this._moveLimit = 0;
    this._cascade = 0;
    this._processing = false;
    this._status = 'playing';
    this._chordsCompleted = 0;
    this._specialTilesCompleted = 0;
  }

  /**
   * Resets everything and installs the move limit for the level about to start.
   *
   * Clearing the status here is what lets a won or lost level be replayed.
   */
  startLevel(moveLimit: number): void {
    this.reset();

    this._moveLimit =
      Number.isFinite(moveLimit) && moveLimit > 0 ? Math.floor(moveLimit) : 0;
  }
}
