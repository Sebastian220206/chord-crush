import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { getProgressionManager } from '../levels/ProgressionManager';
import type { LevelStatus, ProgressionManager } from '../levels/ProgressionManager';
import { LEVEL_DEFINITIONS } from '../levels/LevelManager';
import type { Level } from '../levels/Level';
import { getAudioManager } from '../audio/AudioManager';
import { formatNumber, starsForScore, starThresholdsFor } from '../levels/ObjectiveEngine';

export interface LevelMapProps {
  /** Passed in rather than imported so tests and stories can supply a campaign. */
  progression?: ProgressionManager;
  /** The map asks for a level; it never loads one itself. */
  onPlay: (levelId: number) => void;
  /** Back to the main menu. */
  onBack: () => void;
  /** Optional hook to open the Chord Codex modal from the campaign map. */
  onOpenCodex?: () => void;
}

const STATUS_LABEL: Record<LevelStatus, string> = {
  locked: 'LOCKED',
  unlocked: 'UNLOCKED',
  completed: 'COMPLETE',
};

function renderStars(count: number): string {
  let out = '';
  for (let i = 1; i <= 3; i++) {
    out += i <= count ? '★' : '☆';
  }
  return out;
}

interface Point {
  x: number;
  y: number;
}

/** 6 clean progression milestones along an elegant winding trail (viewBox 0..100) */
const LEVEL_POINTS: readonly Point[] = [
  { x: 50, y: 14 }, // Level 1
  { x: 30, y: 28 }, // Level 2
  { x: 70, y: 42 }, // Level 3
  { x: 32, y: 56 }, // Level 4
  { x: 68, y: 70 }, // Level 5
  { x: 50, y: 84 }, // Level 6
];

/**
 * Builds a smooth Catmull-Rom to Cubic Bezier SVG path through point coordinates.
 */
