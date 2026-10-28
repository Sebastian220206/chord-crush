import Phaser from 'phaser';

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PreloadScene' });
  }

  preload(): void {
    // Nothing to preload: every background is a solid color, so no image
    // assets are loaded anywhere in the game.
  }

  create(): void {
    this.scene.start('GameScene');
  }
}
