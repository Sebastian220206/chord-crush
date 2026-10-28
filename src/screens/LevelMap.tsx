import { useEffect, useRef, useState } from 'react';
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

/**
 * Positions of the 6 levels along the winding musical staff valley road.
 * Percentages (x, y) relative to the panoramic valley map.
 */
const ROAD_NODE_POSITIONS: readonly { x: number; y: number }[] = [
  { x: 50, y: 16 }, // Level 1: Distant summit near CHORD CRUSH sign
  { x: 44, y: 28 }, // Level 2: Upper hill curve
  { x: 58, y: 42 }, // Level 3: Right canyon bend near violin & cottages
  { x: 48, y: 56 }, // Level 4: Center staff curve
  { x: 38, y: 70 }, // Level 5: Lower staff curve near mossy harps & guitar
  { x: 54, y: 84 }, // Level 6: Foreground piano keyboard bridge near music town
];

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

  return (
    <div className="valley-map-screen">
      {/* ================= TOP HUD HEADER (Matching Image) ================= */}
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
            onClick={() => triggerToast('Chordy says: "Keep the rhythm flowing!"', ['C', 'E', 'G'])}
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

      {/* ================= THE VALLEY MAP CANVAS / SVG (No Background Image) ================= */}
      <div className="valley-world-container">
        <svg
          viewBox="0 0 1024 640"
          className="valley-scene-svg"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <defs>
            {/* Sunny morning sky gradient */}
            <linearGradient id="skyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ffefd5" />
              <stop offset="35%" stopColor="#ffe6c2" />
              <stop offset="70%" stopColor="#e3f2fd" />
              <stop offset="100%" stopColor="#cbe3fb" />
            </linearGradient>

            {/* Distant mountain gradient */}
            <linearGradient id="mountainGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="25%" stopColor="#d1c4e9" />
              <stop offset="60%" stopColor="#9575cd" />
              <stop offset="100%" stopColor="#673ab7" />
            </linearGradient>

            {/* Rolling green hills gradient */}
            <linearGradient id="hillsFar" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#aed581" />
              <stop offset="100%" stopColor="#689f38" />
            </linearGradient>
            <linearGradient id="hillsMid" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#81c784" />
              <stop offset="100%" stopColor="#388e3c" />
            </linearGradient>
            <linearGradient id="hillsFore" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#66bb6a" />
              <stop offset="100%" stopColor="#2e7d32" />
            </linearGradient>

            {/* 5-Line Musical Staff Road Gradient */}
            <linearGradient id="staffRoadGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fff8e7" />
              <stop offset="50%" stopColor="#f5deb3" />
              <stop offset="100%" stopColor="#e0c294" />
            </linearGradient>

            {/* Brass instrument golden sheen */}
            <linearGradient id="brassGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="30%" stopColor="#ffd54f" />
              <stop offset="70%" stopColor="#ffb300" />
              <stop offset="100%" stopColor="#ff8f00" />
            </linearGradient>

            {/* Pink guitar gradient */}
            <linearGradient id="pinkGuitarGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ff80ab" />
              <stop offset="50%" stopColor="#f50057" />
              <stop offset="100%" stopColor="#880e4f" />
            </linearGradient>

            {/* Rich cello wood gradient */}
            <linearGradient id="celloGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#d84315" />
              <stop offset="50%" stopColor="#bf360c" />
              <stop offset="100%" stopColor="#4e1b06" />
            </linearGradient>
          </defs>

          {/* Morning Sky with Golden Sun Rays */}
          <rect width="1024" height="640" fill="url(#skyGrad)" />
          <circle cx="512" cy="110" r="180" fill="rgba(255, 235, 170, 0.45)" filter="blur(20px)" />

          {/* Distant Snow-Capped Mountains */}
          <polygon points="120,260 260,110 400,260" fill="url(#mountainGrad)" />
          <polygon points="260,110 230,150 290,150" fill="#ffffff" />

          <polygon points="340,260 512,120 680,260" fill="url(#mountainGrad)" />
          <polygon points="512,120 480,160 544,160" fill="#ffffff" />

          <polygon points="620,260 760,110 900,260" fill="url(#mountainGrad)" />
          <polygon points="760,110 730,150 790,150" fill="#ffffff" />

          {/* Distant Hollywood-style "CHORD CRUSH" Mountain Sign */}
          <g filter="drop-shadow(0 4px 6px rgba(0,0,0,0.3))">
            <rect x="412" y="160" width="200" height="34" rx="6" fill="rgba(255, 248, 225, 0.85)" stroke="#d7ccc8" strokeWidth="2" />
            <text x="512" y="184" textAnchor="middle" fontFamily="sans-serif" fontWeight="900" fontSize="18" fill="#5d4037" letterSpacing="4">
              CHORD CRUSH
            </text>
          </g>

          {/* Rolling Hills Layers */}
          <path d="M 0 320 Q 240 220, 512 260 Q 780 220, 1024 320 L 1024 640 L 0 640 Z" fill="url(#hillsFar)" />
          <path d="M 0 390 Q 320 280, 600 350 Q 860 300, 1024 400 L 1024 640 L 0 640 Z" fill="url(#hillsMid)" />
          <path d="M 0 460 Q 300 380, 520 450 Q 800 400, 1024 490 L 1024 640 L 0 640 Z" fill="url(#hillsFore)" />

          {/* ================= LEFT REALM: ENCHANTED HARP FOREST ================= */}
          {/* Ancient Giant Trees */}
          <path d="M -20 640 C 20 480, 30 380, 70 300 C 110 370, 90 480, 110 640 Z" fill="#4e342e" />
          <circle cx="70" cy="270" r="60" fill="#2e7d32" opacity="0.95" />
          <circle cx="120" cy="240" r="45" fill="#388e3c" opacity="0.9" />

          {/* Stone Harps in Forest Glade */}
          <g transform="translate(90, 240) scale(0.65)" filter="drop-shadow(0 4px 8px rgba(0,0,0,0.35))">
            <path d="M 10 160 C 20 70, 70 30, 90 20 C 80 80, 90 140, 110 160 Z" fill="#b0bec5" stroke="#78909c" strokeWidth="4" />
            <line x1="30" y1="140" x2="80" y2="40" stroke="#ffd54f" strokeWidth="2" />
            <line x1="45" y1="145" x2="84" y2="60" stroke="#ffd54f" strokeWidth="2" />
            <line x1="60" y1="150" x2="88" y2="80" stroke="#ffd54f" strokeWidth="2" />
            <line x1="75" y1="155" x2="92" y2="105" stroke="#ffd54f" strokeWidth="2" />
          </g>

          <g transform="translate(170, 290) scale(0.55)" filter="drop-shadow(0 4px 8px rgba(0,0,0,0.35))">
            <path d="M 10 160 C 20 70, 70 30, 90 20 C 80 80, 90 140, 110 160 Z" fill="#90a4ae" stroke="#607d8b" strokeWidth="4" />
            <line x1="30" y1="140" x2="80" y2="40" stroke="#ffe082" strokeWidth="2" />
            <line x1="45" y1="145" x2="84" y2="60" stroke="#ffe082" strokeWidth="2" />
            <line x1="60" y1="150" x2="88" y2="80" stroke="#ffe082" strokeWidth="2" />
          </g>

          {/* Mossy Stone Musical Note Statues */}
          <g transform="translate(110, 480)" filter="drop-shadow(0 4px 6px rgba(0,0,0,0.4))">
            <ellipse cx="25" cy="40" rx="18" ry="12" fill="#78909c" transform="rotate(-20, 25, 40)" />
            <rect x="36" y="8" width="6" height="34" fill="#78909c" />
            <path d="M 36 8 C 50 12, 54 26, 42 32" fill="#546e7a" />
            <circle cx="20" cy="38" r="6" fill="#81c784" opacity="0.6" /> {/* Moss */}
          </g>

          {/* ================= CENTER MEADOW: GIANT GUITAR & CELLO ================= */}
          {/* Giant Pink Acoustic Guitar */}
          <g transform="translate(330, 240) rotate(-14) scale(0.75)" filter="drop-shadow(0 8px 12px rgba(0,0,0,0.4))">
            <ellipse cx="50" cy="140" rx="42" ry="50" fill="url(#pinkGuitarGrad)" />
            <ellipse cx="50" cy="70" rx="32" ry="36" fill="url(#pinkGuitarGrad)" />
            <circle cx="50" cy="100" r="14" fill="#212121" />
            <rect x="46" y="-50" width="8" height="120" fill="#d7ccc8" />
            <polygon points="42,-50 58,-50 56,-75 44,-75" fill="#f8bbd0" />
          </g>

          {/* Deep Cello / Violin leaning near canyon */}
          <g transform="translate(590, 390) rotate(18) scale(0.7)" filter="drop-shadow(0 8px 12px rgba(0,0,0,0.4))">
            <ellipse cx="50" cy="130" rx="38" ry="48" fill="url(#celloGrad)" />
            <ellipse cx="50" cy="65" rx="28" ry="32" fill="url(#celloGrad)" />
            <circle cx="50" cy="95" r="10" fill="#111111" />
            <rect x="47" y="-40" width="6" height="110" fill="#212121" />
            <polygon points="43,-40 57,-40 55,-60 45,-60" fill="#3e2723" />
          </g>

          {/* ================= RIGHT REALM: BRASS INSTRUMENT TOWN ================= */}
          {/* Town Houses */}
          <g transform="translate(730, 360)">
            <rect x="0" y="40" width="60" height="70" fill="#e57373" stroke="#b71c1c" strokeWidth="2" />
            <polygon points="-5,40 30,10 65,40" fill="#c62828" />

            <rect x="70" y="20" width="80" height="90" fill="#fff9c4" stroke="#fbc02d" strokeWidth="2" />
            <polygon points="65,20 110,-10 155,20" fill="#b0bec5" />
          </g>

          {/* Giant Brass Horns Rising as Town Towers */}
          <g transform="translate(750, 180) scale(0.85)" filter="drop-shadow(0 6px 12px rgba(0,0,0,0.35))">
            <path d="M 20 180 C 20 100, 35 60, 50 40 C 65 20, 95 10, 120 5 L 120 40 C 95 40, 65 60, 50 180 Z" fill="url(#brassGrad)" />
            <ellipse cx="120" cy="22" rx="14" ry="22" fill="#ff6f00" />
          </g>

          <g transform="translate(890, 240) scale(0.95)" filter="drop-shadow(0 6px 12px rgba(0,0,0,0.35))">
            <path d="M 20 180 C 20 110, 40 70, 60 50 C 85 30, 110 20, 135 15 L 135 50 C 105 50, 75 75, 55 180 Z" fill="url(#brassGrad)" />
            <ellipse cx="135" cy="32" rx="16" ry="24" fill="#ff6f00" />
          </g>

          {/* ================= CENTRAL WINDING 5-LINE STAFF ROAD ================= */}
          {/* Canyon depth shadow */}
          <path
            d="M 512 190 Q 420 280, 580 370 Q 640 430, 480 500 Q 340 560, 560 640 L 640 640 Q 420 560, 560 500 Q 720 430, 660 370 Q 500 280, 560 190 Z"
            fill="rgba(58, 36, 18, 0.45)"
          />

          {/* Elevated Winding Highway Surface */}
          <path
            d="M 512 190 Q 420 280, 580 370 Q 640 430, 480 500 Q 340 560, 560 640"
            fill="none"
            stroke="url(#staffRoadGrad)"
            strokeWidth="56"
            strokeLinecap="round"
          />

          {/* 5-Line Musical Staff Lines running along the road */}
          <path
            d="M 512 190 Q 420 280, 580 370 Q 640 430, 480 500 Q 340 560, 560 640"
            fill="none"
            stroke="#8d6e63"
            strokeWidth="42"
            strokeDasharray="4 6"
            opacity="0.3"
          />
          <path
            d="M 512 190 Q 420 280, 580 370 Q 640 430, 480 500 Q 340 560, 560 640"
            fill="none"
            stroke="#5d4037"
            strokeWidth="2"
          />
          <path
            d="M 512 190 Q 420 280, 580 370 Q 640 430, 480 500 Q 340 560, 560 640"
            fill="none"
            stroke="#5d4037"
            strokeWidth="10"
            strokeDasharray="2 8"
          />

          {/* Foreground Piano Keyboard Road Border */}
          <g transform="translate(480, 530) rotate(-12)" opacity="0.9">
            <rect x="0" y="0" width="130" height="34" rx="4" fill="#ffffff" stroke="#212121" strokeWidth="2" />
            <line x1="20" y1="0" x2="20" y2="34" stroke="#212121" strokeWidth="2" />
            <line x1="40" y1="0" x2="40" y2="34" stroke="#212121" strokeWidth="2" />
            <line x1="60" y1="0" x2="60" y2="34" stroke="#212121" strokeWidth="2" />
            <line x1="80" y1="0" x2="80" y2="34" stroke="#212121" strokeWidth="2" />
            <line x1="100" y1="0" x2="100" y2="34" stroke="#212121" strokeWidth="2" />
            {/* Black keys */}
            <rect x="12" y="0" width="12" height="20" fill="#212121" />
            <rect x="32" y="0" width="12" height="20" fill="#212121" />
            <rect x="72" y="0" width="12" height="20" fill="#212121" />
            <rect x="92" y="0" width="12" height="20" fill="#212121" />
          </g>
        </svg>

        {/* ================= INTERACTIVE LEVEL NODES ON THE ROAD ================= */}
        <div className="valley-nodes-layer">
          {LEVEL_DEFINITIONS.map((level, index) => {
            const status = manager.getStatus(level.id);
            const pos = ROAD_NODE_POSITIONS[index] ?? { x: 50, y: 50 };
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
                  `valley-node valley-node--${status} focus-visible-ring` +
                  (isCurrent ? ' valley-node--current' : '') +
                  (isSelected ? ' valley-node--selected' : '')
                }
                onClick={() => handleSelect(level, status)}
                aria-disabled={status === 'locked'}
                aria-label={`Level ${level.id}, ${level.name}, ${STATUS_LABEL[status]}`}
              >
                <span className="valley-node__disc">
                  {status === 'locked' ? (
                    <span className="valley-node__lock-icon" aria-hidden="true">🔒</span>
                  ) : (
                    <span className="valley-node__num">{level.id}</span>
                  )}
                </span>

                {status === 'completed' && (
                  <span className="valley-node__check" aria-hidden="true">✓</span>
                )}

                {status === 'completed' && (
                  <span className="valley-node__stars-badge" aria-hidden="true">
                    {renderStars(nodeStars)}
                  </span>
                )}

                {isCurrent && status !== 'completed' && (
                  <span className="valley-node__play-badge" aria-hidden="true">PLAY</span>
                )}

                <span className="valley-node__tooltip">{level.name}</span>
              </button>
            );
          })}
        </div>
      </div>

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

      {/* ================= BOTTOM NAVIGATION SHELF (Matching Image) ================= */}
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
