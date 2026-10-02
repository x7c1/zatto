/**
 * Typing for `actor.ease()` with snake_case property names.
 *
 * gnome-shell's `actor.ease()` (`js/ui/environment.js`) derives each
 * transition name from the parameter key by replacing `_` with `-`, then
 * waits on that transition to fire `onComplete`. `@girs/gnome-shell` only
 * types the camelCase spellings (`scaleX`, `translationX`), for which no
 * transition is found and `onComplete` fires at once. This augmentation
 * adds an overload with the snake_case names gnome-shell itself uses.
 *
 * It lives in a module file because a `declare module` in the ambient
 * script `gnome-shell-ambient.d.ts` would shadow the package instead of
 * augmenting it.
 */

import type Clutter from '@girs/clutter-18';

export interface ActorEaseParams {
  /** Milliseconds. */
  duration?: number;
  /** Milliseconds. */
  delay?: number;
  mode?: Clutter.AnimationMode;
  /** Called only when every transition ran to completion. */
  onComplete?: () => void;
  /** Called once when the ease stops, finished or not. */
  onStopped?: (isFinished: boolean) => void;
  x?: number;
  y?: number;
  opacity?: number;
  scale_x?: number;
  scale_y?: number;
  translation_x?: number;
  translation_y?: number;
}

declare module '@girs/clutter-18/clutter-18' {
  export namespace Clutter {
    interface Actor {
      ease(props: ActorEaseParams): void;
    }
  }
}
