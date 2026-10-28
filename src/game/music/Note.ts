import { NOTES } from '../board/Tile';
import type { NoteType } from '../board/Tile';

/**
 * A note name as the music layer sees it.
 *
 * Notes are already modelled by the board, so this module re-exports that one
 * definition instead of declaring a second, competing set. The music layer
 * speaks NoteName and the board speaks NoteType; they are the same seven values,
 * so nothing can drift apart.
 */
export type NoteName = NoteType;

/**
 * The available notes, in pitch order.
 *
 * Pitch order rather than tile order, because chord keys and log output are both
 * derived from it and must not depend on how the board happened to be scanned.
 */
export const NOTE_NAMES: readonly NoteName[] = NOTES;

/** Narrows an arbitrary string to a note the board can actually hold. */
export function isNoteName(value: string): value is NoteName {
  return (NOTE_NAMES as readonly string[]).indexOf(value) !== -1;
}

/** Copies the notes into pitch order. */
export function sortNotes(notes: readonly NoteName[]): NoteName[] {
  return notes.slice().sort((a, b) => NOTE_NAMES.indexOf(a) - NOTE_NAMES.indexOf(b));
}

/**
 * The distinct notes, in pitch order.
 *
 * Duplicates carry no musical information once the notes are gathered as a set,
 * so four copies of C are the same pitch class as one. This is what lets a
 * cascade stage that removed "C C C E E E G" be analysed as a plain C major.
 */
export function uniqueNotes(notes: readonly NoteName[]): NoteName[] {
  return sortNotes(notes.filter((note, index) => notes.indexOf(note) === index));
}