function buildPath(points: readonly Point[]): string {
  if (points.length <= 1) return '';
  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const c1x = p1.x + (p2.x - p0.x) / 5.5;
    const c1y = p1.y + (p2.y - p0.y) / 5.5;
    const c2x = p2.x - (p3.x - p1.x) / 5.5;
    const c2y = p2.y - (p3.y - p1.y) / 5.5;

    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x} ${p2.y}`;
  }

  return d;
}

export function LevelMap({
  progression,
  onPlay,
  onBack,
  onOpenCodex,
}: LevelMapProps): ReactElement {
  const manager = progression ?? getProgressionManager();
  const audio = getAudioManager();
  const totalLevels = LEVEL_DEFINITIONS.length;

  const currentId = Math.min(manager.getHighestUnlockedLevel(), totalLevels);
  const [selectedId, setSelectedId] = useState<number | null>(currentId);
  const [lockedHint, setLockedHint] = useState<string>('');
  const [snapshot, setSnapshot] = useState(() => manager.getSnapshot());
  const [hudToast, setHudToast] = useState<string>('');

  useEffect(() => manager.subscribe(setSnapshot), [manager]);

  const selected = selectedId === null
    ? null
    : LEVEL_DEFINITIONS.find((level) => level.id === selectedId) ?? null;
  const selectedStatus = selected ? manager.getStatus(selected.id) : 'locked';

  useEffect(() => {
    if (selected !== null && manager.getStatus(selected.id) === 'locked') {
      setSelectedId(LEVEL_DEFINITIONS[0].id);
    }
  }, [manager, selected, snapshot.highestUnlockedLevel]);

  // Esc closes the info sheet
  useEffect(() => {
    if (selected === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected]);

  const playUiSound = (sound: 'select' | 'locked'): void => {
    audio.initialize();
    if (sound === 'select') audio.playSelect();
    else audio.playInvalidSwap();
  };

  const handleSelect = (level: Level, status: LevelStatus): void => {
    if (status === 'locked') {
      playUiSound('locked');
      setLockedHint(`🔒 Level ${level.id} (${level.name}) is locked — beat Level ${level.id - 1} first!`);
      return;
    }
    playUiSound('select');
    setLockedHint('');
    setSelectedId(level.id);
  };

  const handlePlay = (): void => {
    if (!selected || !manager.isUnlocked(selected.id)) {
      playUiSound('locked');
      return;
    }
    onPlay(selected.id);
  };

  const triggerToast = (msg: string, chord?: ('C'|'D'|'E'|'F'|'G'|'A'|'B')[]): void => {
    audio.initialize();
    if (chord) audio.playChord(chord);
    else audio.playSelect();
    setHudToast(msg);
    setTimeout(() => setHudToast(''), 2500);
  };

  let totalStars = 0;
  let totalScore = 0;
  LEVEL_DEFINITIONS.forEach((lvl) => {
    const best = snapshot.bestScores[lvl.id];
    if (best !== undefined && snapshot.completedLevels.indexOf(lvl.id) !== -1) {
      totalStars += Math.max(1, starsForScore(lvl, best));
      totalScore += best;
    }
  });

  const selectedBest = selected ? manager.getBestScore(selected.id) : null;
  const selectedStars =
    selected && selectedStatus === 'completed' && selectedBest !== null
      ? Math.max(1, starsForScore(selected, selectedBest))
      : 0;
  const selectedThresholds = selected ? starThresholdsFor(selected) : null;

  // The full trail path
  const fullPathD = buildPath(LEVEL_POINTS);

  // The glowing completed/unlocked segment of the path
  const unlockedCount = Math.max(1, Math.min(currentId, totalLevels));
  const activePoints = LEVEL_POINTS.slice(0, unlockedCount);
  const glowingPathD = buildPath(activePoints);

  return (
    <div className="valley-map-screen valley-map-screen--minimal">
      {/* ================= TOP HUD HEADER (Preserved Exactly) ================= */}
      <header className="valley-top-hud">
        <div className="hud-capsules-group hud-capsules-group--left">
          {/* Back to menu button */}
          <button
            type="button"
            className="hud-action-pill hud-action-pill--back focus-visible-ring"
            onClick={() => {
              playUiSound('select');
              onBack();
            }}
            title="Return to Main Menu"
          >
            ← MENU
          </button>

          {/* Hearts / Lives Counter */}
          <div className="hud-pill hud-pill--hearts" title="Hearts: Full">
            <span className="hud-pill__icon" aria-hidden="true">❤️</span>
            <span className="hud-pill__value">5 / 5</span>
          </div>

          {/* Energy Capsule */}
          <div className="hud-pill hud-pill--energy" title="Energy: 30">
            <span className="hud-pill__icon" aria-hidden="true">⚡</span>
            <span className="hud-pill__value">30</span>
          </div>
        </div>

        {/* Center Mascot Avatar Crest */}
        <div className="hud-mascot-crest">
          <div className="mascot-sunburst" aria-hidden="true" />
          <button
            type="button"
            className="mascot-avatar-disc focus-visible-ring"
            onClick={() => triggerToast('Chordy says: "Follow the glowing trail!"', ['C', 'E', 'G'])}
            title="Chordy the Musical Mascot"
            aria-label="Chordy the Mascot"
          >
            <span className="mascot-face" aria-hidden="true">🎧</span>
          </button>
        </div>

        <div className="hud-capsules-group hud-capsules-group--right">
          {/* Gold Notes / Score Counter */}
          <div className="hud-pill hud-pill--coins" title={`Total Score: ${formatNumber(totalScore)}`}>
            <span className="hud-pill__icon" aria-hidden="true">♫</span>
            <span className="hud-pill__value">{formatNumber(totalScore)}</span>
          </div>

          {/* Stars Counter */}
          <div className="hud-pill hud-pill--stars" title={`Stars: ${totalStars} of 18`}>
            <span className="hud-pill__icon" aria-hidden="true">★</span>
            <span className="hud-pill__value">{totalStars} / 18</span>
          </div>

          {/* Settings / Gear button */}
          <button
            type="button"
            className="hud-gear-btn focus-visible-ring"
            onClick={() => {
              playUiSound('select');
              if (onOpenCodex) onOpenCodex();
            }}
            title="Chord Codex & Settings"
            aria-label="Settings"
          >
            ⚙
          </button>
        </div>
      </header>

      {/* Floating HUD Toast */}
      {hudToast && (
        <div className="valley-toast" role="status" aria-live="polite">
          <span>{hudToast}</span>
        </div>
      )}

      {/* Locked Level Warning Banner */}
      {lockedHint && (
        <div className="valley-locked-banner" role="status" aria-live="polite">
          <span>{lockedHint}</span>
          <button
            type="button"
            className="valley-locked-dismiss"
            onClick={() => setLockedHint('')}
            aria-label="Dismiss hint"
          >
            ✕
          </button>
        </div>
      )}

      {/* ================= MINIMAL CAMPAIGN TRAIL VIEW (No clutter) ================= */}
      <main className="minimal-trail-container">
        <svg
          viewBox="0 0 100 100"
          className="trail-svg-stage"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            {/* Soft luminous trail core */}
            <linearGradient id="glowingTrailGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ffd54f" />
              <stop offset="50%" stopColor="#ffb300" />
              <stop offset="100%" stopColor="#ff8f00" />
            </linearGradient>

            {/* Glowing path filter */}
            <filter id="pathGlowFilter" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="1.8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Background trail base (inactive / upcoming path) */}
          <path
            d={fullPathD}
            fill="none"
            stroke="rgba(215, 180, 140, 0.45)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="1.2 2"
          />

          {/* GLOWING TRAIL (Lights up as levels are unlocked and completed!) */}
          {unlockedCount > 1 && (
            <>
              {/* Outer Bloom Glow */}
              <path
                d={glowingPathD}
                fill="none"
                stroke="rgba(255, 179, 0, 0.4)"
                strokeWidth="7"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#pathGlowFilter)"
                className="glowing-path-bloom"
              />

              {/* Radiant Golden Core */}
              <path
                d={glowingPathD}
                fill="none"
                stroke="url(#glowingTrailGrad)"
                strokeWidth="3.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="glowing-path-core"
              />

              {/* Shimmering pulse overlay */}
              <path
                d={glowingPathD}
                fill="none"
                stroke="#ffffff"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="2 4"
                className="glowing-path-shimmer"
              />
            </>
          )}
        </svg>

        {/* ================= 6 MINIMAL LEVEL NODES ================= */}
        <div className="minimal-nodes-layer">
          {LEVEL_DEFINITIONS.map((level, index) => {
            const status = manager.getStatus(level.id);
            const pos = LEVEL_POINTS[index];
            const isCurrent = level.id === currentId && status !== 'locked';
            const isSelected = level.id === selectedId;
            const best = manager.getBestScore(level.id);
            const nodeStars =
              status === 'completed' && best !== null
                ? Math.max(1, starsForScore(level, best))
                : 0;

            return (
              <button
                key={level.id}
                type="button"
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                className={
                  `trail-node trail-node--${status} focus-visible-ring` +
                  (isCurrent ? ' trail-node--current' : '') +
                  (isSelected ? ' trail-node--selected' : '')
                }
                onClick={() => handleSelect(level, status)}
                aria-disabled={status === 'locked'}
                aria-label={`Level ${level.id}, ${level.name}, ${STATUS_LABEL[status]}`}
              >
                <div className="trail-node__disc">
                  {status === 'locked' ? (
                    <span className="trail-node__lock" aria-hidden="true">🔒</span>
                  ) : (
                    <span className="trail-node__num">{level.id}</span>
                  )}
                </div>

                {status === 'completed' && (
                  <span className="trail-node__check" aria-hidden="true">✓</span>
                )}

                {status === 'completed' && (
                  <span className="trail-node__stars" aria-hidden="true">
                    {renderStars(nodeStars)}
                  </span>
                )}

                {isCurrent && status !== 'completed' && (
                  <span className="trail-node__play-tag" aria-hidden="true">PLAY</span>
                )}

                <span className="trail-node__label">{level.name}</span>
              </button>
            );
          })}
        </div>
      </main>

      {/* ================= LEVEL DETAIL SHEET (MODAL POPUP) ================= */}
      {selected && (
        <section className="valley-sheet" aria-label={`Level ${selected.id} information`}>
          <div className="valley-sheet__card">
            <button
              type="button"
              className="valley-sheet__close"
              onClick={() => setSelectedId(null)}
              aria-label="Close"
            >
              ✕
            </button>
            <p className="valley-sheet__eyebrow">LEVEL {selected.id} · {STATUS_LABEL[selectedStatus]}</p>
            <h2 className="valley-sheet__name">{selected.name}</h2>

            {selected.description && (
              <p className="valley-sheet__desc">{selected.description}</p>
            )}

            {selectedStatus === 'completed' && (
              <div className="valley-sheet__stars" aria-label={`${selectedStars} of 3 stars`}>
                {renderStars(selectedStars)}
              </div>
            )}

            <h3 className="valley-sheet__section-title">OBJECTIVES</h3>
            <ul className="valley-sheet__objectives">
              <li>
                <span className="obj-icon">♫</span>
                <span className="obj-label">Target Score</span>
                <span className="obj-value">{formatNumber(selected.scoreTarget)}</span>
              </li>
              {selected.chordTarget !== undefined && (
                <li>
                  <span className="obj-icon">♩</span>
                  <span className="obj-label">Diatonic Chords</span>
                  <span className="obj-value">{selected.chordTarget}</span>
                </li>
              )}
              {selected.specialTileTarget !== undefined && (
                <li>
                  <span className="obj-icon">✧</span>
                  <span className="obj-label">Special Tiles</span>
                  <span className="obj-value">{selected.specialTileTarget}</span>
                </li>
              )}
              <li>
                <span className="obj-icon">↺</span>
                <span className="obj-label">Move Limit</span>
                <span className="obj-value">{selected.moveLimit}</span>
              </li>
            </ul>

            {selectedThresholds && (
              <div className="valley-sheet__milestones">
                <span>★ {formatNumber(selectedThresholds[0])}</span>
                <span>★★ {formatNumber(selectedThresholds[1])}</span>
                <span>★★★ {formatNumber(selectedThresholds[2])}</span>
              </div>
            )}

            {manager.getStatus(selected.id) === 'completed' && (
              <p className="valley-sheet__best">
                ★ BEST SCORE: {selectedBest != null ? formatNumber(selectedBest) : '—'}
              </p>
            )}

            <button
              type="button"
              className="valley-sheet__play-btn focus-visible-ring"
              onClick={handlePlay}
              disabled={selectedStatus === 'locked'}
            >
              {selectedStatus === 'completed' ? 'REPLAY LEVEL' : 'START LEVEL'}
            </button>
          </div>
        </section>
      )}

      {/* ================= BOTTOM NAVIGATION SHELF (Preserved Exactly) ================= */}
      <nav className="valley-bottom-shelf" aria-label="Game navigation shelf">
        <div className="shelf-group shelf-group--left">
          {/* Active MAP Icon */}
          <button
            type="button"
            className="shelf-icon-btn shelf-icon-btn--active focus-visible-ring"
            title="World Map (Current View)"
          >
            <div className="shelf-icon-circle shelf-icon-circle--map" aria-hidden="true">
              <span>🗺️</span>
            </div>
            <span className="shelf-icon-label">MAP</span>
          </button>

          {/* PRACTICE Icon */}
          <button
            type="button"
            className="shelf-icon-btn focus-visible-ring"
            onClick={() => triggerToast('Practice Mode: Audition chords in Chord Codex', ['C', 'E', 'G'])}
            title="Practice Mode"
          >
            <div className="shelf-icon-circle shelf-icon-circle--practice" aria-hidden="true">
              <span>🎹</span>
            </div>
            <span className="shelf-icon-label">PRACTICE</span>
          </button>

          {/* JAM Icon */}
          <button
            type="button"
            className="shelf-icon-btn focus-visible-ring"
            onClick={() => triggerToast('Jam Session: Sounding Diatonic Triad', ['F', 'A', 'C'])}
            title="Jam Session"
          >
            <div className="shelf-icon-circle shelf-icon-circle--jam" aria-hidden="true">
              <span>🎤</span>
            </div>
            <span className="shelf-icon-label">JAM</span>
          </button>

          {/* CHALLENGES Icon */}
          <button
            type="button"
            className="shelf-icon-btn focus-visible-ring"
            onClick={() => triggerToast(`Campaign Frontier: Beat Level ${currentId} to advance!`)}
            title="Campaign Challenges"
          >
            <div className="shelf-icon-circle shelf-icon-circle--challenges" aria-hidden="true">
              <span>🏆</span>
            </div>
            <span className="shelf-icon-label">CHALLENGES</span>
          </button>

          {/* SHOP / CODEX Icon */}
          <button
            type="button"
            className="shelf-icon-btn focus-visible-ring"
            onClick={() => {
              playUiSound('select');
              if (onOpenCodex) onOpenCodex();
            }}
            title="Chord Codex & Guide"
          >
            <div className="shelf-icon-circle shelf-icon-circle--shop" aria-hidden="true">
              <span>🏪</span>
            </div>
            <span className="shelf-icon-label">CODEX</span>
          </button>
        </div>

        <div className="shelf-group shelf-group--right">
          {/* ACHIEVEMENTS Icon */}
          <button
            type="button"
            className="shelf-icon-btn focus-visible-ring"
            onClick={() => triggerToast(`Achievements: ${totalStars} / 18 Stars Earned`)}
            title="Achievements"
          >
            <div className="shelf-icon-circle shelf-icon-circle--achievements" aria-hidden="true">
              <span>🎖️</span>
            </div>
            <span className="shelf-icon-label">AWARDS</span>
          </button>

          {/* PROFILE Icon */}
          <button
            type="button"
            className="shelf-icon-btn focus-visible-ring"
            onClick={() => triggerToast(`Player Profile: ${completedCount} Levels Mastered`)}
            title="Player Profile"
          >
            <div className="shelf-icon-circle shelf-icon-circle--profile" aria-hidden="true">
              <span>🛡️</span>
            </div>
            <span className="shelf-icon-label">PROFILE</span>
          </button>

          {/* LEADERBOARD Icon */}
          <button
            type="button"
            className="shelf-icon-btn focus-visible-ring"
            onClick={() => triggerToast(`Leaderboard: High Score ${formatNumber(totalScore)}`)}
            title="Leaderboard"
          >
            <div className="shelf-icon-circle shelf-icon-circle--leaderboard" aria-hidden="true">
              <span>👑</span>
            </div>
            <span className="shelf-icon-label">RANKS</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
