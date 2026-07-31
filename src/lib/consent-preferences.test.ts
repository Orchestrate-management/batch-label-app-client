import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADVERTISING_AGREEMENT, MARKETING_EMAIL_AGREEMENT } from './agreements';

/**
 * The consent write path.
 *
 * Two things are being defended. First, that every change goes through the
 * `set_consent` function and never near a table — a direct write would have no
 * audit row and no server timestamp, which is the difference between a recorded
 * consent and a claimed one. Second, that advertising cannot be written from
 * here at all: it belongs to the cookie banner on www, and a second writer is
 * how two records end up disagreeing.
 */

const rpc = vi.fn();
const maybeSingle = vi.fn();

function makeClient() {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle
  };
  return {
    from: vi.fn(() => builder),
    rpc,
    __builder: builder
  };
}

let client: ReturnType<typeof makeClient>;

async function loadModule(configured = true) {
  vi.resetModules();
  client = makeClient();
  vi.doMock('./supabase', () => ({
    supabase: configured ? client : null,
    isSupabaseConfigured: configured,
    MISSING_CONFIG_MESSAGE: 'not configured'
  }));
  return import('./consent-preferences');
}

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ error: null });
  maybeSingle.mockReset().mockResolvedValue({
    data: { marketing_email_opt_in: true, advertising_opt_in: false },
    error: null
  });
});

describe('fetchConsentPreferences', () => {
  it('reads the caller`s own membership row for this brand', async () => {
    const { fetchConsentPreferences } = await loadModule();

    const prefs = await fetchConsentPreferences();

    expect(prefs).toEqual({ marketingEmail: true, advertising: false });
    expect(client.from).toHaveBeenCalledWith('brand_memberships');
    expect(client.__builder.eq).toHaveBeenCalledWith('brand_slug', 'batchlabel');
    // No user_id filter: RLS is the boundary, and a wrong client-side id would
    // return nothing at all.
    expect(client.__builder.eq).toHaveBeenCalledTimes(1);
  });

  it('returns null on a failed read rather than guessing "off"', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'network' } });
    const { fetchConsentPreferences } = await loadModule();

    expect(await fetchConsentPreferences()).toBeNull();
  });

  it('returns null when there is no membership row yet', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const { fetchConsentPreferences } = await loadModule();

    expect(await fetchConsentPreferences()).toBeNull();
  });
});

describe('updateConsentPreference', () => {
  it('writes marketing email through set_consent with the document snapshot', async () => {
    const { updateConsentPreference } = await loadModule();

    const result = await updateConsentPreference(MARKETING_EMAIL_AGREEMENT, true);

    expect(result.error).toBeNull();
    expect(rpc).toHaveBeenCalledWith('set_consent', {
      p_consent_id: 'marketing_emails',
      p_accepted: true,
      p_brand: 'batchlabel',
      p_title: 'Marketing emails',
      p_version: MARKETING_EMAIL_AGREEMENT.version,
      // Resolved against www, not this app's origin: the document only exists
      // there, and an audit row must point at a URL that served it.
      p_url: 'https://www.batchlabel.xyz/privacy'
    });
  });

  it('carries a withdrawal through the same function', async () => {
    const { updateConsentPreference } = await loadModule();

    await updateConsentPreference(MARKETING_EMAIL_AGREEMENT, false);

    expect(rpc).toHaveBeenCalledWith(
      'set_consent',
      expect.objectContaining({ p_accepted: false })
    );
  });

  it('never touches a table directly', async () => {
    const { updateConsentPreference } = await loadModule();

    await updateConsentPreference(MARKETING_EMAIL_AGREEMENT, true);

    expect(client.from).not.toHaveBeenCalled();
  });

  it('refuses to write advertising, which belongs to the cookie banner', async () => {
    const { updateConsentPreference } = await loadModule();

    const result = await updateConsentPreference(ADVERTISING_AGREEMENT, true);

    expect(result.error).toBe('That preference cannot be changed here.');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses terms, which are a contract and not withdrawable', async () => {
    const { updateConsentPreference } = await loadModule();

    const result = await updateConsentPreference(
      { id: 'terms_of_service', title: 'Terms of Service', version: '1', path: '/terms' },
      false
    );

    expect(result.error).not.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reports a plain message when the write fails', async () => {
    rpc.mockResolvedValue({ error: { message: 'no membership for this brand' } });
    const { updateConsentPreference } = await loadModule();

    const result = await updateConsentPreference(MARKETING_EMAIL_AGREEMENT, true);

    expect(result.error).toBe('We could not save that just now. Please try again.');
  });
});

describe('mirrored agreement versions', () => {
  /**
   * Pinned on purpose. These strings are copied from batch-label's
   * src/lib/agreements.ts and both repos write them into the same
   * `consent_events` table. If www bumps a version and this repo does not, the
   * audit log ends up with two answers to "which wording did they agree to",
   * and a contradiction proves we did not know. Changing a value here should
   * mean deliberately changing it there in the same breath, so the test exists
   * to make that a decision rather than an accident.
   */
  it('match the marketing site', () => {
    expect(MARKETING_EMAIL_AGREEMENT).toEqual({
      id: 'marketing_emails',
      title: 'Marketing emails',
      version: '2026-07-30',
      path: '/privacy'
    });
    expect(ADVERTISING_AGREEMENT).toEqual({
      id: 'advertising',
      title: 'Advertising and retargeting',
      version: '2026-07-30.2',
      path: '/cookie-policy'
    });
  });
});
