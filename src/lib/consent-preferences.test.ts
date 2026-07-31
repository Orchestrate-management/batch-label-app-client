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

/**
 * There is deliberately NO test here asserting that the agreement versions equal
 * a set of literals.
 *
 * There was one. It compared the constants in src/lib/agreements.ts to the same
 * strings copied into the test file beside it, so www could bump a version and
 * both repos' suites would stay green — the exact drift it was written to catch
 * would pass. A check that cannot fail for the reason it exists is worse than no
 * check, because the next person reads the green tick as an answer.
 *
 * A unit test in this repo cannot see the other repo, so the real check lives in
 * CI, where it can: .github/workflows/ci.yml runs
 * scripts/check-agreement-versions.mjs, which fetches www's agreements.ts and
 * compares. When it cannot reach the other repo it says so loudly rather than
 * passing quietly. See docs/INTEGRATION.md for the token it needs.
 */
describe('the agreement snapshot that goes into the audit row', () => {
  it('sends the version and url from the shared constants, not from anything local', async () => {
    const { updateConsentPreference } = await loadModule();

    await updateConsentPreference(MARKETING_EMAIL_AGREEMENT, true);

    const payload = rpc.mock.calls[0][1];
    expect(payload.p_version).toBe(MARKETING_EMAIL_AGREEMENT.version);
    expect(payload.p_title).toBe(MARKETING_EMAIL_AGREEMENT.title);
    // Resolved against the marketing site, because that is the only origin that
    // has ever served the document.
    expect(payload.p_url).toBe(`https://www.batchlabel.xyz${MARKETING_EMAIL_AGREEMENT.path}`);
  });

  it('keeps the two consent ids set_consent whitelists', () => {
    // These two ids are not version strings — they are the database contract.
    // set_consent rejects anything else, and older audit rows use them, so they
    // cannot change even when the wording does.
    expect(MARKETING_EMAIL_AGREEMENT.id).toBe('marketing_emails');
    expect(ADVERTISING_AGREEMENT.id).toBe('advertising');
  });
});
