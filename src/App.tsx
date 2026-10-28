import { useEffect, useRef, useState } from 'react';
import { createGame } from './game/Game';
import { getGameBridge } from './game/GameBridge';
import { getSettingsManager } from './app/SettingsManager';
import { LevelMap } from './screens/LevelMap';
import { MainMenu } from './screens/MainMenu';
import { SettingsPanel } from './screens/SettingsPanel';
import { ChordCodexModal } from './screens/ChordCodexModal';
import type { CodexTab } from './screens/ChordCodexModal';
import './styles/app.css';

export default function App() {
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const bridge = getGameBridge();
  // Constructed before any state is read, so the stored audio settings are applied
  // to the AudioManager before the first value is displayed.
  getSettingsManager();

  const [screen, setScreen] = useState(() => bridge.getScreen());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [codexTab, setCodexTab] = useState<CodexTab | null>(null);
  const [gameError, setGameError] = useState<string | null>(null);

  useEffect(() => bridge.onScreenChange(setScreen), [bridge]);

  useEffect(() => {
    if (!gameContainerRef.current) return;

    try {
      const game = createGame(gameContainerRef.current);
      bridge.attachGame(game);

      return () => {
        bridge.attachGame(null);
        game.destroy(true);
      };
    } catch (error) {
      // A browser that cannot run Phaser should still show the shell rather than a
      // blank page, so the failure is surfaced instead of thrown.
      console.error('Phaser failed to start', error);
      setGameError('The game could not be started in this browser.');
    }
  }, [bridge]);

  const handlePlay = (levelId: number) => {
    setSettingsOpen(false);
    setCodexTab(null);
    bridge.playLevel(levelId);
  };

  const handleLevels = () => {
    setSettingsOpen(false);
    setCodexTab(null);
    bridge.showLevelMap();
  };

  const handleSettings = () => {
    setSettingsOpen(true);
  };

  const handleCloseSettings = () => {
    setSettingsOpen(false);
  };

  const handleMenu = () => {
    // The shell only asks; the scene decides whether a pause is possible right now.
    bridge.requestPause();
  };

  const handleHint = () => {
    bridge.requestHint();
  };

  return (
    <div className={screen === 'level-map' ? 'app app--level-map' : 'app'}>
      {/*
        The canvas stays mounted on every screen. Unmounting it would destroy the
        Phaser game and the attempt it is holding, so the other screens hide it with
        display:none and the bridge stops the render loop instead.
      */}
      <div className={`app__game${screen === 'game' ? '' : ' app__game--hidden'}`}>
        <div ref={gameContainerRef} id="game-container" className="app__canvas" />

        {screen === 'game' && (
          /*
            The shell's controls over the canvas, parked in a bottom dock
            that the Phaser scene reserves room for, so no button can ever
            cover the board.
          */
          <div className="app__dock">
            <div className="app__dock-inner">
              <button
                type="button"
                className="app__dock-button"
                onClick={handleHint}
                title="Highlight a valid move (Shortcut: H)"
              >
                HINT
              </button>
              <button
                type="button"
                className="app__dock-button"
                onClick={() => setCodexTab('codex')}
                title="Open Chord Codex & Guide"
              >
                CODEX
              </button>
              <button type="button" className="app__dock-button" onClick={handleSettings}>
                SETTINGS
              </button>
              <button
                type="button"
                className="app__dock-button app__dock-button--primary"
                onClick={handleMenu}
              >
                MENU
              </button>
            </div>
          </div>
        )}
      </div>

      {screen === 'menu' && (
        <MainMenu
          onLevels={handleLevels}
          onSettings={handleSettings}
          onPlay={handlePlay}
          onOpenCodex={(tab) => setCodexTab(tab)}
        />
      )}

      {screen === 'level-map' && (
        <LevelMap
          onPlay={handlePlay}
          onBack={() => bridge.showMenu()}
          onOpenCodex={() => setCodexTab('codex')}
        />
      )}

      {settingsOpen && <SettingsPanel onClose={handleCloseSettings} />}

      {codexTab !== null && (
        <ChordCodexModal initialTab={codexTab} onClose={() => setCodexTab(null)} />
      )}

      {gameError && (
        <div className="app__error" role="alert">
          {gameError}
        </div>
      )}
    </div>
  );
}
