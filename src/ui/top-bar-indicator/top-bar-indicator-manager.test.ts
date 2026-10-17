import { describe, expect, it, vi } from 'vitest';
import { FakeIndicatorFactory, FakeIndicatorSetting } from './test-fakes.js';
import { TopBarIndicatorManager } from './top-bar-indicator-manager.js';

function setup(shown: boolean) {
  const setting = new FakeIndicatorSetting(shown);
  const factory = new FakeIndicatorFactory();
  const manager = new TopBarIndicatorManager(setting, factory.create);
  return { setting, factory, manager };
}

describe('TopBarIndicatorManager', () => {
  it('adds the indicator at enable when the key is true', () => {
    const { factory, manager } = setup(true);

    manager.enable();

    expect(factory.live()).toHaveLength(1);
    expect(manager.isShown()).toBe(true);
  });

  it('adds nothing at enable when the key is false', () => {
    const { factory, manager } = setup(false);

    manager.enable();

    expect(factory.created).toHaveLength(0);
    expect(manager.isShown()).toBe(false);
  });

  it('removes the indicator when the key turns false, and adds it again when it turns true', () => {
    const { setting, factory, manager } = setup(true);
    manager.enable();
    const [first] = factory.created;

    setting.set(false);
    expect(first.destroyed).toBe(true);
    expect(factory.live()).toHaveLength(0);

    setting.set(true);
    expect(factory.created).toHaveLength(2);
    expect(factory.live()).toEqual([factory.created[1]]);
  });

  it('adds the indicator when the key turns true after enabling hidden', () => {
    const { setting, factory, manager } = setup(false);
    manager.enable();

    setting.set(true);

    expect(factory.live()).toHaveLength(1);
  });

  it('keeps a single indicator when the key is set to its current value', () => {
    const { setting, factory, manager } = setup(true);
    manager.enable();

    setting.set(true);

    expect(factory.created).toHaveLength(1);
  });

  it('removes the indicator and stops watching on disable', () => {
    const { setting, factory, manager } = setup(true);
    manager.enable();

    manager.disable();

    expect(factory.live()).toHaveLength(0);
    expect(setting.watcherCount()).toBe(0);

    setting.set(false);
    setting.set(true);
    expect(factory.created).toHaveLength(1);
  });

  it('can be enabled again after disable', () => {
    const { setting, factory, manager } = setup(true);
    manager.enable();
    manager.disable();

    manager.enable();

    expect(factory.live()).toHaveLength(1);
    expect(setting.watcherCount()).toBe(1);
  });

  it('watches once when enabled twice', () => {
    const { setting, factory, manager } = setup(true);
    manager.enable();
    manager.enable();

    expect(setting.watcherCount()).toBe(1);
    expect(factory.created).toHaveLength(1);
  });

  it('disable is harmless when not enabled', () => {
    const { factory, manager } = setup(true);

    manager.disable();

    expect(factory.created).toHaveLength(0);
  });

  it('logs a failed creation, stays without an indicator and retries on the next change', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { setting, factory, manager } = setup(true);
      factory.throwOnCreate = new Error('boom');

      manager.enable();

      expect(manager.isShown()).toBe(false);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('boom'));

      setting.set(false);
      setting.set(true);
      expect(factory.live()).toHaveLength(1);
    } finally {
      log.mockRestore();
    }
  });
});
