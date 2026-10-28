import type { NoteName } from '../game/music/Note';

/**
 * Natural notes in octave 4, in equal temperament.
 *
 * Deliberately the seven notes the board can actually hold: no accidentals, no
 * octaves, no MIDI numbers. A tile's note name is the only key needed to sound
 * it, so the audio layer reuses the board's NoteName type instead of inventing
 * a parallel one.
 */
export const NOTE_FREQUENCIES: Record<NoteName, number> = {
  C: 261.63,
  D: 293.66,
  E: 329.63,
  F: 349.23,
  G: 392.0,
  A: 440.0,
  B: 493.88,
};

/** Frequency of a single note. */
export function frequencyFor(note: NoteName): number {
  return NOTE_FREQUENCIES[note];
}
