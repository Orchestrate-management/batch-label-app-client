/**
 * The gate, asserted rather than described.
 *
 * Two properties matter more than the rest and each has its own test: nothing
 * is loaded or sent without a granted flag, and a withdrawal actually stops
 * tracking. The third — that this app never sends a PageView — is checked
 * across a grant, a send, a withdrawal and a re-grant, because "we did not
 * write one" is a weaker guarantee than "none reaches fbq under any sequence".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PIXEL_ID = '1374342861305621';
const SCRIPT_SELECTOR = 'script[data-bl-meta-pixel]';

type MetaPixelModule = typeof import('./meta-pixel');

/**
 * A fresh copy of the module per test.
 *
 * `granted` and `loaded` are module state and they are the thing under test, so
 * resetting modules is how each case starts from "nobody has consented to
 * anything". The Pixel id comes from `vitest.config.ts` (`test.env`) because
 * Vite inlines `import.meta.env` per module and nothing a test does afterwards
 * can change it — see the comment there.
 */
async function loadPixel(): Promise<MetaPixelModule> {
  vi.resetModules();
  return import('./meta-pixel');
}

/**
 * A spy in place of Meta's own stub.
 *
 * `installFbqStub` returns early when `window.fbq` already exists, so putting a
 * spy there first means every call the module makes is captured — including the
 * ones the real stub would have swallowed into its queue.
 */
function spyOnFbq() {
  const fbq = vi.fn();
  (window as unknown as {fbq?: unknown;}).fbq = fbq;
  return fbq;
}

function calls(fbq: ReturnType<typeof vi.fn>): unknown[][] {
  return fbq.mock.calls as unknown[][];
}

