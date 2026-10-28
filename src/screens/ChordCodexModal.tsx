import { useState } from 'react';
import type { ReactElement } from 'react';
import { getAudioManager } from '../audio/AudioManager';
import { CHORD_DICTIONARY, chordLabel } from '../game/music/Chord';
import type { Chord } from '../game/music/Chord';
import { NOTE_NAMES } from '../game/music/Note';
import type { NoteName } from '../game/music/Note';
import { NOTE_FREQUENCIES } from '../audio/NoteFrequencies';
import { CHORD_BONUS, DIMINISHED_CHORD_BONUS } from '../game/mechanics/ScoreEngine';

export interface ChordCodexModalProps {
  initialTab?: 'codex' | 'guide';
  onClose: () => void;
}

const NOTE_DESCRIPTIONS: Record<NoteName, string> = {
  C: 'Root of C Major · Third of A Minor · Fifth of F Major',
  D: 'Root of D Minor · Fifth of G Major · Third of B Dim',
  E: 'Root of E Minor · Third of C Major · Fifth of A Minor',
  F: 'Root of F Major · Third of D Minor · Fifth of B Dim',
  G: 'Root of G Major · Fifth of C Major · Third of E Minor',
  A: 'Root of A Minor · Fifth of D Minor · Third of F Major',
  B: 'Root of B Diminished · Fifth of E Minor · Third of G Major',
};

