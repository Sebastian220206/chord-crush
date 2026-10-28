import { NOTE_NAMES } from './Note';
import type { NoteName } from './Note';

/**
 * Chord qualities the model can describe.
 *
 * Suspended qualities are declared so the model is ready for them, but no
 * suspended chord is in the dictionary: identifying one correctly needs the
 * right interval pair, and guessing would report chords that are not there.
 */
export type ChordQuality = 'major' | 'minor' | 'diminished' | 'sus2' | 'sus4';

export interface Chord {
  /** The note the chord is built on. */
  root: NoteName;
  quality: ChordQuality;
  /** The chord tones in root order, for example C, E, G. */
  notes: NoteName[];
}

const QUALITY_LABELS: Record<ChordQuality, string> = {
  major: 'Major',
  minor: 'Minor',
  diminished: 'Diminished',
  sus2: 'Sus2',
  sus4: 'Sus4',
};

/** Human readable name, for logs and the HUD. */
export function chordLabel(chord: Chord): string {
  return `${chord.root} ${QUALITY_LABELS[chord.quality]}`;
}

/**
 * Canonical lookup key for a set of notes: sorted in pitch order and joined, so
 * C E G and G C E produce the same key.
 */
export function chordKey(notes: readonly NoteName[]): string {
  return notes
    .slice()
    .sort((a, b) => NOTE_NAMES.indexOf(a) - NOTE_NAMES.indexOf(b))
    .join('');
}

/**
 * The chords the game can recognise.
 *
 * Every entry is a diatonic triad built only from the seven natural notes the
 * board actually has. Triads needing accidentals (D major, B minor and friends)
 * are deliberately absent: without those notes they can never be matched, and
 * listing them would imply support the game does not have.
 *
 * No two entries share the same set of notes, so a set of three can match at
 * most one chord and detection never has to break a tie.
 */
export const CHORD_DICTIONARY: readonly Chord[] = [
  { root: 'C', quality: 'major', notes: ['C', 'E', 'G'] },
  { root: 'D', quality: 'minor', notes: ['D', 'F', 'A'] },
  { root: 'E', quality: 'minor', notes: ['E', 'G', 'B'] },
  { root: 'F', quality: 'major', notes: ['F', 'A', 'C'] },
  { root: 'G', quality: 'major', notes: ['G', 'B', 'D'] },
  { root: 'A', quality: 'minor', notes: ['A', 'C', 'E'] },
  { root: 'B', quality: 'diminished', notes: ['B', 'D', 'F'] },
];
