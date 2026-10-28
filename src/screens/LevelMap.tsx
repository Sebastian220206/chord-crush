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

/** What a node announces for its state, kept here so all three read identically. */
const STATUS_LABEL: Record<LevelStatus, string> = {
  locked: 'LOCKED',
  unlocked: 'UNLOCKED',
  completed: 'COMPLETE',
};

/**
 * Progress label for the campaign header, using real data only.
 *
 * Takes the counts as arguments: this helper lives at module scope, while the
 * totals are computed inside the component from the live snapshot.
 */
function getProgressLabel(totalLevels: number, completedCount: number): string {
  if (totalLevels <= 1) return '';

  const completed = completedCount;
  const remaining = totalLevels - completed;

  if (completed === totalLevels) return 'COMPLETE';

  if (remaining === 1) return `LAST ${completed} COMPLETE`;

  return `${completed} COMPLETE`;
}

/**
 * Visual position of a node, in percentages of the world box.
 *
 * Deliberately separate from level data: the order of LEVEL_DEFINITIONS decides
 * which node is which, and this only decides where it sits. Adding levels never
 * touches level configuration.
 */
interface MapPosition {
  x: number;
  y: number;
}

/** The winding left-right pattern the path follows down the world. */
const X_PATTERN: readonly number[] = [50, 30, 68, 38, 62, 44];

/**
 * Position for the level at this index in LEVEL_DEFINITIONS order.
 *
 * Level 1 sits near the top (low y) and later levels descend toward the bottom,
 * alternating sides so the connecting path winds instead of running straight.
 */
function positionForIndex(index: number, count: number): MapPosition {
  const top = 10;
  const span = 78;
  const y = count <= 1 ? 50 : top + (index * span) / (count - 1);

  return { x: X_PATTERN[index % X_PATTERN.length], y };
}

/**
 * A smooth path through the node positions, as an SVG path string.
 *
 * Catmull-Rom to Bezier, dependency-free: the points are few and static, so a
 * tiny local helper beats pulling in a path library.
 */
