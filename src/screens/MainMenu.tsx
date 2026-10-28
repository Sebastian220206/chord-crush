import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { getAudioManager } from '../audio/AudioManager';
import { getSettingsManager } from '../app/SettingsManager';
import { getProgressionManager } from '../levels/ProgressionManager';
import { LEVEL_DEFINITIONS } from '../levels/LevelManager';
import { formatNumber, starsForScore } from '../levels/ObjectiveEngine';
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
 * Handcrafted cosmic musical landing screen replicating the artwork:
 * - Animated canvas galaxy & starfield
 * - Grand 5-line musical staff portal arch with glowing notes & sunburst
 * - 3D golden Chord Crush typography with glowing neon heart
 * - Ornate filigree START ADVENTURE and LEARN MORE buttons with ruby gems
 * - Cosmic Conductor with swirling stardust wand trail
 * - Enchanted Speaker Tree with vinyl turntable & speaker cabinets
 * - Floating sky islands with Grand Piano and electronic synth
 * - Interactive foreground instruments with Web Audio feedback
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

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [, setSnapshot] = useState(() => manager.getSnapshot());
  const [muted, setMuted] = useState(() => settings.getMuted());
  const [activeNoteHint, setActiveNoteHint] = useState<string>('');

  useEffect(() => manager.subscribe(setSnapshot), [manager]);
  useEffect(
    () =>
      settings.subscribe((next) => {
        setMuted(next.muted);
      }),
    [settings]
  );

  // Animated cosmic canvas: swirling spiral galaxy, starfield, and floating stardust
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const onResize = (): void => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', onResize);

    // Stars
    const starCount = 140;
    const stars = Array.from({ length: starCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 2 + 0.5,
      alpha: Math.random() * 0.8 + 0.2,
      speed: Math.random() * 0.02 + 0.005,
      color: ['#ffffff', '#ffd166', '#7be0d0', '#ff8fab', '#c792ea'][Math.floor(Math.random() * 5)],
    }));

    // Swirling nebula particles in top-left
    let angle = 0;

    const render = (): void => {
      ctx.clearRect(0, 0, width, height);

      // Deep space background gradient
      const bgGrad = ctx.createRadialGradient(
        width * 0.5,
        height * 0.45,
        width * 0.1,
        width * 0.5,
        height * 0.5,
        width * 0.9
      );
      bgGrad.addColorStop(0, '#1c0c3b');
      bgGrad.addColorStop(0.45, '#120728');
      bgGrad.addColorStop(0.85, '#0a0316');
      bgGrad.addColorStop(1, '#05010c');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // Top-left swirling galaxy
      const gx = width * 0.18;
      const gy = height * 0.22;
      const galaxyGrad = ctx.createRadialGradient(gx, gy, 5, gx, gy, width * 0.22);
      galaxyGrad.addColorStop(0, 'rgba(255, 235, 170, 0.45)');
      galaxyGrad.addColorStop(0.2, 'rgba(215, 130, 245, 0.32)');
      galaxyGrad.addColorStop(0.5, 'rgba(74, 158, 255, 0.18)');
      galaxyGrad.addColorStop(0.8, 'rgba(30, 10, 60, 0.05)');
      galaxyGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = galaxyGrad;
      ctx.beginPath();
      ctx.arc(gx, gy, width * 0.22, 0, Math.PI * 2);
      ctx.fill();

      // Galaxy spiral arms
      angle += 0.004;
      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(angle);
      for (let arm = 0; arm < 2; arm++) {
        ctx.save();
        ctx.rotate(arm * Math.PI);
        for (let i = 0; i < 40; i++) {
          const dist = i * 4.2;
          const a = (i * 0.18);
          const px = Math.cos(a) * dist;
          const py = Math.sin(a) * dist * 0.65;
          ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 209, 102, 0.7)' : 'rgba(123, 224, 208, 0.6)';
          ctx.beginPath();
          ctx.arc(px, py, Math.random() * 2 + 1, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      ctx.restore();

      // Twinkling stars
      for (const s of stars) {
        s.alpha += s.speed;
        if (s.alpha > 1 || s.alpha < 0.2) s.speed = -s.speed;
        ctx.fillStyle = s.color;
        ctx.globalAlpha = Math.max(0.1, Math.min(1, s.alpha));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(animId);
    };
  }, []);

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
    audio.playChord(['C', 'E', 'G']);
    if (onPlay) onPlay(currentId);
    else onLevels();
  };

  const handleLearnMore = (): void => {
    beginTurn();
    if (onOpenCodex) onOpenCodex('guide');
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
    if (!nextMuted) audio.initialize();
    settings.setMuted(nextMuted);
    if (!nextMuted) audio.playSelect();
  };

  // Interactive Musical Instruments
  const soundInstrument = (label: string, notes: NoteName[]): void => {
    audio.initialize();
    audio.playChord(notes);
    setActiveNoteHint(label);
    setTimeout(() => setActiveNoteHint(''), 2200);
  };

  return (
    <div className="main-menu main-menu--celestial">
      {/* Background Animated Canvas (Galaxy, Stars, Nebula) */}
      <canvas ref={canvasRef} className="celestial-canvas" aria-hidden="true" />

      {/* Sleek Top Studio Navbar */}
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

      {/* Floating note readout toast */}
      {activeNoteHint && (
        <div className="celestial-toast" role="status" aria-live="polite">
          <span>♫ {activeNoteHint} ♫</span>
        </div>
      )}

      {/* Main Celestial Stage */}
      <main className="celestial-stage">
        {/* ===================== LEFT SIDE: COSMIC CONDUCER ===================== */}
        <div className="stage-side stage-side--left">
          {/* Swirling celestial stardust staff ribbon */}
          <div className="conductor-aura" aria-hidden="true">
            <svg viewBox="0 0 200 240" className="conductor-ribbon-svg">
              <path
                d="M 40 220 C 60 140, 140 100, 160 30 C 170 10, 190 20, 175 50 C 150 90, 80 160, 40 220"
                fill="none"
                stroke="url(#stardustGrad)"
                strokeWidth="4"
                strokeDasharray="6 4"
                className="stardust-trail"
              />
              <defs>
                <linearGradient id="stardustGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#7be0d0" stopOpacity="0.2" />
                  <stop offset="50%" stopColor="#ffd166" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#ff4fd8" stopOpacity="0.9" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          {/* Celestial Maestro silhouette */}
          <button
            type="button"
            className="cosmic-conductor-btn focus-visible-ring"
            onClick={() => soundInstrument('The Cosmic Maestro plays A Minor Arpeggio', ['A', 'C', 'E'])}
            title="Tap the Maestro to conduct celestial harmony"
            aria-label="Cosmic Maestro (Tap to conduct harmony)"
          >
            <svg viewBox="0 0 160 220" className="maestro-svg" aria-hidden="true">
              {/* Flowing starcoat */}
              <path
                d="M 80 30 C 85 45, 95 65, 110 80 C 135 110, 150 160, 130 210 C 110 200, 95 180, 85 160 C 75 185, 55 205, 30 210 C 20 170, 35 120, 60 80 C 70 65, 75 45, 80 30 Z"
                fill="url(#maestroGrad)"
              />
              {/* Star-nebula hair and head */}
              <circle cx="80" cy="22" r="14" fill="#ffdf9e" />
              <path
                d="M 70 12 C 55 10, 40 25, 45 35 C 50 30, 65 32, 70 26 Z"
                fill="#7be0d0"
              />
              {/* Conducting arm & baton */}
              <path
                d="M 95 70 Q 120 50, 140 20"
                stroke="#ffe494"
                strokeWidth="3.5"
                strokeLinecap="round"
                fill="none"
              />
              {/* Wand tip sparkle */}
              <circle cx="140" cy="20" r="4" fill="#ffffff" className="wand-sparkle" />

              <defs>
                <linearGradient id="maestroGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#301557" />
                  <stop offset="40%" stopColor="#251e6b" />
                  <stop offset="80%" stopColor="#4a9eff" />
                  <stop offset="100%" stopColor="#7be0d0" />
                </linearGradient>
              </defs>
            </svg>
            <span className="element-label">COSMIC MAESTRO</span>
          </button>

          {/* Foreground Instruments: Guitar, Vinyl, French Horn, Drum */}
          <div className="left-instrument-cluster">
            <button
              type="button"
              className="instrument-chip focus-visible-ring"
              onClick={() => soundInstrument('Acoustic Guitar · E Minor Triad', ['E', 'G', 'B'])}
              title="Acoustic Guitar"
            >
              <span className="instrument-chip__icon" aria-hidden="true">🎸</span>
              <span className="instrument-chip__name">Guitar</span>
            </button>
            <button
              type="button"
              className="instrument-chip focus-visible-ring"
              onClick={() => soundInstrument('Brass French Horn · G Major Triad', ['G', 'B', 'D'])}
              title="French Horn"
            >
              <span className="instrument-chip__icon" aria-hidden="true">📯</span>
              <span className="instrument-chip__name">Horn</span>
            </button>
            <button
              type="button"
              className="instrument-chip focus-visible-ring"
              onClick={() => soundInstrument('Cosmic Synth · F Major Triad', ['F', 'A', 'C'])}
              title="Cosmic Synth"
            >
              <span className="instrument-chip__icon" aria-hidden="true">🎹</span>
              <span className="instrument-chip__name">Synth</span>
            </button>
          </div>
        </div>

        {/* ===================== CENTER: THE GRAND MUSICAL PORTAL ===================== */}
        <div className="portal-centerpiece">
          {/* SVG Grand Musical Staff Arch */}
          <div className="arch-monument">
            <svg
              viewBox="0 0 540 620"
              className="arch-svg"
              aria-hidden="true"
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                {/* Golden staff gradient */}
                <linearGradient id="goldStaffGrad" x1="0%" y1="100%" x2="0%" y2="0%">
                  <stop offset="0%" stopColor="#e5a72e" />
                  <stop offset="40%" stopColor="#ffd166" />
                  <stop offset="70%" stopColor="#ffe79e" />
                  <stop offset="100%" stopColor="#ffffff" />
                </linearGradient>

                {/* Inner portal cosmic radiance */}
                <radialGradient id="portalRadiance" cx="50%" cy="45%" r="50%">
                  <stop offset="0%" stopColor="rgba(255, 235, 175, 0.35)" />
                  <stop offset="35%" stopColor="rgba(199, 146, 234, 0.25)" />
                  <stop offset="70%" stopColor="rgba(74, 158, 255, 0.15)" />
                  <stop offset="100%" stopColor="rgba(16, 8, 38, 0.9)" />
                </radialGradient>

                {/* Crystal gradients */}
                <linearGradient id="crystalCyan" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="40%" stopColor="#7be0d0" />
                  <stop offset="100%" stopColor="#226b80" />
                </linearGradient>
                <linearGradient id="crystalMagenta" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="40%" stopColor="#ff8fab" />
                  <stop offset="100%" stopColor="#80224d" />
                </linearGradient>
                <linearGradient id="crystalGold" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="45%" stopColor="#ffd166" />
                  <stop offset="100%" stopColor="#805600" />
                </linearGradient>
              </defs>

              {/* Portal Inner Radiance Background */}
              <path
                d="M 120 520 L 120 280 A 150 150 0 0 1 420 280 L 420 520 Z"
                fill="url(#portalRadiance)"
              />

              {/* Sunburst rays inside arch */}
              <g stroke="rgba(255, 209, 102, 0.18)" strokeWidth="1.5" strokeDasharray="4 8">
                <line x1="270" y1="280" x2="140" y2="160" />
                <line x1="270" y1="280" x2="200" y2="120" />
                <line x1="270" y1="280" x2="270" y2="100" />
                <line x1="270" y1="280" x2="340" y2="120" />
                <line x1="270" y1="280" x2="400" y2="160" />
              </g>

              {/* 5-Line Musical Staff Arch (Outermost to Innermost) */}
              <path
                d="M 90 530 L 90 270 A 180 180 0 0 1 450 270 L 450 530"
                fill="none"
                stroke="url(#goldStaffGrad)"
                strokeWidth="4"
                className="portal-staff-line"
              />
              <path
                d="M 98 530 L 98 270 A 172 172 0 0 1 442 270 L 442 530"
                fill="none"
                stroke="url(#goldStaffGrad)"
                strokeWidth="2.5"
                className="portal-staff-line"
              />
              <path
                d="M 106 530 L 106 270 A 164 164 0 0 1 434 270 L 434 530"
                fill="none"
                stroke="url(#goldStaffGrad)"
                strokeWidth="3.5"
                className="portal-staff-line"
              />
              <path
                d="M 114 530 L 114 270 A 156 156 0 0 1 426 270 L 426 530"
                fill="none"
                stroke="url(#goldStaffGrad)"
                strokeWidth="2.5"
                className="portal-staff-line"
              />
              <path
                d="M 122 530 L 122 270 A 148 148 0 0 1 418 270 L 418 530"
                fill="none"
                stroke="url(#goldStaffGrad)"
                strokeWidth="4"
                className="portal-staff-line"
              />

              {/* Golden musical notes perched on the arch */}
              <g fill="#ffd166" filter="drop-shadow(0 0 8px #ffd166)">
                <text x="145" y="210" fontSize="24" fontFamily="serif">&#9834;</text>
                <text x="195" y="145" fontSize="26" fontFamily="serif">&#9835;</text>
                <text x="260" y="115" fontSize="28" fontFamily="serif">&#9834;</text>
                <text x="330" y="145" fontSize="26" fontFamily="serif">&#9835;</text>
                <text x="380" y="210" fontSize="24" fontFamily="serif">&#9834;</text>
              </g>

              {/* Winding Musical Cobblestone Path leading in */}
              <path
                d="M 230 600 Q 250 540, 260 510 Q 268 470, 270 450"
                fill="none"
                stroke="#ffd166"
                strokeWidth="2"
                strokeDasharray="4 6"
              />
              <path
                d="M 310 600 Q 290 540, 280 510 Q 272 470, 270 450"
                fill="none"
                stroke="#ffd166"
                strokeWidth="2"
                strokeDasharray="4 6"
              />

              {/* Prismatic Crystal Spires at Portal Base - Left side */}
              <g className="crystal-cluster crystal-cluster--left">
                <polygon points="70,530 85,420 100,530" fill="url(#crystalCyan)" />
                <polygon points="95,530 110,400 125,530" fill="url(#crystalMagenta)" />
                <polygon points="120,530 132,440 144,530" fill="url(#crystalGold)" />
                <polygon points="50,530 65,460 80,530" fill="url(#crystalMagenta)" opacity="0.8" />
              </g>

              {/* Prismatic Crystal Spires at Portal Base - Right side */}
              <g className="crystal-cluster crystal-cluster--right">
                <polygon points="396,530 408,440 420,530" fill="url(#crystalGold)" />
                <polygon points="415,530 430,400 445,530" fill="url(#crystalCyan)" />
                <polygon points="440,530 455,420 470,530" fill="url(#crystalMagenta)" />
                <polygon points="460,530 475,460 490,530" fill="url(#crystalCyan)" opacity="0.8" />
              </g>
            </svg>

            {/* Portal Content: Logo + Buttons nestled in the gateway */}
            <div className="portal-interior">
              {/* 3D Golden Logo */}
              <div className="chord-crush-logo-3d">
                <div className="logo-line-chord">
                  <span className="logo-chord-text">Chord</span>
                  <span className="logo-heart-gem" aria-hidden="true">&#9825;</span>
                </div>
                <div className="logo-line-crush">
                  <span className="logo-crush-text">Crush</span>
                </div>
                <p className="logo-tagline">MATCH NOTES · VOICE CHORDS · MASTER THE STAFF</p>
              </div>

              {/* Ornate Gemstone Action Buttons */}
              <div className="portal-buttons-stack">
                <button
                  type="button"
                  className="ornate-gem-btn ornate-gem-btn--primary focus-visible-ring"
                  onClick={handleStartAdventure}
                  aria-label="Start Adventure"
                >
                  <span className="gem-ruby gem-ruby--left" aria-hidden="true" />
                  <span className="gem-btn-label">START ADVENTURE</span>
                  <span className="gem-ruby gem-ruby--right" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  className="ornate-gem-btn ornate-gem-btn--secondary focus-visible-ring"
                  onClick={handleLearnMore}
                  aria-label="Learn More (How to Play)"
                >
                  <span className="gem-btn-label">LEARN MORE</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ===================== RIGHT SIDE: SPEAKER TREE & FLOATING ISLANDS ===================== */}
        <div className="stage-side stage-side--right">
          {/* Floating Sky Islands */}
          <div className="floating-islands-group">
            {/* Grand Piano Island */}
            <button
              type="button"
              className="sky-island sky-island--piano focus-visible-ring"
              onClick={() => soundInstrument('Floating Grand Piano · C Major Chord', ['C', 'E', 'G'])}
              title="Grand Piano Island (Tap to play C Major)"
              aria-label="Grand Piano Island"
            >
              <div className="island-rock" aria-hidden="true">
                <span className="island-instrument">🎹</span>
              </div>
              <span className="island-tag">GRAND PIANO</span>
            </button>

            {/* Electronic Synth Island */}
            <button
              type="button"
              className="sky-island sky-island--synth focus-visible-ring"
              onClick={() => soundInstrument('Skyline Synth · D Minor Chord', ['D', 'F', 'A'])}
              title="Sky Synth Island (Tap to play D Minor)"
              aria-label="Skyline Synthesizer Island"
            >
              <div className="island-rock" aria-hidden="true">
                <span className="island-instrument">🎛️</span>
              </div>
              <span className="island-tag">SYNTH LAB</span>
            </button>
          </div>

          {/* Enchanted Speaker & Turntable Tree */}
          <button
            type="button"
            className="speaker-tree-btn focus-visible-ring"
            onClick={() => soundInstrument('Enchanted Speaker Tree · Treble Clef Chime', ['C', 'G', 'C'])}
            title="Enchanted Gramophone Tree (Tap to play vinyl chime)"
            aria-label="Enchanted Speaker Tree"
          >
            <svg viewBox="0 0 160 230" className="tree-svg" aria-hidden="true">
              {/* Ancient curved trunk */}
              <path
                d="M 60 230 C 50 180, 80 150, 75 110 C 65 80, 50 70, 40 50 C 60 55, 80 60, 95 40 C 105 70, 95 100, 110 130 C 120 170, 110 200, 125 230 Z"
                fill="url(#treeTrunkGrad)"
              />
              {/* Speaker cabinets in branches */}
              <rect x="25" y="60" width="28" height="34" rx="4" fill="#6d4c41" stroke="#3e2723" strokeWidth="2" />
              <circle cx="39" cy="74" r="8" fill="#212121" />
              <circle cx="39" cy="85" r="4" fill="#212121" />

              <rect x="105" y="65" width="28" height="34" rx="4" fill="#6d4c41" stroke="#3e2723" strokeWidth="2" />
              <circle cx="119" cy="79" r="8" fill="#212121" />
              <circle cx="119" cy="90" r="4" fill="#212121" />

              {/* Foliage canopy */}
              <circle cx="50" cy="40" r="26" fill="#2e7d32" opacity="0.85" />
              <circle cx="85" cy="30" r="30" fill="#388e3c" opacity="0.9" />
              <circle cx="115" cy="45" r="24" fill="#2e7d32" opacity="0.85" />

              {/* Embedded vinyl record player in trunk */}
              <rect x="62" y="130" width="36" height="36" rx="4" fill="#8d6e63" stroke="#4e342e" strokeWidth="2" />
              <circle cx="80" cy="148" r="14" fill="#111111" />
              <circle cx="80" cy="148" r="5" fill="#ffd166" />
              {/* Glowing Treble Clef above player */}
              <text x="73" y="122" fontSize="22" fill="#ffd166" filter="drop-shadow(0 0 6px #ffd166)">𝄞</text>

              <defs>
                <linearGradient id="treeTrunkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#4e342e" />
                  <stop offset="50%" stopColor="#3e2723" />
                  <stop offset="100%" stopColor="#271c19" />
                </linearGradient>
              </defs>
            </svg>
            <span className="element-label">SPEAKER TREE</span>
          </button>
        </div>
      </main>

      {/* Floating Bottom Campaign Hub Dock */}
      <footer className="celestial-dock">
        <div className="celestial-dock__inner">
          <button
            type="button"
            className="celestial-chip-btn focus-visible-ring"
            onClick={handleLevels}
          >
            ★ LEVEL MAP ({completedCount}/{totalLevels})
          </button>

          <div className="celestial-stats">
            <span className="stat-pill">★ {totalStars} / {maxStars} STARS</span>
            <span className="stat-pill">BEST: {formatNumber(totalBestScore)}</span>
            <span className="stat-pill stat-pill--current">
              {campaignDone
                ? 'CAMPAIGN COMPLETE'
                : `LEVEL ${currentId}: ${currentLevel?.name ?? ''}`}
            </span>
          </div>

          {onOpenCodex && (
            <button
              type="button"
              className="celestial-chip-btn focus-visible-ring"
              onClick={() => handleCodex('codex')}
            >
              ♫ CHORD CODEX
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
