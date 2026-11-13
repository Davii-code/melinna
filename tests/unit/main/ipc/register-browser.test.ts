import { describe, expect, it, vi } from 'vitest';
import { MelinnaError } from '../../../../src/core/errors';
import { registerBrowser, type BrowserApi } from '../../../../src/main/ipc/register-browser';
import { handleRecorder } from '../../../support/fake-core';
import { MemoryLogger } from '../../../support/fakes/logger';

const BOUNDS = { x: 0, y: 40, width: 1200, height: 700 };

function setup() {
  const browser = {
    open: vi.fn(),
    navigate: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    reload: vi.fn(),
    stop: vi.fn(),
    setBounds: vi.fn(),
    close: vi.fn(),
  } satisfies BrowserApi;
  const rec = handleRecorder();
  registerBrowser(rec.handle, { browser, log: new MemoryLogger() });
  return { browser, rec };
}

describe('browser IPC', () => {
  it('registers every browser channel', () => {
    expect(setup().rec.channels()).toEqual([
      'browser:back',
      'browser:close',
      'browser:forward',
      'browser:navigate',
      'browser:open',
      'browser:reload',
      'browser:setBounds',
      'browser:stop',
    ]);
  });

  it('opens a page with validated bounds', async () => {
    const { rec, browser } = setup();
    expect(await rec.call('browser:open', 'https://example.com/', BOUNDS)).toEqual({ ok: true, value: undefined });
    expect(browser.open).toHaveBeenCalledWith('https://example.com/', BOUNDS);
  });

  it('refuses bounds that are not whole pixels inside the limit', async () => {
    const { rec, browser } = setup();
    for (const bad of [
      null,
      'tela',
      { ...BOUNDS, x: -1 },
      { ...BOUNDS, width: 1.5 },
      { ...BOUNDS, height: 50_000 },
      { x: 0, y: 0, width: 10 },
    ]) {
      expect((await rec.call('browser:open', 'https://example.com/', bad)).error?.code).toBe('INPUT_INVALID');
      expect((await rec.call('browser:setBounds', bad)).error?.code).toBe('INPUT_INVALID');
    }
    expect(browser.open).not.toHaveBeenCalled();
    expect(browser.setBounds).not.toHaveBeenCalled();
  });

  it('passes on the refusal of an address', async () => {
    const { rec, browser } = setup();
    browser.navigate.mockImplementation(() => {
      throw new MelinnaError('INPUT_INVALID', { userMessage: 'Só links http e https podem ser abertos.' });
    });
    expect((await rec.call('browser:navigate', 'file:///x')).error).toMatchObject({
      code: 'INPUT_INVALID',
      message: 'Só links http e https podem ser abertos.',
    });
  });

  it('routes history, reload, stop, bounds and close', async () => {
    const { rec, browser } = setup();
    for (const channel of ['back', 'forward', 'reload', 'stop', 'close'] as const) {
      expect((await rec.call(`browser:${channel}`)).ok).toBe(true);
      expect(browser[channel]).toHaveBeenCalledTimes(1);
    }
    expect((await rec.call('browser:setBounds', BOUNDS)).ok).toBe(true);
    expect(browser.setBounds).toHaveBeenCalledWith(BOUNDS);
    expect((await rec.call('browser:close', 'extra')).error?.code).toBe('INPUT_INVALID');
  });
});
