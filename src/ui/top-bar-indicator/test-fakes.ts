/** Test doubles for the top bar indicator ports. */

import type { IndicatorPort, IndicatorSettingPort } from './ports.js';

export class FakeIndicatorSetting implements IndicatorSettingPort {
  private readonly handlers = new Set<(shown: boolean) => void>();

  constructor(private shown: boolean) {}

  isShown(): boolean {
    return this.shown;
  }

  watch(handler: (shown: boolean) => void): () => void {
    // Wrap so watching the same handler twice still counts twice.
    const entry = (shown: boolean) => handler(shown);
    this.handlers.add(entry);
    return () => {
      this.handlers.delete(entry);
    };
  }

  /** How many handlers are watching. */
  watcherCount(): number {
    return this.handlers.size;
  }

  /** Test helper: change the value and notify the watchers, as GSettings does. */
  set(shown: boolean): void {
    this.shown = shown;
    for (const handler of [...this.handlers]) {
      handler(shown);
    }
  }
}

export class FakeIndicator implements IndicatorPort {
  destroyed = false;

  destroy(): void {
    this.destroyed = true;
  }
}

/** Creates {@link FakeIndicator}s and keeps every one it created. */
export class FakeIndicatorFactory {
  readonly created: FakeIndicator[] = [];
  /** Test helper: make the next creation throw. */
  throwOnCreate: Error | null = null;

  readonly create = (): FakeIndicator => {
    if (this.throwOnCreate !== null) {
      const error = this.throwOnCreate;
      this.throwOnCreate = null;
      throw error;
    }
    const indicator = new FakeIndicator();
    this.created.push(indicator);
    return indicator;
  };

  /** The indicators created and not yet destroyed. */
  live(): FakeIndicator[] {
    return this.created.filter((indicator) => !indicator.destroyed);
  }
}
