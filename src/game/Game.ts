import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { GameScene } from './scenes/GameScene';

export function createGame(parentElement: HTMLElement): Phaser.Game {
  const parentRect = parentElement.getBoundingClientRect();
  let width = Math.floor(parentRect.width);
  let height = Math.floor(parentRect.height);

  /*
   * The shell hides the canvas (display:none) whenever a screen other than the
   * game itself is showing, so on cold start the parent measures 0x0. Booting the
   * WebGL renderer against a zero-sized drawing buffer makes framebuffer
   * creation fail ("Incomplete Attachment") and the renderer stays broken for
   * the whole session — every level entry would then render nothing. Falling
   * back to the window keeps the boot size real; Scale.RESIZE re-fits the
   * canvas to the parent as soon as it is laid out visible.
   */
  if (width <= 0 || height <= 0) {
    width = window.innerWidth;
    height = window.innerHeight;
  }

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width,
    height,
    parent: parentElement,
    backgroundColor: '#1a1a2e',
    scene: [BootScene, PreloadScene, GameScene],
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  };

  return new Phaser.Game(config);
}
