import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { getSettingsManager } from '../app/SettingsManager';
import { getAudioManager } from '../audio/AudioManager';
import { getProgressionManager } from '../levels/ProgressionManager';

export interface SettingsPanelProps {
  onClose: () => void;
}

/**
 * The settings overlay: sound on/off, master volume, audio test, and campaign reset.
 *
 * Deliberately minimal. Every value is read from and written to the SettingsManager,
 * which is a thin wrapper over the one AudioManager, so there is never a second mute
 * or volume to keep in step. The panel holds no audio state of its own.
 */
export function SettingsPanel({ onClose }: SettingsPanelProps): ReactElement {
  const settings = getSettingsManager();
  const audio = getAudioManager();
  const progression = getProgressionManager();

  const [muted, setMuted] = useState(() => settings.getMuted());
  const [volume, setVolume] = useState(() => settings.getMasterVolume());
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  // The settings can change from elsewhere (the shell's own sound toggle), so the
  // panel follows the manager rather than assuming it is the only writer.
  useEffect(
    () =>
      settings.subscribe((next) => {
        setMuted(next.muted);
        setVolume(next.masterVolume);
      }),
    [settings],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleMuted = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.checked;

    // Turning sound on is a user gesture, so it is the one moment audio can be
    // safely unlocked from outside the game canvas.
    if (next) audio.initialize();

    settings.setMuted(!next);
  };

  const handleVolume = (event: React.ChangeEvent<HTMLInputElement>) => {
    settings.setMasterVolume(Number(event.target.value));
  };

  const handleTestAudio = () => {
    audio.initialize();
    if (settings.getMuted()) {
      settings.setMuted(false);
    }
    audio.playChord(['C', 'E', 'G']);
  };

  const handleResetCampaign = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setResetDone(false);
      return;
    }

    progression.resetProgress();
    setConfirmReset(false);
    setResetDone(true);
    audio.initialize();
    audio.playSelect();
  };

  return (
    <div
      className="settings"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="settings__panel">
        <header className="settings__row settings__header">
          <h2 className="settings__title">SETTINGS</h2>
        </header>

        <label className="settings__row">
          <span className="settings__label" id="settings-sound-label">
            SOUND
          </span>
          <input
            type="checkbox"
            className="settings__switch"
            checked={!muted}
            onChange={handleMuted}
            aria-labelledby="settings-sound-label"
          />
          <span className="settings__value" aria-hidden="true">
            {muted ? 'OFF' : 'ON'}
          </span>
        </label>

        <label className="settings__row">
          <span className="settings__label" id="settings-volume-label">
            MASTER VOLUME
          </span>
          <input
            type="range"
            className="settings__slider"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={handleVolume}
            aria-labelledby="settings-volume-label"
            aria-valuetext={`${Math.round(volume * 100)} percent`}
          />
          <span className="settings__value" aria-hidden="true">
            {Math.round(volume * 100)}%
          </span>
        </label>

        <div className="settings__actions">
          <button
            type="button"
            className="text-button text-button--secondary settings__action-btn"
            onClick={handleTestAudio}
          >
            &#9835; TEST AUDIO (C MAJOR)
          </button>

          <button
            type="button"
            className={
              'text-button settings__action-btn ' +
              (confirmReset ? 'settings__action-btn--danger' : 'text-button--secondary')
            }
            onClick={handleResetCampaign}
          >
            {confirmReset
              ? 'CONFIRM RESET CAMPAIGN?'
              : resetDone
                ? '✓ CAMPAIGN RESET'
                : 'RESET CAMPAIGN PROGRESS'}
          </button>
        </div>

        <button type="button" className="menu-button settings__close" onClick={onClose}>
          CLOSE
        </button>
      </div>
    </div>
  );
}
