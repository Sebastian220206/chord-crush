import { frequencyFor } from './NoteFrequencies';
import { uniqueNotes } from '../game/music/Note';
import type { NoteName } from '../game/music/Note';

/**
 * Web Audio feedback for CHORD CRUSH.
 *
 * Everything is synthesised: oscillators and gain nodes, no audio files, no
 * HTMLAudioElement, no dependencies. The manager owns exactly one AudioContext
 * and never creates it until initialize() is called, because browsers block
 * audio that starts without a user gesture.
 *
 * Two rules shape the whole design:
 *
 *   1. Audio is optional. If the browser has no AudioContext, or the context
 *      refuses to start, every method silently becomes a no-op. Gameplay never
 *      depends on sound, so nothing here may throw into a caller.
 *   2. Muting and volume live here alone. Callers ask for a sound; they never
 *      think about loudness.
 */

/** How long a single voice takes to reach full volume. Short, to avoid clicks. */
const ATTACK = 0.012;

/** A silent floor, because exponential ramps cannot reach zero. */
const SILENCE = 0.0001;

/** Upper bound on the cascade pitch so a deep cascade stays musical. */
const MAX_CASCADE_HZ = 1200;

/** Highest cascade level that still raises the pitch. */
const MAX_CASCADE_SEMITONES = 14;

const DEFAULT_MASTER_VOLUME = 0.5;

type OscillatorTypeName = 'sine' | 'triangle' | 'square' | 'sawtooth';

/** A note to sound: when, how loud, and for how long. */
interface ToneOptions {
  frequency: number;
  /** Seconds after the start of the sound. */
  startOffset?: number;
  duration: number;
  peak?: number;
  type?: OscillatorTypeName;
}

/**
 * Vendor-prefixed constructor lookup.
 *
 * The prefixed name is not in the DOM typings, so it is reached through a
 * structural view of `window` rather than an `any` cast that would hide real
 * mistakes.
 */
type AudioContextConstructor = new () => AudioContext;

function resolveAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;

  const scope = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };

  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

