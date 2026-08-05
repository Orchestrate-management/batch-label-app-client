import { describe, expect, it, vi } from 'vitest';

/**
 * The data layer with no database behind it at all.
 *
 * `supabase` is null whenever VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing, which is
 * every preview build somebody forgot to give environment variables to, and every local clone
 * before the .env is written. It is a separate file rather than a case in products.test.ts
 * because the client is resolved at module load: the sibling file mocks it as present for its
 * whole run, and a test that needs it absent needs its own module registry.
 *
 * WHAT MUST NOT HAPPEN HERE IS A CRASH, and what must not happen second is a lie. Every entry
 * point in lib/products.ts dereferences the client immediately, so an unguarded one is a
 * TypeError thrown inside a render — and with no error boundary anywhere in this app (see
 * docs/PRODUCTION_TODO.md) that is a white screen, not a message. The guard turns it into a
 * sentence that says plainly this is us and not them.
 *
 * The read in particular must fail rather than resolve empty. An unconfigured deployment that
 * answered `{ok: true, products: []}` would render the new-account empty state — "Nothing here
 * yet, and that is the right place to start" — to every customer of a deployment whose database
 * credentials were dropped, which reads as their data having been deleted.
 */

vi.mock('./supabase', () => ({ supabase: null, isSupabaseConfigured: false }));

import { createProduct, fetchProducts, saveComposition } from './products';
import type { Product } from './model';

const product: Product = {
  id: 'prod-1',
  specificationId: 'spec-1',
  name: 'Black Fig and Cassis',
  sku: 'CC-BFC-220',
  categoryId: 'home-fragrance',
  markets: ['GB'],
  regimes: [],
  spec: {
    kind: 'mixture',
    productType: 'Container candle',
    baseId: 'ing-crw45',
    fragranceId: 'ing-bfc',
    load: 8,
    dyeId: 'ing-no-dye',
    additive: 'None',
    netQuantity: 220,
    netUnit: 'g',
    packagingId: 'pkg-tumbler-250'
  },
  artefacts: [],
  identifiers: {},
  evidence: { obligations: {}, sdsSections: {} }
};

describe('an app that is not connected to its database', () => {
  it('reports the read as a failure rather than as an empty account', async () => {
    const result = await fetchProducts('acct-1111');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // It blames us out loud. A customer who cannot see their products needs to know it is
      // not something they did and not something they have lost.
      expect(result.message).toMatch(/this is us, not you/i);
      expect(result.message).toMatch(/not connected/i);
    }
  });

  it('refuses a write with its own reason rather than throwing', async () => {
    const result = await createProduct({
      name: 'Black Fig and Cassis',
      sku: 'CC-BFC-220',
      categoryId: 'home-fragrance',
      productType: 'Container candle'
    }, 'acct-1111');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // A distinct reason, not the generic failure: "try again in a moment" would be a promise
      // nothing keeps, because nothing changes until somebody sets an environment variable.
      expect(result.reason).toBe('not_configured');
      expect(result.message).not.toMatch(/try again/i);
    }
  });

  it('refuses a composition save the same way', async () => {
    const result = await saveComposition(product, product.spec, 'acct-1111');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_configured');
  });
});
