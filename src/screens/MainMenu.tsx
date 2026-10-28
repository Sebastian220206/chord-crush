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
   *
   * The hero action is the level the player is on, so a returning player is one
   * tap from where they left off instead of through the map first. Omitting it
   * keeps the old menu exactly: PLAY hands over to the map and nothing else.
   */
  onPlay?: (levelId: number) => void;
  /** Open the interactive Chord Codex or How to Play modal. */
  onOpenCodex?: (tab?: 'codex' | 'guide') => void;
}

/**
 * The first screen a player sees — styled as a professional indie game website hub.
 *
 * The menu holds no gameplay state and never touches Phaser. It reads the campaign
 * snapshot through the shared ProgressionManager and presents the brand header,
 * interactive musical preview, hero campaign CTA, stats strip, and doors to the
 * Level Map, Chord Codex, and Settings.
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
  const bestScore = manager.getBestScore(currentId);
  const campaignDone =
    hasProgress && !LEVEL_DEFINITIONS.some((l) => manager.getStatus(l.id) !== 'completed');

  // Compute total campaign stars and combined best score across all levels
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

  const handlePlay = (): void => {
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
    <div className="main-menu">
      {/* Top Professional Website Navigation Bar */}
      <nav className="site-navbar" aria-label="Main navigation">
        <div className="site-navbar__brand">
          <span className="site-navbar__logo-mark" aria-hidden="true">
            &#9835;
          </span>
          <span className="site-navbar__brand-name">CHORD CRUSH</span>
          <span className="site-navbar__badge">STUDIO EDITION</span>
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

      <div className="main-menu__bg" aria-hidden="true">
        <span className="main-menu__note main-menu__note--1">&#9834;</span>
        <span className="main-menu__note main-menu__note--2">&#9835;</span>
        <span className="main-menu__note main-menu__note--3">&#9834;</span>
        <span className="main-menu__note main-menu__note--4">&#9835;</span>
        <span className="main-menu__note main-menu__note--5">&#9834;</span>
        <span className="main-menu__note main-menu__note--6">&#9835;</span>
      </div>

      <div className="main-menu__content">
        <header className="main-menu__hero">
          <p className="main-menu__kicker">&#9835; A MUSICAL MATCH-3 PUZZLE ADVENTURE</p>
          <h1 className="main-menu__title">
            <span className="main-menu__title-line main-menu__title-line--chord">
              CHORD<span className="main-menu__title-note">&#9834;</span>
            </span>
            <span className="main-menu__title-line">CRUSH</span>
          </h1>
          <p className="main-menu__tagline">Match Notes. Voice Chords. Master the Staff.</p>
        </header>

        {/* Interactive 7-Note Scale Preview Bar */}
        <div className="hero-piano-strip" aria-label="Interactive musical note preview">
          {NOTE_NAMES.map((note) => (
            <button
              key={note}
              type="button"
              className={`hero-note-pill hero-note-pill--${note.toLowerCase()}${
                activeNote === note ? ' hero-note-pill--active' : ''
              }`}
              onClick={() => handleNoteTap(note)}
              title={`Tap to hear note ${note}`}
            >
              {note}
            </button>
          ))}
        </div>

        <div className="main-menu__actions">
          {/* The hero action doubles as the continue card */}
          <button
            type="button"
            className="menu-button menu-button--primary menu-button--hero"
            onClick={handlePlay}
            aria-label={`${hasProgress ? 'Continue' : 'Play'} level ${currentId}, ${
              currentLevel?.name ?? ''
            }`}
          >
            <span className="menu-button__kicker">
              {hasProgress ? 'CONTINUE CAMPAIGN' : 'START CAMPAIGN'}
            </span>
            <span className="menu-button__headline">
              {campaignDone
                ? 'CAMPAIGN COMPLETE · REPLAY'
                : `LEVEL ${currentId} · ${currentLevel?.name ?? ''}`}
            </span>
            <span className="menu-button__sub">
              {bestScore !== null
                ? `PERSONAL BEST ${formatNumber(bestScore)}`
                : currentLevel?.description ?? 'START THE CAMPAIGN'}
            </span>
          </button>

          <div className="main-menu__secondary">
            <button
              type="button"
              className="menu-button menu-button--secondary"
              onClick={handleLevels}
            >
              &#9733; LEVEL MAP
            </button>

            {onOpenCodex ? (
              <button
                type="button"
                className="menu-button menu-button--secondary"
                onClick={() => handleCodex('codex')}
              >
                &#9835; CHORD CODEX
              </button>
            ) : (
              <button
                type="button"
                className="menu-button menu-button--secondary"
                onClick={handleSettings}
              >
                SETTINGS
              </button>
            )}
          </div>

          {onOpenCodex && (
            <div className="main-menu__secondary">
              <button
                type="button"
                className="menu-button menu-button--secondary"
                onClick={() => handleCodex('guide')}
              >
                ? HOW TO PLAY
              </button>
              <button
                type="button"
                className="menu-button menu-button--secondary"
                onClick={handleSettings}
              >
                ⚙ SETTINGS
              </button>
            </div>
          )}
        </div>

        {/* Campaign Stats & Progress Ribbon */}
        <div className="main-menu__stats-bar" aria-label="Campaign statistics">
          <div className="main-menu__stat">
            <span className="main-menu__stat-value">
              {completedCount} / {totalLevels}
            </span>
            <span className="main-menu__stat-label">LEVELS</span>
          </div>
          <div className="main-menu__stat-divider" aria-hidden="true" />
          <div className="main-menu__stat">
            <span className="main-menu__stat-value">
              &#9733; {totalStars} / {maxStars}
            </span>
            <span className="main-menu__stat-label">STARS</span>
          </div>
          <div className="main-menu__stat-divider" aria-hidden="true" />
          <div className="main-menu__stat">
            <span className="main-menu__stat-value">{formatNumber(totalBestScore)}</span>
            <span className="main-menu__stat-label">TOTAL SCORE</span>
          </div>
        </div>

        <p className="main-menu__status" aria-hidden="true">
          {campaignDone
            ? 'Every chord mastered. Replay any level from the map to earn all 18 stars.'
            : hasProgress
              ? `${completedCount} OF ${totalLevels} LEVELS COMPLETE`
              : `${totalLevels} LEVELS · 7 DIATONIC CHORDS · WEB AUDIO SYNTHESIS`}
        </p>
      </div>
    </div>
  );
}