beforeEach(() => {
  document.head.querySelectorAll(SCRIPT_SELECTOR).forEach((node) => node.remove());
  delete (window as unknown as {fbq?: unknown;}).fbq;
  delete (window as unknown as {_fbq?: unknown;})._fbq;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('before consent is known', () => {
  it('loads no script and sends nothing', async () => {
    const fbq = spyOnFbq();
    const pixel = await loadPixel();

    pixel.metaInitiateCheckout('plan-gate');

    expect(pixel.metaPixelState()).toEqual({ granted: false, loaded: false });
    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
    expect(fbq).not.toHaveBeenCalled();
  });

  it('sends nothing when the flag is explicitly false', async () => {
    const fbq = spyOnFbq();
    const pixel = await loadPixel();

    pixel.setMetaConsent(false);
    pixel.metaInitiateCheckout('billing-settings');

    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
    expect(fbq).not.toHaveBeenCalled();
  });

  it('stays shut when the read failed, which the caller reports as false', async () => {
    // readAdvertisingConsent() returns 'unknown' on a failed read and the
    // provider maps everything that is not 'granted' to false. From this
    // module's side a failed read is indistinguishable from a refusal, which is
    // the point: there is no third state that could accidentally open the gate.
    const fbq = spyOnFbq();
    const pixel = await loadPixel();

    pixel.setMetaConsent(false);

    expect(pixel.metaPixelState().granted).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
  });
});

describe('once the account flag says yes', () => {
  it('injects the Pixel script and initialises the dataset', async () => {
    const fbq = spyOnFbq();
    const pixel = await loadPixel();

    pixel.setMetaConsent(true);

    const script = document.querySelector(SCRIPT_SELECTOR) as HTMLScriptElement | null;
    expect(script).not.toBeNull();
    expect(script?.src).toBe('https://connect.facebook.net/en_US/fbevents.js');
    expect(script?.async).toBe(true);
    expect(pixel.metaPixelState()).toEqual({ granted: true, loaded: true });
    expect(calls(fbq)).toContainEqual(['init', PIXEL_ID]);
  });

  it('turns autoConfig off before init, so fbevents scrapes nothing', async () => {
    const fbq = spyOnFbq();
    const pixel = await loadPixel();

    pixel.setMetaConsent(true);

    const names = calls(fbq).map((args) => args.join(':'));
    const autoConfig = names.indexOf(`set:autoConfig:false:${PIXEL_ID}`);
    const init = names.indexOf(`init:${PIXEL_ID}`);
    expect(autoConfig).toBeGreaterThanOrEqual(0);
    // Order is load bearing: Meta only honours the setting before init.
    expect(autoConfig).toBeLessThan(init);
  });

  it('sends no advanced matching with init', async () => {
    const fbq = spyOnFbq();
    const pixel = await loadPixel();

    pixel.setMetaConsent(true);

    const init = calls(fbq).find((args) => args[0] === 'init');
    expect(init).toEqual(['init', PIXEL_ID]);
  });

  it('sends nothing on the consent transition itself', async () => {
    const fbq = spyOnFbq();
    const pixel = await loadPixel();

    pixel.setMetaConsent(true);

    expect(calls(fbq).some((args) => args[0] === 'track')).toBe(false);
  });

  it('loads once when told the same answer twice', async () => {
    const fbq = spyOnFbq();
    const pixel = await loadPixel();

    pixel.setMetaConsent(true);
    pixel.setMetaConsent(true);

    expect(document.querySelectorAll(SCRIPT_SELECTOR)).toHaveLength(1);
    expect(calls(fbq).filter((args) => args[0] === 'init')).toHaveLength(1);
  });
});

describe('InitiateCheckout', () => {
  it('reports the upgrade click with no fabricated value', async () => {
    const fbq = spyOnFbq();
    const pixel = await loadPixel();
    pixel.setMetaConsent(true);

    pixel.metaInitiateCheckout('plan-gate');

    const track = calls(fbq).find((args) => args[0] === 'track');
    expect(track?.[1]).toBe('InitiateCheckout');
    expect(track?.[2]).toEqual({
      content_type: 'product',
      content_ids: ['maker'],
      content_name: 'Maker plan',
      checkout_origin: 'app',
      checkout_surface: 'plan-gate'
    });
    // A pricing-page click is not worth £14 and saying so would flow into ROAS.
    expect(track?.[2]).not.toHaveProperty('value');
    expect(track?.[2]).not.toHaveProperty('currency');
  });

  it('carries an event id so a future server event could deduplicate', async () => {
    const fbq = spyOnFbq();
    const pixel = await loadPixel();
    pixel.setMetaConsent(true);

    pixel.metaInitiateCheckout('billing-settings');

    const track = calls(fbq).find((args) => args[0] === 'track');
    const options = track?.[3] as {eventID?: string;};
    expect(typeof options.eventID).toBe('string');
    expect(options.eventID).not.toBe('');
  });

  it('records which control was pressed', async () => {
    const fbq = spyOnFbq();
    const pixel = await loadPixel();
    pixel.setMetaConsent(true);

    pixel.metaInitiateCheckout('billing-settings');

    const track = calls(fbq).find((args) => args[0] === 'track');
    expect((track?.[2] as {checkout_surface?: string;}).checkout_surface).toBe('billing-settings');
  });
});

describe('withdrawal', () => {
  it('revokes, removes the script, clears Meta cookies and stops sending', async () => {
    const fbq = spyOnFbq();
    const pixel = await loadPixel();
    pixel.setMetaConsent(true);
    document.cookie = '_fbp=fb.1.1700000000000.1234567890';
    document.cookie = '_fbc=fb.1.1700000000000.abc123';
    fbq.mockClear();

    pixel.setMetaConsent(false);

    expect(calls(fbq)).toContainEqual(['consent', 'revoke']);
    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
    expect(document.cookie).not.toContain('_fbp=');
    expect(document.cookie).not.toContain('_fbc=');
    expect(pixel.metaPixelState()).toEqual({ granted: false, loaded: false });

    fbq.mockClear();
    pixel.metaInitiateCheckout('plan-gate');
    expect(fbq).not.toHaveBeenCalled();
  });

  it('stays shut when the same withdrawal is reported again', async () => {
    const fbq = spyOnFbq();
    const pixel = await loadPixel();
    pixel.setMetaConsent(true);
    pixel.setMetaConsent(false);
    fbq.mockClear();

    pixel.setMetaConsent(false);

    expect(fbq).not.toHaveBeenCalled();
  });

  it('can be re-granted, and still sends no backlog', async () => {
    const fbq = spyOnFbq();
    const pixel = await loadPixel();
    pixel.setMetaConsent(true);
    pixel.metaInitiateCheckout('plan-gate');
    pixel.setMetaConsent(false);
    fbq.mockClear();

    pixel.setMetaConsent(true);

    expect(pixel.metaPixelState()).toEqual({ granted: true, loaded: true });
    expect(calls(fbq).some((args) => args[0] === 'track')).toBe(false);
  });
});

describe('what this app never sends', () => {
  it('never mentions PageView, under any sequence of consent changes', async () => {
    const fbq = spyOnFbq();
    const pixel = await loadPixel();

    pixel.setMetaConsent(true);
    pixel.metaInitiateCheckout('plan-gate');
    pixel.setMetaConsent(false);
    pixel.setMetaConsent(true);
    pixel.metaInitiateCheckout('billing-settings');

    const everySent = JSON.stringify(calls(fbq));
    expect(everySent).not.toContain('PageView');
    expect(everySent).not.toContain('ViewContent');
    expect(everySent).not.toContain('CompleteRegistration');
    expect(everySent).not.toContain('Purchase');
  });

  it('exports no way to send anything except InitiateCheckout', async () => {
    const pixel = await loadPixel();
    const senders = Object.keys(pixel).filter((name) => name.startsWith('meta') && name !== 'metaPixelState');
    expect(senders).toEqual(['metaInitiateCheckout']);
  });
});

describe('pixelCanLoad', () => {
  it('refuses without a configured pixel id, wherever it is running', async () => {
    const { pixelCanLoad } = await loadPixel();
    expect(pixelCanLoad('', 'app.batchlabel.xyz', false)).toBe(false);
    // Not even the debug flag can conjure a dataset to report into.
    expect(pixelCanLoad('', 'localhost', true)).toBe(false);
  });

  it('allows the real app origin', async () => {
    const { pixelCanLoad } = await loadPixel();
    expect(pixelCanLoad(PIXEL_ID, 'app.batchlabel.xyz', false)).toBe(true);
  });

  it.each(['localhost', '127.0.0.1', '::1', 'batchlabel.local'])(
    'keeps development out of the live dataset (%s)',
    async (host) => {
      const { pixelCanLoad } = await loadPixel();
      expect(pixelCanLoad(PIXEL_ID, host, false)).toBe(false);
    }
  );

  it('lets a developer opt in explicitly, for Test Events', async () => {
    const { pixelCanLoad } = await loadPixel();
    expect(pixelCanLoad(PIXEL_ID, 'localhost', true)).toBe(true);
  });

  it('treats an unknown hostname as not provably safe', async () => {
    const { pixelCanLoad } = await loadPixel();
    expect(pixelCanLoad(PIXEL_ID, '', false)).toBe(false);
  });

  it('is what actually stops a load, not a comment about it', async () => {
    const fbq = spyOnFbq();
    vi.stubGlobal('location', { hostname: 'localhost', href: 'http://localhost:5173/' });
    const pixel = await loadPixel();

    pixel.setMetaConsent(true);
    pixel.metaInitiateCheckout('plan-gate');

    expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
    expect(fbq).not.toHaveBeenCalled();
  });
});
