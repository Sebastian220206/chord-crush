import { chordComboMultiplier, applyChordCombo, calculateChordBonus } from '../mechanics/ScoreEngine';
import type { Chord } from './Chord';
import { uniqueNotes } from './Note';
import type { NoteName } from './Note';

/**
 * What one cascade stage's notes produced: the chord, the chain position it
 * landed at, and the points that chain position is worth.
 *
 * This is the hand-off from ChordEngine to everything else. It is deliberately
 * inert: no Phaser, no AudioManager, no game state. The orchestration reads it,
 * scores it, plays it and shows it, which is what keeps each of those out of the
 * pure music layer.
 */
export interface ChordComboResult {
  /** The chord that formed, or null when the notes did not form one. */
  chord: Chord | null;
  /** The distinct notes that were analysed, in pitch order. */
  notes: NoteName[];
  /** True only when this stage actually formed a chord. */
  detected: boolean;
  /** Chords detected so far in the current move, including this one. */
  comboCount: number;
  /** Chain multiplier applied to the base bonus, capped at x5. */
  multiplier: number;
  /** Bonus before the multiplier, which is 0 when no chord formed. */
  baseBonus: number;
  /** Points to award for this chord. 0 when no chord formed. */
  bonus: number;
}

/**
 * Tracks consecutive chords within a single player move.
 *
 * ChordEngine decides *what* the notes are; this decides *what that is worth*.
 * It owns exactly one piece of state, the chain length, and owns it for the
 * duration of a move: the caller resets it when a new move begins and lets it
 * grow through that move's cascade.
 *
 * A stage that forms no chord is not a break in the chain. The chain counts
 * chord detections, not stages, so clearing an unmusical run in the middle of a
 * cascade does not throw away the combo the player has already earned.
 */
export class ChordComboEngine {
  private count = 0;

  /**
   * Starts a new move. Called when a valid swap begins a turn, never during the
   * cascade that follows it.
   */
  reset(): void {
    this.count = 0;
  }

  /** Chords detected so far in the current move. */
  getComboCount(): number {
    return this.count;
  }

  /** Multiplier the next chord would be paid at, or 0 while the chain is empty. */
  getMultiplier(): number {
    return this.count === 0 ? 0 : chordComboMultiplier(this.count);
  }

  /**
   * Records one stage's chord and reports what it is worth.
   *
   * `chord` comes from ChordEngine, so nothing here decides whether the notes
   * were musical. A null chord leaves the chain exactly where it was and awards
   * nothing, which is what keeps a plain match playing normally.
   */
  processChord(chord: Chord | null, notes: readonly NoteName[]): ChordComboResult {
    const analysed = uniqueNotes(notes);

    if (chord === null) {
      return {
        chord: null,
        notes: analysed,
        detected: false,
        comboCount: this.count,
        multiplier: this.getMultiplier(),
        baseBonus: 0,
        bonus: 0,
      };
    }

    this.count++;

    const multiplier = chordComboMultiplier(this.count);
    const baseBonus = calculateChordBonus(chord);

    return {
      chord,
      notes: analysed,
      detected: true,
      comboCount: this.count,
      multiplier,
      baseBonus,
      bonus: applyChordCombo(baseBonus, this.count),
    };
  }
}
