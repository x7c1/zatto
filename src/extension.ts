import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class ZattoExtension extends Extension {
  enable() {
    console.log('[Zatto] Extension enabled');
  }

  disable() {
    console.log('[Zatto] Extension disabled');
  }
}
