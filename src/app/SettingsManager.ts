/**
 * Audio settings, persisted between sessions.
 *
 * A thin wrapper around AudioManager rather than a second audio system. It holds no
 * sound state of its own: reading a value asks the manager, writing one tells the
 * manager, and the only thing kept here is the knowledge of where the bytes live and
 * how to read them back safely. That keeps one mute state and one volume for the
 * whole game, which is the whole point of AudioManager being a singleton.
 *
 * The settings are applied to the manager on construction, so a returning player
 * hears the game the way they left it before any screen has asked for a value.
 */

import { getAudioManager } from '../audio/AudioManager';
import type { AudioManager } from '../audio/AudioManager';

export const SETTINGS_STORAGE_KEY = 'chord-crush-settings';

export interface AudioSettings {
  muted: boolean;
  /** 0..1. */
  masterVolume: number;
}

/** Safe defaults, used when there is no save or the save cannot be understood. */
export const DEFAULT_SETTINGS: AudioSettings = { muted: false, masterVolume: 0.5 };

/**
 * Forces stored data into the shape the game expects.
 *
 * A missing or malformed save falls back to the defaults rather than being repaired,
 * because a settings file the player cannot see is not worth guessing at: the worst
 * outcome is that sound comes back on at a moderate volume.
 */
export function sanitizeSettings(value: unknown): AudioSettings {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_SETTINGS };

  const raw = value as Partial<AudioSettings>;

  return {
    muted: typeof raw.muted === 'boolean' ? raw.muted : DEFAULT_SETTINGS.muted,
    masterVolume:
      typeof raw.masterVolume === 'number' && Number.isFinite(raw.masterVolume)
        ? Math.min(1, Math.max(0, raw.masterVolume))
        : DEFAULT_SETTINGS.masterVolume,
  };
}

type SettingsListener = (settings: AudioSettings) => void;

/** The subset of Web Storage this module uses. */
interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The browser's localStorage, or null when it cannot be reached at all. */
function resolveStore(): KeyValueStore | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;

    return window.localStorage;
  } catch {
    // Access itself can throw when storage is disabled by policy.
    return null;
  }
}

export class SettingsManager {
  private readonly audio: AudioManager;
  private readonly store: KeyValueStore | null;
  private readonly listeners = new Set<SettingsListener>();

  constructor(audio: AudioManager = getAudioManager(), store: KeyValueStore | null = resolveStore()) {
    this.audio = audio;
    this.store = store;

    // Apply whatever was saved before any screen reads a value, so the first thing
    // the player hears already matches their settings.
    this.apply();
  }

  getMuted(): boolean {
    return this.audio.isMuted();
  }

  getMasterVolume(): number {
    return this.audio.getMasterVolume();
  }

  /** A defensive copy, so a caller cannot mutate the settings by accident. */
  getSnapshot(): AudioSettings {
    return { muted: this.audio.isMuted(), masterVolume: this.audio.getMasterVolume() };
  }

  setMuted(muted: boolean): void {
    this.audio.setMuted(muted);
    this.commit();
  }

  setMasterVolume(volume: number): void {
    this.audio.setMasterVolume(volume);
    this.commit();
  }

  /**
   * Notifies on every change.
   *
   * This is how the settings panel and the shell agree on one state without either
   * reaching into the other. Returns an unsubscribe function.
   */
  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Saves and tells listeners. The single exit point for any change. */
  private commit(): void {
    const settings = this.getSnapshot();

    if (this.store) {
      try {
        this.store.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      } catch {
        // A full or blocked quota must not interrupt play.
      }
    }

    const snapshot = { ...settings };

    // forEach rather than for...of: the project targets es5, where iterating a Set
    // directly needs a compiler flag the rest of the codebase does not use.
    this.listeners.forEach((listener) => listener(snapshot));
  }

  /** Pushes the stored settings into the AudioManager. */
  private apply(): void {
    const stored = this.load();

    this.audio.setMuted(stored.muted);
    this.audio.setMasterVolume(stored.masterVolume);
  }

  private load(): AudioSettings {
    if (!this.store) return { ...DEFAULT_SETTINGS };

    let raw: string | null = null;

    try {
      raw = this.store.getItem(SETTINGS_STORAGE_KEY);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }

    if (raw === null || raw === '') return { ...DEFAULT_SETTINGS };

    try {
      return sanitizeSettings(JSON.parse(raw));
    } catch {
      // Malformed JSON, or JSON of the wrong shape entirely.
      return { ...DEFAULT_SETTINGS };
    }
  }
}

let shared: SettingsManager | null = null;

/** The game's single SettingsManager. */
export function getSettingsManager(): SettingsManager {
  if (shared === null) shared = new SettingsManager();

  return shared;
}