function buildWindingPath(points: readonly MapPosition[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x} ${p2.y}`;
  }

  return d;
}

/**
 * Unlocks the AudioContext, then plays a UI sound.
 *
 * The map is often the first screen with real gestures, so its own clicks are a
 * good chance to unlock audio. initialize() is idempotent, so this costs
 * nothing once the game has started.
 */
function playUiSound(sound: 'select' | 'locked'): void {
  const audio = getAudioManager();

  audio.initialize();
  if (sound === 'select') audio.playSelect();
  else audio.playInvalidSwap();
}

/**
 * Renders 1..3 stars for a completed level node or sheet.
 */
function renderStars(count: number): string {
  let out = '';
  for (let i = 1; i <= 3; i++) {
    out += i <= count ? '★' : '☆';
  }
  return out;
}

/**
 * The campaign screen as a musical adventure path.
 *
 * Presentation only: unlock rules, completion storage, and level data all live
 * in ProgressionManager and LEVEL_DEFINITIONS exactly as before. This component
 * reads statuses, reports selections through onPlay, and draws nodes along a
 * winding SVG trail instead of the old rectangular list.
 */
export function LevelMap({ progression, onPlay, onBack, onOpenCodex }: LevelMapProps): ReactElement {
  const manager = progression ?? getProgressionManager();
  const totalLevels = LEVEL_DEFINITIONS.length;

  // The frontier: the highest level the player may start, clamped to the list.
  // A finished campaign leaves the unlock id one past the end, which names no
  // level, so the map points at the last one instead.
  const currentId = Math.min(manager.getHighestUnlockedLevel(), totalLevels);

  const [selectedId, setSelectedId] = useState<number | null>(currentId);
  const [lockedHint, setLockedHint] = useState<string>('');
  const [snapshot, setSnapshot] = useState(() => manager.getSnapshot());

  // The campaign can change while this screen is mounted, because a level can be
  // finished inside the Phaser canvas. Subscribing is how the map notices without
  // either side reaching into the other.
  useEffect(() => manager.subscribe(setSnapshot), [manager]);

  const selected = selectedId === null
    ? null
    : LEVEL_DEFINITIONS.find((level) => level.id === selectedId) ?? null;
  const selectedStatus = selected ? manager.getStatus(selected.id) : 'locked';

  // Never leave a locked level selected: the sheet's PLAY button would be a dead
  // end, and showing it would be a lie.
  useEffect(() => {
    if (selected !== null && manager.getStatus(selected.id) === 'locked') {
      setSelectedId(LEVEL_DEFINITIONS[0].id);
    }
  }, [manager, selected, snapshot.highestUnlockedLevel]);

  // Node elements for the initial scroll position. Plain Map, no re-render.
  const nodeRefs = useRef(new Map<number, HTMLButtonElement>());
  const didInitialScroll = useRef(false);

  // On open, position the view near the player's frontier rather than the top.
  // Once only: later progress updates must not yank the scroll out from under
  // the player.
  useEffect(() => {
    if (didInitialScroll.current) return;
    didInitialScroll.current = true;

    const target = nodeRefs.current.get(currentId);
    if (!target) return;

    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Scrolls the map container itself rather than calling scrollIntoView.
    // scrollIntoView walks up through every ancestor it is allowed to move, and
    // ancestors outside this component (the document itself) ended up scrolled
    // too. The map is the only container that is meant to move.
    const map = target.closest<HTMLElement>('.level-map');

    if (map === null) {
      target.scrollIntoView({ block: 'center' });

      return;
    }

    const targetTop =
      target.getBoundingClientRect().top - map.getBoundingClientRect().top + map.scrollTop;
    const maxScroll = map.scrollHeight - map.clientHeight;
    const centered = targetTop - map.clientHeight / 2;

    try {
      map.scrollTo({
        top: Math.max(0, Math.min(centered, maxScroll)),
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
    } catch {
      // Older browsers without the options form still get the default jump.
      map.scrollTop = Math.max(0, Math.min(centered, maxScroll));
    }
    // Only the mount matters; manager/currentId are read fresh above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc closes the info sheet and returns focus to the world.
  useEffect(() => {
    if (selected === null) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSelectedId(null);
    };

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected]);

  const handleSelect = (level: Level, status: LevelStatus): void => {
    // Audio is fired from the click handler only, never during render.
    if (status === 'locked') {
      // No popup and no navigation: the level simply does not open. The hint
      // line under the header is the whole explanation.
      playUiSound('locked');
      setLockedHint(
        level.id > 1
          ? `🔒 Level ${level.id} (${level.name}) is locked — complete Level ${level.id - 1} first!`
          : '🔒 Locked.',
      );

      return;
    }

    playUiSound('select');
    setLockedHint('');
    setSelectedId(level.id);
  };

  const handlePlay = (): void => {
    if (!selected) return;

    // Second gate. A node cannot be selected while locked, and GameScene checks
    // again, but a play button that lies is worse than a dead end.
    if (!manager.isUnlocked(selected.id)) {
      playUiSound('locked');

      return;
    }

    // No level-start sound here: GameScene plays it when it actually builds the
    // board, so the cue and the level cannot disagree.
    onPlay(selected.id);
  };

  const handleBack = (): void => {
    playUiSound('select');
    onBack();
  };

  const positions = LEVEL_DEFINITIONS.map((_, index) => positionForIndex(index, totalLevels));
  const pathD = buildWindingPath(positions);
  const unlockedPositions = positions.slice(0, Math.max(1, currentId));
  const progressPathD = buildWindingPath(unlockedPositions);

  const completedCount = snapshot.completedLevels.length;
  let totalStars = 0;
  LEVEL_DEFINITIONS.forEach((lvl) => {
    const best = snapshot.bestScores[lvl.id];
    if (best !== undefined && snapshot.completedLevels.indexOf(lvl.id) !== -1) {
      totalStars += Math.max(1, starsForScore(lvl, best));
    }
  });

  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
  const worldHeight = Math.max(540, viewportHeight - 135);

  const selectedBest = selected ? manager.getBestScore(selected.id) : null;
  const selectedStars =
    selected && selectedStatus === 'completed' && selectedBest !== null
      ? Math.max(1, starsForScore(selected, selectedBest))
      : 0;
  const selectedThresholds = selected ? starThresholdsFor(selected) : null;

  return (
    <div className="level-map">
      {/* Row above the title: navigation back to the menu + quick Chord Codex button. */}
      <div className="level-map__header-row">
        <button
          type="button"
          className="text-button text-button--primary level-map__back"
          onClick={handleBack}
        >
          &#8592; MENU
        </button>

        {onOpenCodex && (
          <button
            type="button"
            className="text-button text-button--secondary level-map__codex-btn"
            onClick={() => {
              playUiSound('select');
              onOpenCodex();
            }}
          >
            &#9835; CHORD CODEX
          </button>
        )}
      </div>

      {/* Campaign header: title and progress. */}
      <header className="adv-campaign-header">
        <div className="adv-campaign-header__title-group">
          <h1 className="adv-campaign-header__title">CHORD CRUSH</h1>
          <h2 className="adv-campaign-header__campaign">CAMPAIGN TRAIL</h2>
        </div>

        <div className="adv-campaign-header__badges">
          <p className="adv-campaign-header__progress">
            {completedCount} / {totalLevels} {getProgressLabel(totalLevels, completedCount)}
          </p>
          <p className="adv-campaign-header__stars" aria-label={`${totalStars} of ${totalLevels * 3} stars earned`}>
            ★ {totalStars} / {totalLevels * 3}
          </p>
        </div>
      </header>

      {/* Locked level hint banner */}
      {lockedHint !== '' && (
        <div className="level-map__locked-hint" role="status" aria-live="polite">
          <span>{lockedHint}</span>
          <button
            type="button"
            className="level-map__locked-dismiss"
            onClick={() => setLockedHint('')}
            aria-label="Dismiss hint"
          >
            &#10005;
          </button>
        </div>
      )}

      <div className="adv-world" style={{ height: `${worldHeight}px` }}>
        {/* The winding trail behind the nodes, drawn from the same positions. */}
        <svg
          className="adv-trail"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path className="adv-path-glow" d={pathD} vectorEffect="non-scaling-stroke" />
          <path className="adv-path-core" d={pathD} vectorEffect="non-scaling-stroke" />
          {unlockedPositions.length > 1 && (
            <path
              className="adv-path-progress"
              d={progressPathD}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {LEVEL_DEFINITIONS.map((level, index) => {
          const status = manager.getStatus(level.id);
          const position = positions[index];
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
              ref={(element) => {
                if (element) nodeRefs.current.set(level.id, element);
                else nodeRefs.current.delete(level.id);
              }}
              type="button"
              style={{ left: `${position.x}%`, top: `${position.y}%` }}
              className={
                `adv-node adv-node--${status} focus-visible-ring` +
                (isCurrent ? ' adv-node--current' : '') +
                (isSelected ? ' adv-node--selected' : '')
              }
              onClick={() => handleSelect(level, status)}
              aria-disabled={status === 'locked'}
              aria-label={`Level ${level.id}, ${level.name}, ${STATUS_LABEL[status]}`}
            >
              <span className="adv-node__face" aria-hidden="true">
                {status === 'locked' ? '' : level.id}
              </span>
              {status === 'completed' && (
                <span className="adv-node__badge" aria-hidden="true">&#10003;</span>
              )}
              {status === 'completed' && (
                <span className="adv-node__stars" aria-hidden="true">
                  {renderStars(nodeStars)}
                </span>
              )}
              {isCurrent && status !== 'completed' && (
                <span className="adv-node__play-tag" aria-hidden="true">PLAY</span>
              )}
              {status === 'locked' && (
                <span className="adv-node__lock-icon" aria-hidden="true">🔒</span>
              )}
              <span className="adv-node__caption" aria-hidden="true">
                {level.name}
              </span>
            </button>
          );
        })}
      </div>

      {selected && (
        <section className="adv-sheet" aria-label={`Level ${selected.id} information`}>
          <div className="adv-sheet__card">
            <button
              type="button"
              className="adv-sheet__close"
              onClick={() => setSelectedId(null)}
              aria-label="Close level information"
            >
              &#10005;
            </button>
            <p className="adv-sheet__eyebrow">LEVEL {selected.id} • {STATUS_LABEL[selectedStatus]}</p>
            <h2 className="adv-sheet__name">{selected.name}</h2>

            {selected.description && (
              <p className="adv-sheet__desc">{selected.description}</p>
            )}

            {selectedStatus === 'completed' ? (
              <div className="adv-sheet__stars" aria-label={`${selectedStars} of 3 stars earned`}>
                {renderStars(selectedStars)}
              </div>
            ) : (
              <div className="adv-sheet__musical-accent" aria-hidden="true">♪</div>
            )}

            <h3 className="adv-sheet__section">OBJECTIVES</h3>
            <ul className="adv-sheet__objectives">
              <li>
                <span className="adv-sheet__icon" aria-hidden="true">&#9835;</span>
                <span className="adv-sheet__label">Target Score</span>
                <span className="adv-sheet__value">{formatNumber(selected.scoreTarget)}</span>
              </li>
              {selected.chordTarget !== undefined && (
                <li>
                  <span className="adv-sheet__icon" aria-hidden="true">&#9834;</span>
                  <span className="adv-sheet__label">Diatonic Chords</span>
                  <span className="adv-sheet__value">{selected.chordTarget}</span>
                </li>
              )}
              {selected.specialTileTarget !== undefined && (
                <li>
                  <span className="adv-sheet__icon" aria-hidden="true">&#10022;</span>
                  <span className="adv-sheet__label">Special Tiles</span>
                  <span className="adv-sheet__value">{selected.specialTileTarget}</span>
                </li>
              )}
              <li>
                <span className="adv-sheet__icon" aria-hidden="true">&#8635;</span>
                <span className="adv-sheet__label">Move Limit</span>
                <span className="adv-sheet__value">{selected.moveLimit}</span>
              </li>
            </ul>

            {selectedThresholds && (
              <div className="adv-sheet__milestones">
                <span>★ {formatNumber(selectedThresholds[0])}</span>
                <span>★★ {formatNumber(selectedThresholds[1])}</span>
                <span>★★★ {formatNumber(selectedThresholds[2])}</span>
              </div>
            )}

            {manager.getStatus(selected.id) === 'completed' && (
              <p className="adv-sheet__best">
                BEST SCORE: {selectedBest != null ? formatNumber(selectedBest) : '—'}
              </p>
            )}

            <button
              type="button"
              className="adv-sheet__play"
              onClick={handlePlay}
              disabled={selectedStatus === 'locked'}
            >
              {selectedStatus === 'completed' ? 'REPLAY LEVEL' : 'PLAY LEVEL'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