export function ChordCodexModal({
  initialTab = 'codex',
  onClose,
}: ChordCodexModalProps): ReactElement {
  const [tab, setTab] = useState<'codex' | 'guide'>(initialTab);
  const [activeNote, setActiveNote] = useState<NoteName | null>(null);
  const [activeChordKey, setActiveChordKey] = useState<string | null>(null);

  const audio = getAudioManager();

  const handlePlayNote = (note: NoteName): void => {
    audio.initialize();
    audio.playNote(note);
    setActiveNote(note);
  };

  const handlePlayChord = (chord: Chord): void => {
    audio.initialize();
    audio.playChord(chord.notes);
    setActiveChordKey(`${chord.root}-${chord.quality}`);
  };

  return (
    <div
      className="settings codex-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Chord Codex and How to Play"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="codex-modal">
        <header className="codex-modal__header">
          <div>
            <p className="eyebrow">MUSICAL ENCYCLOPEDIA &amp; GUIDE</p>
            <h2 className="codex-modal__title">CHORD CODEX &amp; HOW TO PLAY</h2>
          </div>
          <button
            type="button"
            className="adv-sheet__close codex-modal__close"
            onClick={onClose}
            aria-label="Close Chord Codex"
          >
            &#10005;
          </button>
        </header>

        <div className="codex-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'codex'}
            className={`codex-tab${tab === 'codex' ? ' codex-tab--active' : ''}`}
            onClick={() => {
              audio.initialize();
              audio.playSelect();
              setTab('codex');
            }}
          >
            &#9835; CHORD STUDIO &amp; SYNTH
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'guide'}
            className={`codex-tab${tab === 'guide' ? ' codex-tab--active' : ''}`}
            onClick={() => {
              audio.initialize();
              audio.playSelect();
              setTab('guide');
            }}
          >
            &#10022; HOW TO PLAY &amp; RULES
          </button>
        </div>

        {tab === 'codex' ? (
          <div className="codex-body">
            <section className="codex-section">
              <div className="codex-section__head">
                <h3 className="codex-section__title">INTERACTIVE NOTE SCALE (OCTAVE 4)</h3>
                <span className="codex-section__hint">Tap any note tile to hear its pitch</span>
              </div>
              <div className="codex-notes-row">
                {NOTE_NAMES.map((note) => {
                  const isSelected = activeNote === note;
                  return (
                    <button
                      key={note}
                      type="button"
                      className={`codex-note-tile codex-note-tile--${note.toLowerCase()}${
                        isSelected ? ' codex-note-tile--active' : ''
                      }`}
                      onClick={() => handlePlayNote(note)}
                    >
                      <span className="codex-note-tile__letter">{note}</span>
                      <span className="codex-note-tile__hz">
                        {Math.round(NOTE_FREQUENCIES[note])}Hz
                      </span>
                    </button>
                  );
                })}
              </div>
              {activeNote && (
                <p className="codex-note-info">
                  <strong>Note {activeNote}</strong> ({NOTE_FREQUENCIES[activeNote]} Hz) —{' '}
                  {NOTE_DESCRIPTIONS[activeNote]}
                </p>
              )}
            </section>

            <section className="codex-section">
              <div className="codex-section__head">
                <h3 className="codex-section__title">THE 7 DIATONIC TRIADS</h3>
                <span className="codex-section__hint">
                  Collect any 3 triad notes in the Chord Builder to voice a chord
                </span>
              </div>
              <div className="codex-chords-grid">
                {CHORD_DICTIONARY.map((chord) => {
                  const key = `${chord.root}-${chord.quality}`;
                  const isPlaying = activeChordKey === key;
                  const highlightsNote =
                    activeNote !== null && chord.notes.indexOf(activeNote) !== -1;
                  const bonus =
                    chord.quality === 'diminished' ? DIMINISHED_CHORD_BONUS : CHORD_BONUS;

                  return (
                    <div
                      key={key}
                      className={
                        `codex-chord-card codex-chord-card--${chord.quality}` +
                        (isPlaying ? ' codex-chord-card--active' : '') +
                        (highlightsNote ? ' codex-chord-card--matched' : '')
                      }
                    >
                      <div className="codex-chord-card__top">
                        <div>
                          <h4 className="codex-chord-card__name">{chordLabel(chord)}</h4>
                          <span className={`codex-quality-badge codex-quality-badge--${chord.quality}`}>
                            {chord.quality.toUpperCase()} · +{bonus} PTS
                          </span>
                        </div>
                        <button
                          type="button"
                          className="codex-chord-card__play"
                          onClick={() => handlePlayChord(chord)}
                          aria-label={`Play ${chordLabel(chord)}`}
                        >
                          &#9654; HEAR
                        </button>
                      </div>

                      <div className="codex-chord-card__formula">
                        {chord.notes.map((n, idx) => (
                          <span key={n} className="codex-chord-card__step">
                            <button
                              type="button"
                              className={`codex-mini-note codex-note-tile--${n.toLowerCase()}`}
                              onClick={() => handlePlayNote(n)}
                              title={`Play note ${n}`}
                            >
                              {n}
                            </button>
                            {idx < chord.notes.length - 1 && (
                              <span className="codex-chord-card__plus">+</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        ) : (
          <div className="codex-body">
            <div className="guide-grid">
              <article className="guide-card">
                <div className="guide-card__icon">&#9835;</div>
                <h3 className="guide-card__title">1. Swap &amp; Match Notes</h3>
                <p className="guide-card__text">
                  Drag/swipe any note tile onto an adjacent tile—or click one tile and then its
                  neighbor—to line up <strong>3 or more identical notes</strong> horizontally or
                  vertically.
                </p>
              </article>

              <article className="guide-card">
                <div className="guide-card__icon">&#9834;</div>
                <h3 className="guide-card__title">2. Voice Chords in the Builder</h3>
                <p className="guide-card__text">
                  Each distinct note you match is collected in your HUD{' '}
                  <strong>♩ VOICES</strong> bar (e.g. <code>C · E → G/A</code>). Match the
                  completing 3rd note to voice a full <strong>Triad Chord</strong> and build
                  multipliers up to <strong>x5</strong>!
                </p>
              </article>

              <article className="guide-card">
                <div className="guide-card__icon">&#9552;</div>
                <h3 className="guide-card__title">3. Line-Clear Tiles (4-Match)</h3>
                <p className="guide-card__text">
                  Match <strong>4 identical notes</strong> in a straight line to forge a{' '}
                  <strong>Line-Clear tile</strong> (marked <code>=</code> or <code>|</code>). Swap
                  it or include it in a match to sweep an entire row or column (+300 bonus)!
                </p>
              </article>

              <article className="guide-card">
                <div className="guide-card__icon">&#10022;</div>
                <h3 className="guide-card__title">4. Color Bombs (5-Match)</h3>
                <p className="guide-card__text">
                  Match <strong>5 or more notes</strong> in a line to create a cosmic{' '}
                  <strong>Color Bomb</strong> (marked <code>*</code>). Swap it with any note tile
                  to detonate every tile of that note across the entire board (+400 bonus)!
                </p>
              </article>
            </div>

            <div className="guide-shortcuts">
              <h4 className="guide-shortcuts__title">CONTROLS &amp; SHORTCUTS</h4>
              <div className="guide-shortcuts__list">
                <span>
                  <kbd>Drag / Click</kbd> Swap Adjacent Tiles
                </span>
                <span>
                  <kbd>H</kbd> or <kbd>HINT</kbd> Show Valid Move
                </span>
                <span>
                  <kbd>Esc</kbd> Pause / Resume Game
                </span>
                <span>
                  <kbd>Tab / Arrows</kbd> Navigate Menus
                </span>
              </div>
            </div>
          </div>
        )}

        <footer className="codex-modal__footer">
          <button type="button" className="menu-button menu-button--primary" onClick={onClose}>
            GOT IT · BACK TO GAME
          </button>
        </footer>
      </div>
    </div>
  );
}
