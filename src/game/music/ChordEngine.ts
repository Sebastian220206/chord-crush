import { CHORD_DICTIONARY, chordKey } from './Chord';
import type { Chord } from './Chord';
import { uniqueNotes } from './Note';
import type { NoteName } from './Note';

/**
 * The result of analysing a group of notes.
 *
 * Small on purpose: the group that was analysed and the chord it formed, if any.
 * No event bus, no subscription model, nothing to unsubscribe.
 */
export interface ChordDetectionResult {
  chord: Chord | null;
  /** The distinct notes that were analysed, in pitch order. */
  notes: NoteName[];
}

/** An exact three-note lookup, ignoring order and duplicates. */
function lookupTriad(notes: readonly NoteName[]): Chord | null {
  const key = chordKey(notes);

  for (const chord of CHORD_DICTIONARY) {
    if (chordKey(chord.notes) === key) return chord;
  }

  return null;
}

/**
 * Analyses a group of more than three distinct notes.
 *
 * A large cascade can easily clear notes from several triads at once, so every
 * three-note combination is checked. A chord is only reported when exactly one
 * supported triad is present: with two candidates the answer would be a guess,
 * and a false chord is worse than no chord.
 */
function detectFromLargerSet(notes: readonly NoteName[]): Chord | null {
  const found = new Map<string, Chord>();

  for (let a = 0; a < notes.length; a++) {
    for (let b = a + 1; b < notes.length; b++) {
      for (let c = b + 1; c < notes.length; c++) {
        const chord = lookupTriad([notes[a], notes[b], notes[c]]);
        if (chord) found.set(chordKey(chord.notes), chord);
      }
    }
  }

  const candidates = Array.from(found.values());

  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Identifies the chord formed by a group of notes, or null when there is none.
 *
 * Order and duplicates are irrelevant: the notes are reduced to distinct pitch
 * classes first, so E G C and C C E G are both C major. Nothing outside the
 * seven natural notes is understood, and anything that is not one of the
 * supported triads returns null rather than a near miss.
 */
export function detectChord(notes: readonly NoteName[]): Chord | null {
  const unique = uniqueNotes(notes);

  if (unique.length < 3) return null;
  if (unique.length === 3) return lookupTriad(unique);

  return detectFromLargerSet(unique);
}

/** detectChord plus the analysed notes, for logging and the HUD. */
export function analyzeChord(notes: readonly NoteName[]): ChordDetectionResult {
  const unique = uniqueNotes(notes);

  return { chord: detectChord(unique), notes: unique };
}

/**
 * Returns true when two distinct notes belong to at least one triad in CHORD_DICTIONARY.
 */
export function canFormTriadPair(noteA: NoteName, noteB: NoteName): boolean {
  if (noteA === noteB) return false;

  return CHORD_DICTIONARY.some(
    (chord) => chord.notes.indexOf(noteA) !== -1 && chord.notes.indexOf(noteB) !== -1
  );
}

/**
 * Given 1 or 2 collected notes, returns the distinct candidate notes that would
 * complete (or progress toward) a valid triad in CHORD_DICTIONARY.
 */
export function findCompletingNotes(collected: readonly NoteName[]): NoteName[] {
  const unique = uniqueNotes(collected);
  if (unique.length === 0 || unique.length >= 3) return [];

  const candidates: NoteName[] = [];

  for (const chord of CHORD_DICTIONARY) {
    const matchesAll = unique.every((n) => chord.notes.indexOf(n) !== -1);
    if (!matchesAll) continue;

    for (const note of chord.notes) {
      if (unique.indexOf(note) === -1 && candidates.indexOf(note) === -1) {
        candidates.push(note);
      }
    }
  }

  return uniqueNotes(candidates);
}

/**
 * Progressive Chord Builder for Match-3 gameplay.
 *
 * Because a standard 3-match clears three tiles of the same note (e.g. C-C-C),
 * a single match normally yields only one distinct pitch class. ChordBuilder
 * collects distinct matched notes across stages and moves until a 3-note triad
 * from CHORD_DICTIONARY is completed:
 *
 * - Empty []: first matched note N1 sets the root/first voice [N1].
 * - 1 note [N1]: if the next matched note N2 shares a triad with N1, the builder
 *   advances to [N1, N2]; otherwise it pivots to [N2] so the player is never stuck
 *   with two incompatible notes (like C and D).
 * - 2 notes [N1, N2]: matching any completing 3rd note forms the triad and resets
 *   the builder. Matching an unrelated note during a setup move preserves [N1, N2]
 *   so the player never loses their 2/3 chord progress.
 */
export class ChordBuilder {
  private collected: NoteName[] = [];

  reset(): void {
    this.collected = [];
  }

  getNotes(): NoteName[] {
    return this.collected.slice();
  }

  getNeededNotes(): NoteName[] {
    return findCompletingNotes(this.collected);
  }

  /**
   * Feeds the notes cleared in one cascade stage into the builder.
   * If the stage itself cleared a complete triad, or if the new notes complete
   * the builder's triad, returns the completed ChordDetectionResult.
   */
  ingestStageNotes(stageNotes: readonly NoteName[]): ChordDetectionResult {
    const uniqueStage = uniqueNotes(stageNotes);

    // 1. Direct multi-note clear (e.g. simultaneous matches or special tile sweep)
    // that forms a single unambiguous triad on its own:
    const direct = detectChord(uniqueStage);
    if (direct !== null) {
      this.collected = [];
      return { chord: direct, notes: direct.notes.slice() };
    }

    // 2. Otherwise feed each distinct cleared note into the progressive builder:
    for (const note of uniqueStage) {
      if (this.collected.indexOf(note) !== -1) continue;

      if (this.collected.length === 0) {
        this.collected = [note];
        continue;
      }

      if (this.collected.length === 1) {
        const first = this.collected[0];
        if (canFormTriadPair(first, note)) {
          this.collected = [first, note];
        } else {
          // Pivot to the newer note so the player always has a pairable note
          this.collected = [note];
        }
        continue;
      }

      if (this.collected.length === 2) {
        const triad = detectChord([this.collected[0], this.collected[1], note]);
        if (triad !== null) {
          const completedNotes = [this.collected[0], this.collected[1], note];
          this.collected = [];
          return { chord: triad, notes: uniqueNotes(completedNotes) };
        }
      }
    }

    return { chord: null, notes: this.collected.slice() };
  }
}