export class AudioManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private volume = DEFAULT_MASTER_VOLUME;
  /** Set once audio is known to be impossible, so we stop retrying. */
  private unavailable = false;

  /** True when this browser can play sound at all. */
  get isSupported(): boolean {
    return resolveAudioContextConstructor() !== null;
  }

  /**
   * Creates or resumes the AudioContext. Safe to call on every gesture.
   *
   * Nothing is created until this runs, so no audio is ever requested during
   * page load. A failed attempt disables audio permanently instead of throwing
   * on every subsequent sound.
   */
  initialize(): void {
    if (this.unavailable || this.context !== null) {
      this.resume();
      return;
    }

    try {
      const AudioContextCtor = resolveAudioContextConstructor();

      if (!AudioContextCtor) {
        this.unavailable = true;
        return;
      }

      const context = new AudioContextCtor();
      const master = context.createGain();

      // Mute and volume are applied through one master gain, so individual
      // sounds never have to know about either.
      master.gain.value = this.muted ? 0 : this.volume;
      master.connect(context.destination);

      this.context = context;
      this.master = master;
      this.resume();
    } catch {
      this.unavailable = true;
      this.context = null;
      this.master = null;
    }
  }

  /**
   * Suspends the AudioContext.
   *
   * Used when the game is paused. Suspending is not muting and not destroying: the
   * context keeps its state and its nodes, and resume() brings sound back exactly
   * where it left off. That is the difference between "the game is paused" and
   * "the player turned the sound off", and it is why pausing never touches the
   * player's mute or volume settings.
   */
  suspend(): void {
    if (this.context === null || this.context.state !== 'running') return;

    try {
      void this.context.suspend().catch(() => undefined);
    } catch {
      // A refused suspend simply means the sound keeps playing through the pause,
      // which is far better than throwing into the pause handler.
    }
  }

  /**
   * Resumes a context the browser suspended, or that suspend() paused.
   *
   * Safe to call at any time: a context that is not suspended is left alone.
   */
  resume(): void {
    if (this.context === null || this.context.state !== 'suspended') return;

    try {
      void this.context.resume().catch(() => undefined);
    } catch {
      // A blocked resume simply means silence, which is an acceptable outcome.
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGain();
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** Volume is clamped to 0..1; anything else is ignored. */
  setMasterVolume(volume: number): void {
    // Clamping handles out-of-range values including infinities. NaN is the one
    // input that cannot be clamped meaningfully, so it falls back to the default
    // rather than silently turning the sound off.
    this.volume = Number.isNaN(volume)
      ? DEFAULT_MASTER_VOLUME
      : Math.min(1, Math.max(0, volume));
    this.applyGain();
  }

  getMasterVolume(): number {
    return this.volume;
  }

  private applyGain(): void {
    if (this.master === null) return;

    try {
      this.master.gain.value = this.muted ? 0 : this.volume;
    } catch {
      // Never let a gain update break a frame.
    }
  }

  /** True when a sound can actually be scheduled right now. */
  private ready(): boolean {
    return (
      !this.unavailable &&
      !this.muted &&
      this.volume > 0 &&
      this.context !== null &&
      this.master !== null
    );
  }

  /**
   * Schedules one short enveloped note.
   *
   * The whole body is guarded: an audio failure must never surface as a
   * gameplay error, so a throw here ends the sound and nothing more.
   */
  private tone(options: ToneOptions): void {
    if (!this.ready()) return;

    try {
      const context = this.context as AudioContext;
      const master = this.master as GainNode;

      const start = context.currentTime + (options.startOffset ?? 0);
      const end = start + options.duration;
      const peak = options.peak ?? 0.25;

      const oscillator = context.createOscillator();
      const envelope = context.createGain();

      oscillator.type = options.type ?? 'sine';
      oscillator.frequency.setValueAtTime(options.frequency, start);

      // Ramp from silence rather than starting at full volume, which is what
      // produces the click at the start of every raw oscillator.
      envelope.gain.setValueAtTime(SILENCE, start);
      envelope.gain.exponentialRampToValueAtTime(peak, start + ATTACK);
      envelope.gain.exponentialRampToValueAtTime(SILENCE, end);

      oscillator.connect(envelope);
      envelope.connect(master);

      oscillator.start(start);
      oscillator.stop(end + 0.02);
    } catch {
      // Silent failure by design.
    }
  }

  /** Short high click when a tile is picked up. */
  playSelect(): void {
    this.tone({ frequency: 880, duration: 0.06, peak: 0.15, type: 'triangle' });
  }

  /** Two rising notes for a swap that turned out to be legal. */
  playSwap(): void {
    this.tone({ frequency: 440, duration: 0.08, peak: 0.2, type: 'triangle' });
    this.tone({ frequency: 660, startOffset: 0.07, duration: 0.09, peak: 0.2, type: 'triangle' });
  }

  /** Two falling notes for a swap that had to be undone. */
  playInvalidSwap(): void {
    this.tone({ frequency: 330, duration: 0.08, peak: 0.2, type: 'sawtooth' });
    this.tone({ frequency: 220, startOffset: 0.07, duration: 0.1, peak: 0.18, type: 'sawtooth' });
  }

  /** A short ascending phrase for a successful match. */
  playMatch(): void {
    this.tone({ frequency: 523.25, duration: 0.09, peak: 0.22, type: 'triangle' });
    this.tone({ frequency: 659.25, startOffset: 0.06, duration: 0.09, peak: 0.22, type: 'triangle' });
    this.tone({ frequency: 783.99, startOffset: 0.12, duration: 0.11, peak: 0.22, type: 'triangle' });
  }

  /**
   * Plays a single musical note with a warm octave harmonic, used when previewing
   * notes in the Chord Codex or matching a specific note on the board.
   */
  playNote(note: NoteName): void {
    const freq = frequencyFor(note);
    this.tone({ frequency: freq, duration: 0.34, peak: 0.24, type: 'triangle' });
    this.tone({ frequency: freq * 2, startOffset: 0.01, duration: 0.22, peak: 0.08, type: 'sine' });
  }

  /**
   * Sounds the actual pitch(es) of the tiles cleared in a match stage, arpeggiated
   * slightly so the player hears the exact musical note(s) they matched.
   */
  playMatchedNotes(notes: readonly NoteName[]): void {
    const distinct = uniqueNotes(notes);
    if (distinct.length === 0) {
      this.playMatch();
      return;
    }

    distinct.forEach((note, idx) => {
      const freq = frequencyFor(note);
      const offset = idx * 0.055;
      this.tone({
        frequency: freq,
        startOffset: offset,
        duration: 0.24,
        peak: 0.22,
        type: 'triangle',
      });
      this.tone({
        frequency: freq * 2,
        startOffset: offset + 0.04,
        duration: 0.18,
        peak: 0.1,
        type: 'sine',
      });
    });
  }

  /** Soft chime for a board-wide removal. */
  playRemove(): void {
    this.tone({ frequency: 659.25, duration: 0.14, peak: 0.18 });
    this.tone({ frequency: 987.77, startOffset: 0.04, duration: 0.12, peak: 0.12 });
  }

  /** Brighter and louder than a normal match, for special tile moments. */
  playSpecial(): void {
    this.tone({ frequency: 1046.5, duration: 0.18, peak: 0.26, type: 'square' });
    this.tone({ frequency: 1567.98, startOffset: 0.06, duration: 0.2, peak: 0.2, type: 'square' });
    this.tone({ frequency: 2093, startOffset: 0.12, duration: 0.22, peak: 0.14, type: 'triangle' });
  }

  /**
   * A cascade voice that climbs with the cascade level.
   *
   * The climb is capped in both semitones and absolute frequency, so a runaway
   * cascade cannot push the pitch past anything worth hearing.
   */
  playCascade(cascadeLevel: number): void {
    const level = Number.isFinite(cascadeLevel)
      ? Math.max(1, Math.floor(cascadeLevel))
      : 1;

    const semitones = Math.min(level - 1, MAX_CASCADE_SEMITONES);
    const root = frequencyFor('G') * Math.pow(2, semitones / 12);

    this.tone({ frequency: Math.min(root, MAX_CASCADE_HZ), duration: 0.12, peak: 0.2, type: 'triangle' });
    this.tone({
      frequency: Math.min(root * 1.5, MAX_CASCADE_HZ),
      startOffset: 0.05,
      duration: 0.12,
      peak: 0.14,
      type: 'triangle',
    });
  }

  /**
   * Sounds the supplied notes together as a single chord.
   *
   * This plays notes; it does not recognise chords. ChordEngine has already
   * decided what was formed, and only the resulting notes arrive here.
   * Duplicates are collapsed so "C C E G" is three voices, not four, and an
   * empty list plays nothing.
   */
  playChord(notes: readonly NoteName[]): void {
    const chord = uniqueNotes(notes);

    if (chord.length === 0) return;

    // Split the peak across the voices so a three-note chord is no louder than
    // a single note would be.
    const peak = Math.max(0.05, 0.3 / chord.length);

    chord.forEach((note, idx) => {
      const freq = frequencyFor(note);
      this.tone({ frequency: freq, duration: 0.65, peak, type: 'triangle' });
      this.tone({
        frequency: freq * 2,
        startOffset: 0.05 + idx * 0.06,
        duration: 0.42,
        peak: peak * 0.55,
        type: 'sine',
      });
    });
  }

  /**
   * Short positive stab when a level begins.
   *
   * Also used for moving on to the next level, since from the player's point of
   * view the two are the same event.
   */
  playLevelStart(): void {
    this.tone({ frequency: 523.25, duration: 0.14, peak: 0.24, type: 'triangle' });
    this.tone({ frequency: 783.99, startOffset: 0.1, duration: 0.18, peak: 0.24, type: 'triangle' });
    this.tone({ frequency: 1046.5, startOffset: 0.2, duration: 0.24, peak: 0.2, type: 'triangle' });
  }

  /**
   * Celebratory run for finishing a level.
   *
   * A major triad followed by a rising pair, so a win is audibly brighter than a
   * match and impossible to confuse with one.
   */
  playWin(): void {
    const notes: readonly NoteName[] = ['C', 'E', 'G'];

    for (const note of notes) {
      this.tone({ frequency: frequencyFor(note), duration: 0.5, peak: 0.2 });
    }

    this.tone({ frequency: frequencyFor('C') * 2, startOffset: 0.3, duration: 0.3, peak: 0.22, type: 'triangle' });
    this.tone({ frequency: frequencyFor('G') * 2, startOffset: 0.4, duration: 0.34, peak: 0.2, type: 'triangle' });
  }

  /** Short descending fall for running out of moves. */
  playLose(): void {
    this.tone({ frequency: 392, duration: 0.2, peak: 0.24, type: 'sawtooth' });
    this.tone({ frequency: 329.63, startOffset: 0.16, duration: 0.2, peak: 0.22, type: 'sawtooth' });
    this.tone({ frequency: 261.63, startOffset: 0.32, duration: 0.34, peak: 0.2, type: 'sawtooth' });
  }
}

let shared: AudioManager | null = null;

/**
 * The game's single AudioManager.
 *
 * Shared so that the Phaser scene and the React shell agree on one mute state
 * without either of them owning the other.
 */
export function getAudioManager(): AudioManager {
  if (shared === null) shared = new AudioManager();

  return shared;
}
