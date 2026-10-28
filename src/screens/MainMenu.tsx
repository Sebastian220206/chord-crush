import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { getAudioManager } from '../audio/AudioManager';
import { getSettingsManager } from '../app/SettingsManager';
import { getProgressionManager } from '../levels/ProgressionManager';
import { LEVEL_DEFINITIONS } from '../levels/LevelManager';
import { formatNumber, starsForScore } from '../levels/ObjectiveEngine';
import { NOTE_NAMES } from '../game/music/Note';
import type { NoteName } from '../game/music/Note';

export interface MainMenuProps {
  /** Open the level map, where every level is shown. */
  onLevels: () => void;
  /** Open settings. */
  onSettings: () => void;
  /**
   * Start (or resume) the campaign directly at a level.
   */
  onPlay?: (levelId: number) => void;
  /** Open the interactive Chord Codex or How to Play modal. */
  onOpenCodex?: (tab?: 'codex' | 'guide') => void;
}

/**
 * Main landing page with the fantasy cosmic musical portal design.
 */
export function MainMenu({
  onLevels,
  onSettings,
  onPlay,
  onOpenCodex,
}: MainMenuProps): ReactElement {
  const manager = getProgressionManager();
  const settings = getSettingsManager();
  const audio = getAudioManager();
  const totalLevels = LEVEL_DEFINITIONS.length;

  const [, setSnapshot] = useState(() => manager.getSnapshot());
  const [muted, setMuted] = useState(() => settings.getMuted());
  const [activeNote, setActiveNote] = useState<NoteName | null>(null);

  useEffect(() => manager.subscribe(setSnapshot), [manager]);
  useEffect(
    () =>
      settings.subscribe((next) => {
        setMuted(next.muted);
      }),
    [settings]
  );

  const currentId = Math.min(manager.getHighestUnlockedLevel(), totalLevels);
  const currentLevel = LEVEL_DEFINITIONS[currentId - 1];
  const completedCount = manager.getCompletedLevels().length;
  const hasProgress = completedCount > 0;
  const campaignDone =
    hasProgress && !LEVEL_DEFINITIONS.some((l) => manager.getStatus(l.id) !== 'completed');

  let totalStars = 0;
  let totalBestScore = 0;
  for (const level of LEVEL_DEFINITIONS) {
    const score = manager.getBestScore(level.id);
    totalStars += starsForScore(level, score);
    if (score !== null) totalBestScore += score;
  }
  const maxStars = totalLevels * 3;

  const beginTurn = (): void => {
    audio.initialize();
    audio.playSelect();
  };

  const handleStartAdventure = (): void => {
    beginTurn();
    if (onPlay) onPlay(currentId);
    else onLevels();
  };

  const handleLevels = (): void => {
    beginTurn();
    onLevels();
  };

  const handleSettings = (): void => {
    beginTurn();
    onSettings();
  };

  const handleLearnMore = (): void => {
    beginTurn();
    if (onOpenCodex) onOpenCodex('guide');
    else onLevels();
  };

  const handleCodex = (tab: 'codex' | 'guide'): void => {
    beginTurn();
    if (onOpenCodex) onOpenCodex(tab);
  };

  const handleToggleSound = (): void => {
    const nextMuted = !muted;
    if (!nextMuted) {
      audio.initialize();
    }
    settings.setMuted(nextMuted);
    if (!nextMuted) {
      audio.playSelect();
    }
  };

  const handleNoteTap = (note: NoteName): void => {
    audio.initialize();
    audio.playNote(note);
    setActiveNote(note);
  };

  return (
    <div className="main-menu main-menu--portal">
      {/* Sleek studio header bar */}
      <nav className="site-navbar" aria-label="Main navigation">
        <div className="site-navbar__brand">
          <span className="site-navbar__logo-mark" aria-hidden="true">&#9835;</span>
          <span className="site-navbar__brand-name">CHORD CRUSH</span>
          <span className="site-navbar__badge">STUDIO</span>
        </div>

        <div className="site-navbar__links">
          <button type="button" className="site-navbar__link" onClick={handleLevels}>
            CAMPAIGN MAP
          </button>
          {onOpenCodex && (
            <>
              <button
                type="button"
                className="site-navbar__link"
                onClick={() => handleCodex('codex')}
              >
                CHORD CODEX
              </button>
              <button
                type="button"
                className="site-navbar__link"
                onClick={() => handleCodex('guide')}
              >
                HOW TO PLAY
              </button>
            </>
          )}
          <button
            type="button"
            className={`site-navbar__icon-btn${muted ? ' site-navbar__icon-btn--muted' : ''}`}
            onClick={handleToggleSound}
            aria-label={muted ? 'Unmute audio' : 'Mute audio'}
            title={muted ? 'Sound Off (Click to Unmute)' : 'Sound On (Click to Mute)'}
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <button
            type="button"
            className="site-navbar__icon-btn"
            onClick={handleSettings}
            aria-label="Open Settings"
            title="Audio & Game Settings"
          >
            ⚙
          </button>
        </div>
      </nav>

      {/* Floating magical musical notes */}
      <div className="main-menu__bg" aria-hidden="true">
        <span className="main-menu__note main-menu__note--1">&#9834;</span>
        <span className="main-menu__note main-menu__note--2">&#9835;</span>
        <span className="main-menu__note main-menu__note--3">&#9834;</span>
        <span className="main-menu__note main-menu__note--4">&#9835;</span>
        <span className="main-menu__note main-menu__note--5">&#9834;</span>
        <span className="main-menu__note main-menu__note--6">&#9835;</span>
      </div>

      {/* Hero Portal Center Stage */}
      <div className="portal-stage">
        {/* Luminous Arch Portal Frame */}
        <div className="portal-arch">
          <div className="portal-arch__glow" aria-hidden="true" />
          <div className="portal-arch__crystal-base" aria-hidden="true" />

          {/* Golden 3D Chord Crush Title */}
          <div className="portal-title-wrap">
            <h1 className="portal-title">
              <span className="portal-title__top">
                Chord
                <span className="portal-title__heart" aria-hidden="true">&#9825;</span>
              </span>
              <span className="portal-title__bottom">Crush</span>
            </h1>
            <p className="portal-subtitle">Match Notes · Voice Chords · Master the Staff</p>
          </div>

          {/* Interactive Portal Buttons matching the artwork */}
          <div className="portal-actions">
            <button
              type="button"
              className="portal-btn portal-btn--primary focus-visible-ring"
              onClick={handleStartAdventure}
              aria-label="Start Adventure"
            >
              <span className="portal-btn__gem" aria-hidden="true" />
              <span className="portal-btn__text">START ADVENTURE</span>
              <span className="portal-btn__gem" aria-hidden="true" />
            </button>

            <button
              type="button"
              className="portal-btn portal-btn--secondary focus-visible-ring"
              onClick={handleLearnMore}
              aria-label="Learn More"
            >
              <span className="portal-btn__text">LEARN MORE</span>
            </button>
          </div>

          {/* Interactive 7-Note Scale Keyboard embedded inside the Portal */}
          <div className="portal-synth" aria-label="Audition musical notes">
            <span className="portal-synth__label" aria-hidden="true">♫ AUDITION SCALE ♫</span>
            <div className="portal-synth__keys">
              {NOTE_NAMES.map((note) => (
                <button
                  key={note}
                  type="button"
                  className={`portal-synth__key portal-synth__key--${note.toLowerCase()}${
                    activeNote === note ? ' portal-synth__key--active' : ''
                  }`}
                  onClick={() => handleNoteTap(note)}
                  title={`Play note ${note}`}
                >
                  {note}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Campaign Info & Quick Access Floating Deck */}
        <footer className="portal-footer">
          <div className="portal-quick-links">
            <button
              type="button"
              className="portal-chip-btn focus-visible-ring"
              onClick={handleLevels}
            >
              &#9733; LEVEL MAP ({completedCount}/{totalLevels})
            </button>
            {onOpenCodex && (
              <button
                type="button"
                className="portal-chip-btn focus-visible-ring"
                onClick={() => handleCodex('codex')}
              >
                &#9835; CHORD CODEX
              </button>
            )}
            <button
              type="button"
              className="portal-chip-btn focus-visible-ring"
              onClick={handleSettings}
            >
              ⚙ SETTINGS
            </button>
          </div>

          <div className="portal-stats-bar" aria-label="Campaign stats">
            <div className="portal-stat">
              <span className="portal-stat__value">{completedCount} / {totalLevels}</span>
              <span className="portal-stat__label">LEVELS</span>
            </div>
            <div className="portal-stat-divider" aria-hidden="true" />
            <div className="portal-stat">
              <span className="portal-stat__value">&#9733; {totalStars} / {maxStars}</span>
              <span className="portal-stat__label">STARS</span>
            </div>
            <div className="portal-stat-divider" aria-hidden="true" />
            <div className="portal-stat">
              <span className="portal-stat__value">{formatNumber(totalBestScore)}</span>
              <span className="portal-stat__label">BEST SCORE</span>
            </div>
          </div>

          <p className="portal-campaign-status">
            {campaignDone
              ? '★ All 6 levels cleared! Replay to achieve 3 stars across the campaign.'
              : hasProgress
                ? `Current: Level ${currentId} · ${currentLevel?.name ?? ''}`
                : 'Diad & Triad Match-3 · Diatonic Harmonies in C Major'}
          </p>
        </footer>
      </div>
    </div>
  );
}
