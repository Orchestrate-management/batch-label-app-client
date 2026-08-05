import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A stand-in for the two tables, chained the way supabase-js chains.
 *
 * It exists for one function: createProduct, whose failure path decides whether a
 * specification is archived — and archiving the specification of a product that DID commit
 * hides a live, metered SKU on every screen, permanently, with no way back from the browser.
 * That decision cannot be reasoned about from a type check; it needs the shapes supabase-js
 * actually hands back, including the one with no Postgres code in it.
 */
const db = vi.hoisted(() => {
  const state = {
    specInsert: { data: null as unknown, error: null as unknown },
    productInsert: { data: null as unknown, error: null as unknown },
    lookup: { data: null as unknown, error: null as unknown },
    // fetchProducts' two reads, one per table. Told apart from the lookup above by how they
    // are consumed: the lookup ends in maybeSingle(), these are awaited directly.
    productsRead: { data: [] as unknown, error: null as unknown },
    specificationsRead: { data: [] as unknown, error: null as unknown },
    // The two reads that joined the pair. Artefacts are what turn "Not yet produced" into a
    // version and a date; record_events carries the obligation evidence that used to come from
    // a jsonb column nothing wrote. Both are settable independently, because the failure that
    // matters is one of the four coming back broken while the others are fine.
    artefactsRead: { data: [] as unknown, error: null as unknown },
    eventsRead: { data: [] as unknown, error: null as unknown },
    // What batchlabel.artefact_source_fingerprint returned, per product id, plus the calls
    // made. `null` is a fingerprint we could not get, which must render as `unknown` and never
    // as either real answer.
    fingerprints: {} as Record<string, unknown>,
    fingerprintError: null as unknown,
    fingerprintCalls: [] as string[],
    // Every INSERT this fake saw, by table. The artefact write path is two inserts across two
    // tables and the half that lands matters.
    inserts: [] as Array<[string, Record<string, unknown>]>,
    artefactInsert: { data: null as unknown, error: null as unknown },
    eventInsert: { data: null as unknown, error: null as unknown },
    versionLookup: { data: null as unknown, error: null as unknown },
    specPayload: null as Record<string, unknown> | null,
    productPayload: null as Record<string, unknown> | null,
    lookupFilters: [] as Array<[string, unknown]>,
    archived: [] as string[],
    // saveComposition's two updates, settable apart, because the failure that matters is the
    // second one failing AFTER the first has committed.
    specUpdate: { data: null as unknown, error: null as unknown },
    productUpdate: { data: null as unknown, error: null as unknown },
    updated: [] as string[],
    // What each UPDATE actually sent. Some of these columns are printed on a label, so the
    // difference between null and a falsy value is the difference between a field left blank
    // and a false declaration.
    updatePayloads: [] as Array<[string, Record<string, unknown>]>,
    // Which Postgres schema each read and write went through. Recorded rather than
    // ignored: the domain tables moved out of `public` so a second brand can have
    // its own `products`, and a client that quietly went back to `public` would
    // read an empty decoy table and report "you have no products" — a silent,
    // plausible, wrong answer, which is the shape this repo keeps finding.
    schemas: [] as string[]
  };

  const query = (result: () => {data: unknown;error: unknown;}, onEq?: (column: string, value: unknown) => void) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    Object.assign(q, {
      select: chain,
      is: chain,
      limit: chain,
      order: chain,
      eq: (column: string, value: unknown) => {
        onEq?.(column, value);
        return q;
      },
      single: async () => result(),
      maybeSingle: async () => result(),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject)
    });
    return q;
  };

  const supabase = {
    // supabase-js returns a schema-scoped client; the fake returns itself and
    // notes which schema was asked for.
    schema(name: string) {
      state.schemas.push(name);
      return supabase;
    },
    // The domain functions the app calls through PostgREST. Only one today.
    async rpc(name: string, args: Record<string, unknown>) {
      if (name !== 'artefact_source_fingerprint') return { data: null, error: null };
      const id = String(args.p_product_id);
      state.fingerprintCalls.push(id);
      if (state.fingerprintError) return { data: null, error: state.fingerprintError };
      return { data: state.fingerprints[id] ?? null, error: null };
    },
    from(table: string) {
      return {
        insert(payload: Record<string, unknown>) {
          state.inserts.push([table, payload]);
          if (table === 'specifications') state.specPayload = payload;
          else if (table === 'products') state.productPayload = payload;
          return query(() =>
          table === 'specifications' ?
          state.specInsert :
          table === 'products' ?
          state.productInsert :
          table === 'artefacts' ?
          state.artefactInsert :
          state.eventInsert
          );
        },
        // Two callers reach this: createProduct's "did it land anyway?" lookup, which ends in
        // maybeSingle(), and fetchProducts' two table reads, which are awaited directly.
        select: () => {
          const q: Record<string, unknown> = {};
          const chain = () => q;
          Object.assign(q, {
            select: chain,
            is: chain,
            limit: chain,
            order: chain,
            // `in` is how fetchProducts narrows the log to the compliance kinds. Recorded, not
            // ignored: a read that forgot it would drag every batch record onto a screen
            // assembling a product.
            in: (column: string, values: unknown) => {
              state.lookupFilters.push([`in:${column}`, values]);
              return q;
            },
            eq: (column: string, value: unknown) => {
              state.lookupFilters.push([column, value]);
              return q;
            },
            // The version lookup before an artefact insert ends in maybeSingle() on the
            // artefacts table; createProduct's "did it land anyway?" lookup ends the same way
            // on products.
            single: async () => table === 'artefacts' ? state.versionLookup : state.lookup,
            maybeSingle: async () => table === 'artefacts' ? state.versionLookup : state.lookup,
            then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
            Promise.resolve(
              table === 'products' ?
              state.productsRead :
              table === 'specifications' ?
              state.specificationsRead :
              table === 'artefacts' ?
              state.artefactsRead :
              state.eventsRead
            ).then(resolve, reject)
          });
          return q;
        },
        update: (payload: Record<string, unknown>) => ({
          eq: (_column: string, value: unknown) => {
            if (payload.archived_at) {
              state.archived.push(String(value));
              return Promise.resolve({ data: null, error: null });
            }
            state.updated.push(table);
            state.updatePayloads.push([table, payload]);
            const result = () =>
            table === 'specifications' ? state.specUpdate : state.productUpdate;
            // `.select()` after `.eq()` is what makes an UPDATE return the rows it touched.
            // Without it PostgREST answers 204 and supabase-js reports success whether one row
            // changed or none did — which is how a write refused by an RLS `using` clause used
            // to be reported to a maker as a successful save. The mock has to be able to hand
            // back an empty array, because that is the shape the bug arrives in.
            return Object.assign(Promise.resolve(result()), {
              select: () => Promise.resolve(result())
            });
          }
        })
      };
    }
  };

  return { state, supabase };
});

vi.mock('./supabase', () => ({ supabase: db.supabase, isSupabaseConfigured: true }));

/**
 * The record log, stubbed, and stubbed for two reasons rather than one.
 *
 * The first is isolation: `createProduct` and `saveComposition` now write a line to
 * `batchlabel.record_events` when they succeed, and the fake above answers every table the
 * same way — so an unstubbed log insert lands in `productPayload` and every assertion about
 * what a product INSERT sent starts reading the log entry instead.
 *
 * The second is that the calls themselves are worth asserting. A create that saved and did not
 * appear in the log is a hole in a compliance record, and a REFUSED create that appeared in it
 * would be a record of something that never happened — which is worse. Both are checked below.
 */
const recordLog = vi.hoisted(() => ({
  created: [] as Array<[string | null, {id: string;name: string;}]>,
  changed: [] as Array<[string | null, {id: string;name: string;}]>
}));

vi.mock('./records', () => ({
  logProductCreated: async (accountId: string | null, product: {id: string;name: string;}) => {
    recordLog.created.push([accountId, product]);
  },
  logCompositionChanged: async (accountId: string | null, product: {id: string;name: string;}) => {
    recordLog.changed.push([accountId, product]);
  }
}));

import {
  artefactsFor,
  blankSpec,
  classifyWriteError,
  createProduct,
  evidenceByProduct,
  fetchProducts,
  saveComposition,
  toProduct,
  type ArtefactRow,
  type NewProductInput,
  type ProductRow,
  type RecordEventRow,
  type SpecificationRow } from
'./products';
import { categoryById } from './categories';
import type { ProductEvidence } from './model';

/**
 * The two things in lib/products.ts that can be tested without a database, and both of them
 * are places where being wrong is expensive rather than annoying.
 *
 * The mapping, because a row that comes back slightly different from what was expected must
 * degrade to something renderable rather than throw inside a render — one malformed row would
 * otherwise cost a maker every other row on the screen.
 *
 * The error classification, because it is what stands between the SKU meter and a maker: get
 * it wrong and somebody at their plan allowance is told "something went wrong, try again",
 * and tries again, and is told it again.
 */

function specRow(overrides: Partial<SpecificationRow> = {}): SpecificationRow {
  return {
    id: 'spec-1',
    account_id: 'acct-1111',
    name: 'Black Fig and Cassis',
    category_id: 'home-fragrance',
    kind: 'mixture',
    product_type: 'Container candle',
    fragrance_id: 'ing-black-fig',
    base_id: 'ing-crw45',
    dye_id: 'ing-no-dye',
    load: 8,
    additive: 'None',
    markets: ['GB', 'EU'],
    regimes: ['clp', 'gpsr'],
    ufi: null,
    data: {},
    ...overrides
  };
}

function productRow(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 'prod-1',
    account_id: 'acct-1111',
    specification_id: 'spec-1',
    name: 'Black Fig and Cassis',
    sku: 'CC-BFC-220',
    net_quantity: 220,
    net_unit: 'g',
    packaging_id: 'pkg-tumbler-250',
    identifiers: {},
    obligations: {},
    data: {},
    created_at: '2026-08-01T10:00:00Z',
    ...overrides
  };
}

describe('reading a product row', () => {
  it('assembles the composition from the specification and the pack from the product', () => {
    const product = toProduct(productRow(), specRow());

    expect(product.id).toBe('prod-1');
    expect(product.specificationId).toBe('spec-1');
    expect(product.categoryId).toBe('home-fragrance');
    expect(product.markets).toEqual(['GB', 'EU']);
    expect(product.regimes).toEqual(['clp', 'gpsr']);
    expect(product.spec.kind).toBe('mixture');
    if (product.spec.kind === 'mixture') {
      expect(product.spec.fragranceId).toBe('ing-black-fig');
      expect(product.spec.load).toBe(8);
    }
    // The pack is the product's, not the specification's. This is the whole point of the split.
    expect(product.spec.netQuantity).toBe(220);
    expect(product.spec.netUnit).toBe('g');
    expect(product.spec.packagingId).toBe('pkg-tumbler-250');
  });

  it('carries the specification id, so a composition edit knows what to update', () => {
    // Without it saveComposition refuses rather than guessing, and a wrong guess would
    // rewrite a different product's classification.
    expect(toProduct(productRow(), specRow()).specificationId).toBe('spec-1');
  });

  it('reads a numeric that arrived as a string rather than turning it into NaN', () => {
    const product = toProduct(productRow({ net_quantity: '220.000' }), specRow({ load: '8.5' }));
    expect(product.spec.netQuantity).toBe(220);
    if (product.spec.kind === 'mixture') expect(product.spec.load).toBe(8.5);
  });

  it('takes the UFI from the specification, never from the product', () => {
    // CLP Annex VIII ties the UFI to the composition: one UFI, however many pack sizes. The
    // schema has no ufi column on products at all, and an identifiers blob claiming one must
    // not become a UFI on a label.
    const withUfi = toProduct(
      productRow({ identifiers: { ufi: 'ABCD-1234-EFGH-5678' } }),
      specRow({ ufi: 'UFI0-1111-2222-3333' })
    );
    expect(withUfi.identifiers.ufi).toBe('UFI0-1111-2222-3333');

    const withoutUfi = toProduct(productRow(), specRow());
    expect(withoutUfi.identifiers.ufi).toBeUndefined();
  });

  it('never reports an artefact as produced', () => {
    for (const artefact of toProduct(productRow(), specRow()).artefacts) {
      expect(artefact.version).toBe('Not yet produced');
      expect(artefact.printedOn).toBe('—');
    }
  });

  it('falls back rather than throwing on a row it does not recognise', () => {
    const product = toProduct(
      productRow({ name: null, sku: null, net_unit: 'furlongs', net_quantity: null }),
      specRow({ category_id: 'something-new', kind: 'phased', markets: [], regimes: null })
    );
    expect(product.name).toBe('Untitled product');
    expect(product.sku).toBe('');
    // An unknown category resolves through `kind`, which still says what shape the
    // composition has, rather than silently becoming home fragrance.
    expect(product.categoryId).toBe('cosmetics');
    expect(product.spec.kind).toBe('phased');
    // GB is the column's own default; a product sold nowhere would render no address block.
    expect(product.markets).toEqual(['GB']);
    // Which rules apply is a fact about what the product is. An empty list would tell a maker
    // that no regime applies to a cosmetic.
    expect(product.regimes.length).toBeGreaterThan(0);
  });

  /**
   * `products.obligations` IS NO LONGER READ, AND THAT IS THE ASSERTION.
   *
   * It used to be mapped onto `Product.obligations` and consulted by `obligationState`, which
   * is how fifteen obligations came to be permanently outstanding on every product: the column
   * is written by nothing, so it was always `{}`. Evidence now comes from the append-only log.
   * This pins the replacement rather than the removal — a product assembled from two rows with
   * no log behind it claims no evidence at all, which is the true answer for one.
   */
  it('takes no evidence from the products.obligations column', () => {
    const product = toProduct(
      productRow({ obligations: { 'clp-classification': true, 'cpr-pif': true } }),
      specRow()
    );
    expect(product.evidence).toEqual({ obligations: {}, sdsSections: {} });
  });

  /**
   * The two composition shapes that are NOT a mixture, read back out of `specifications.data`.
   *
   * A mixture keeps its four inputs in typed columns, so a mis-read shows up as a wrong number.
   * These two live in a JSON blob, so a mis-read shows up as a phase list or a bill of materials
   * that is silently EMPTY — and an empty phase list derives a cosmetic with no ingredients on
   * its label, which is a compliance statement about a product nobody has checked. Round-tripping
   * them is the only thing standing between a schema change and that.
   */
  it('reads a phased composition back out of the data blob', () => {
    const product = toProduct(
      productRow({ net_quantity: 30, net_unit: 'ml', packaging_id: 'pkg-dropper-30' }),
      specRow({
        category_id: 'cosmetics',
        kind: 'phased',
        product_type: 'Face oil',
        data: {
          phases: [
          { name: 'Oil phase', items: [{ materialId: 'ing-jojoba', pct: 80 }] },
          { name: 'Cool down', items: [{ materialId: 'ing-vit-e', pct: 1 }] }],

          application: 'Rinse-off',
          paoMonths: 6
        }
      })
    );

    expect(product.spec.kind).toBe('phased');
    if (product.spec.kind === 'phased') {
      expect(product.spec.phases).toHaveLength(2);
      expect(product.spec.phases[0].name).toBe('Oil phase');
      expect(product.spec.phases[0].items).toEqual([{ materialId: 'ing-jojoba', pct: 80 }]);
      expect(product.spec.application).toBe('Rinse-off');
      expect(product.spec.paoMonths).toBe(6);
    }
    // The pack is still the product's, on this shape as much as on a mixture.
    expect(product.spec.netQuantity).toBe(30);
  });

  it('does not throw on a phased row whose blob is the wrong shape', () => {
    const product = toProduct(
      productRow(),
      specRow({
        category_id: 'cosmetics',
        kind: 'phased',
        // A phase with no name and a non-array item list, and an application this build has
        // never heard of. All three have to degrade, because one malformed row must not cost
        // the maker every other row on the screen.
        data: { phases: [{ items: 'not a list' }], application: 'Sprayed on', paoMonths: 'six' }
      })
    );

    expect(product.spec.kind).toBe('phased');
    if (product.spec.kind === 'phased') {
      expect(product.spec.phases[0].name).toBe('Phase');
      expect(product.spec.phases[0].items).toEqual([]);
      // Leave-on is the safer of the two to assume: it is the longer exposure, and it is what
      // the blank composition starts as.
      expect(product.spec.application).toBe('Leave-on');
      // ZERO, NOT 12. An unreadable period after opening is an unset one, and the label prints
      // no open-jar figure for it. Defaulting to 12 here put a legal marking on a cosmetic on
      // the strength of a blob this very test describes as the wrong shape.
      expect(product.spec.paoMonths).toBe(0);
    }
  });

  it('reads a bill of materials back out of the data blob', () => {
    const product = toProduct(
      productRow({ net_quantity: 400, net_unit: 'g', packaging_id: 'pkg-device-box' }),
      specRow({
        category_id: 'electronics',
        kind: 'bom',
        product_type: 'Wax warmer',
        data: {
          model: 'WW-100',
          items: [{ materialId: 'cmp-element', quantity: 2, position: 'Base' }],
          ratings: { voltage: '230 V', current: '0.2 A', power: '46 W' }
        }
      })
    );

    expect(product.spec.kind).toBe('bom');
    if (product.spec.kind === 'bom') {
      expect(product.spec.model).toBe('WW-100');
      expect(product.spec.items).toEqual([
      { materialId: 'cmp-element', quantity: 2, position: 'Base' }]
      );
      // The rating plate is printed from these three, so a dropped one is a device shipped
      // with a blank plate rather than a wrong one.
      expect(product.spec.ratings).toEqual({ voltage: '230 V', current: '0.2 A', power: '46 W' });
    }
  });

  it('does not invent a model number or a rating for a device row that has none', () => {
    const product = toProduct(
      productRow(),
      specRow({ category_id: 'electronics', kind: 'bom', data: {} })
    );

    expect(product.spec.kind).toBe('bom');
    if (product.spec.kind === 'bom') {
      // Empty and an em dash, never a plausible-looking model or voltage: a rating plate is a
      // legal statement about a device, and a placeholder that reads like data is how one gets
      // printed. "Not yet assigned" was the old fallback here — a sentence rather than a blank,
      // which is worse in a field whose contents reach a plate. It is now the input's
      // placeholder, where it is visibly not a value.
      expect(product.spec.model).toBe('');
      expect(product.spec.items).toEqual([]);
      expect(product.spec.ratings).toEqual({ voltage: '—', current: '—', power: '—' });
    }
  });

  it('gives a device no safety data sheet, and a mixture one', () => {
    // An article is not a mixture, so there is no sheet to issue. Listing one against a wax
    // warmer would tell a maker they owe a document that does not exist for that product.
    const device = toProduct(productRow(), specRow({ category_id: 'electronics', kind: 'bom' }));
    expect(device.artefacts.some((artefact) => artefact.type === 'sds')).toBe(false);

    const candle = toProduct(productRow(), specRow());
    expect(candle.artefacts.some((artefact) => artefact.type === 'sds')).toBe(true);
  });
});

/**
 * The composition a new product starts from.
 *
 * Every value here ends up on a label or in a derivation, and the ones that vary by product
 * type are the ones a refactor flattens without noticing: a room spray filled into a candle
 * tumbler, or a wax melt whose net quantity prints in millilitres. `netUnit` in particular is
 * a legal field — the average-quantity rules are about a declared weight or volume, and
 * declaring the wrong one is not a cosmetic bug.
 */
describe('the composition a new product starts from', () => {
  const homeFragrance = categoryById('home-fragrance');

  it('fills a candle and a melt by weight, and a diffuser and a spray by volume', () => {
    expect(blankSpec(homeFragrance, 'Container candle').netUnit).toBe('g');
    expect(blankSpec(homeFragrance, 'Wax melt').netUnit).toBe('g');
    expect(blankSpec(homeFragrance, 'Reed diffuser').netUnit).toBe('ml');
    expect(blankSpec(homeFragrance, 'Room spray').netUnit).toBe('ml');
  });

  /**
   * THE ASSERTION HERE IS THE OPPOSITE OF THE ONE IT REPLACES, and the reversal is the point.
   *
   * It used to require that each product type start in a specific base and a specific pack —
   * 'ing-dpg' for a diffuser, 'ing-crw45' for a melt, 'pkg-tumbler-250' for a candle — on the
   * reasoning that a diffuser base in a candle is a product that cannot be made. That
   * reasoning was sound and the conclusion was still wrong: the maker was never asked. The
   * new-product dialog collects a name, a code, a category and a type, and the INSERT behind
   * it carried one particular wax from a supplier they may never have bought from, in one
   * particular 250 ml amber tumbler, at 100 g. All three print: the wax into the
   * classification, the tumbler's capacity into the CLP minimum label size, the 100 g onto the
   * label itself.
   *
   * Those defaults existed because there was nowhere else to point — materials were a shipped
   * catalogue and an empty base derived silently to nothing. Materials are the maker's own
   * rows now, an unresolved id is reported rather than skipped, and the pickers are populated
   * from the register. So the composition starts empty and stays empty until somebody chooses,
   * and the composition stage raises each gap as outstanding work instead. What survives from
   * the old test is the ban on plausible data, applied to the fields it used to exempt.
   */
  it('seeds no base, no packaging, no dye and no quantity — nobody has chosen one', () => {
    for (const type of ['Container candle', 'Wax melt', 'Reed diffuser', 'Room spray']) {
      const spec = blankSpec(homeFragrance, type);
      expect(spec.packagingId).toBe('');
      // A quantity is a declaration under the average-quantity rules. Zero is unset, and the
      // screens render it as unset rather than printing "0 g" on a container that is not empty.
      expect(spec.netQuantity).toBe(0);
      if (spec.kind === 'mixture') {
        expect(spec.baseId).toBe('');
        expect(spec.dyeId).toBe('');
        // Not "None", which is an answer about the formula rather than the absence of one.
        expect(spec.additive).toBe('');
      }
    }
  });

  it('leaves a cosmetic and a device empty of packaging too', () => {
    const cosmetic = blankSpec(categoryById('cosmetics'), 'Face oil');
    const device = blankSpec(categoryById('electronics'), 'Wax warmer');
    expect(cosmetic.packagingId).toBe('');
    expect(device.packagingId).toBe('');
    expect(cosmetic.netQuantity).toBe(0);
    expect(device.netQuantity).toBe(0);
  });

  it('carries no id from the deleted catalogue anywhere in a new composition', () => {
    // The catalogue's ids had a shape — 'ing-', 'pkg-', 'cmp-' — and the cheapest way for one
    // to come back is a default somebody restores because a screen looked empty without it.
    for (const category of ['home-fragrance', 'cosmetics', 'electronics'] as const) {
      const pack = categoryById(category);
      const json = JSON.stringify(blankSpec(pack, pack.productTypes[0]));
      expect(json).not.toMatch(/"(ing|pkg|cmp)-/);
    }
  });

  it('starts a fragrance load at zero rather than at a plausible number', () => {
    // The load drives the CLP classification. A default of 8% would classify a product nobody
    // has weighed, and the classification is the whole output.
    const candle = blankSpec(homeFragrance, 'Container candle');
    if (candle.kind === 'mixture') {
      expect(candle.load).toBe(0);
      expect(candle.fragranceId).toBe('');
    }
  });

  it('carries a starting material through when the product was begun from a sheet', () => {
    const fromSheet = blankSpec(homeFragrance, 'Container candle', 'ing-black-fig');
    if (fromSheet.kind === 'mixture') expect(fromSheet.fragranceId).toBe('ing-black-fig');
  });

  it('starts a device with no electrical ratings, rather than with plausible ones', () => {
    // THE ONE VALUE IN blankSpec THAT WOULD HAVE BEEN A LEGAL MARKING. It seeded
    // 5 V / 2 A / 10 W: the three numbers a rating plate is printed from, invented by us,
    // and not distinguishable from ones a maker had entered. A wax warmer is a mains
    // product. The em dash is what `toProduct` maps an absent rating to, so the seed and the
    // read now agree, and a plate cannot carry a figure nobody stated.
    const device = blankSpec(categoryById('electronics'), 'Wax warmer');
    expect(device.kind).toBe('bom');
    if (device.kind === 'bom') {
      expect(device.ratings).toEqual({ voltage: '—', current: '—', power: '—' });
      // Belt and braces, and the assertion that survives a change of placeholder: whatever
      // it is, it may not parse as a quantity anybody could print.
      for (const value of Object.values(device.ratings)) {
        expect(value).not.toMatch(/\d/);
      }
    }
  });

  it('starts a cosmetic with empty phases and no period after opening', () => {
    const cosmetic = blankSpec(categoryById('cosmetics'), 'Face oil');
    expect(cosmetic.kind).toBe('phased');
    if (cosmetic.kind === 'phased') {
      expect(cosmetic.phases.map((phase) => phase.name)).toEqual(['Oil phase', 'Cool down']);
      // Empty, not seeded. A phase list with ingredients in it is a recipe nobody wrote.
      expect(cosmetic.phases.every((phase) => phase.items.length === 0)).toBe(true);
      /**
       * ZERO, AND THIS IS THE ONE THAT WAS PRINTING.
       *
       * It seeded 12, `derivePhased` emitted a Period after opening group unconditionally, and
       * the label preview rendered "12M" at actual size — a legal marking on a cosmetic, from a
       * constant, that nothing had measured. The obligations list on the same screen
       * simultaneously read "Neither a period after opening nor a date of minimum durability is
       * shown". Both halves read this field now, so they cannot disagree again.
       */
      expect(cosmetic.paoMonths).toBe(0);
    }
  });

  it('starts a device with no model and no components', () => {
    const device = blankSpec(categoryById('electronics'), 'Wax warmer');
    expect(device.kind).toBe('bom');
    if (device.kind === 'bom') {
      expect(device.model).toBe('');
      expect(device.items).toEqual([]);
    }
  });
});

describe('classifying a refused write', () => {
  it('matches the SKU meter on its hint, not on its sentence', () => {
    // The trigger's own comment: "Match the hint, never the sentence: the sentence is
    // customer-facing copy and will be rewritten." So a reworded message must still classify.
    expect(
      classifyWriteError({
        code: 'P0001',
        hint: 'sku_limit_reached',
        message: 'anything at all, rewritten next week'
      }).reason
    ).toBe('sku_limit');
  });

  it('reads a unique violation as a duplicate product code', () => {
    expect(classifyWriteError({ code: '23505', message: 'duplicate key' }).reason).toBe(
      'duplicate_sku'
    );
  });

  /**
   * The two account hints, against the error shapes a real Postgres actually returns.
   *
   * These tests used to assert `23502 -> no_account`, with comments explaining that a null
   * account_id arrives as a not-null violation. It does not, and the suite was therefore green
   * on a premise the database disproves. RLS evaluates its WITH CHECK before table
   * constraints, so `is_member_of(null)` refuses the row first and the NOT NULL is never
   * reached: 23502 is unreachable on these two tables from a browser, and `no_account` was
   * dead code that had never once rendered. Section 7c of the migration exists to answer the
   * question ahead of RLS, and it answers with P0001 plus a hint.
   */
  it('reads the account_missing hint as an account that is not set up yet', () => {
    const classified = classifyWriteError({
      code: 'P0001',
      hint: 'account_missing',
      message: 'There is no account to save this into yet.'
    });
    expect(classified.reason).toBe('no_account');
    // This is the one case where finishing signup is the fix, so the copy has to point at it.
    expect(classified.message).toMatch(/signup/i);
  });

  it('does not tell an ambiguous account to wait for something that is not coming', () => {
    // Two active memberships. Permanent until the app sends an account_id — the migration is
    // explicit: "Never tell this customer to wait; nothing is coming." A retry cannot work,
    // so no retry may be offered.
    const classified = classifyWriteError({
      code: 'P0001',
      hint: 'account_ambiguous',
      message: 'it is not clear which account it belongs to'
    });
    expect(classified.reason).toBe('account_ambiguous');
    expect(classified.message).toMatch(/nothing has been saved/i);
    expect(classified.message).not.toMatch(/try again|in a moment|being set up/i);
  });

  it('matches the hint even though all three arrive on the same P0001', () => {
    // The meter, the missing account and the ambiguous account share a code. Branching on the
    // code first would collapse them into one indistinguishable failure.
    const codes = ['sku_limit_reached', 'account_missing', 'account_ambiguous'].map(
      (hint) => classifyWriteError({ code: 'P0001', hint, message: 'x' }).reason
    );
    expect(new Set(codes).size).toBe(3);
  });

  it('never surfaces the database sentence to a customer', () => {
    const classified = classifyWriteError({
      code: 'P0001',
      hint: 'sku_limit_reached',
      message: 'SKU limit reached: this account already holds 3 of 3 SKUs.'
    });
    expect(classified.message).not.toContain('SKU limit reached:');
  });

  it('falls back to a generic failure for anything it does not know', () => {
    expect(classifyWriteError({ code: '42P01', message: 'relation does not exist' }).reason).toBe(
      'failed'
    );
    expect(classifyWriteError(null).reason).toBe('failed');
  });

  it('names no cause for a bare policy refusal, and offers no retry either', () => {
    // 42501 with no hint is what a genuine cross-account attempt returns, and the migration
    // keeps it deliberately uninformative. The app must not diagnose it as an account problem.
    //
    // BUT IT MUST NOT FALL THROUGH TO THE GENERIC FAILURE, which is what it used to do and is
    // the other half of the same rule. Contract item 5 lists three ways to earn a 42501, and
    // the one a paying customer actually reaches is a suspended membership — for which
    // "please try again in a moment" is a promise nothing will keep. The maker retries, it
    // fails identically, forever. So: still no diagnosis, and no waiting.
    const classified = classifyWriteError({
      code: '42501',
      message: 'new row violates row-level security policy'
    });
    expect(classified.reason).toBe('refused');
    expect(classified.message).not.toMatch(/account|suspend|member/i);
    expect(classified.message).not.toMatch(/try again in a moment|in a moment/i);
    expect(classified.message).toMatch(/nothing has been saved/i);
  });

  it('no longer treats a not-null violation as an account problem', () => {
    // Unreachable for account_id, and on these tables it can now only mean a genuinely null
    // non-account column. Diagnosing that as "your account is not set up" would be inventing
    // a cause.
    expect(classifyWriteError({ code: '23502', message: 'null value in column' }).reason).toBe(
      'failed'
    );
  });
});

/**
 * Creating a product, and the two rows it takes.
 *
 * Every case below is about the SECOND insert failing, because that is where a specification
 * is left behind and a decision has to be made about it. Getting that decision wrong in the
 * direction the code used to has no recovery path in this app at all: the browser holds no
 * DELETE on specifications and there is no un-archive.
 */
describe('creating a product', () => {
  const SPEC = { id: 'spec-1', name: 'Black Fig and Cassis', category_id: 'home-fragrance', kind: 'mixture' };
  const PRODUCT = { id: 'prod-1', specification_id: 'spec-1', name: 'Black Fig and Cassis', sku: 'CC-BFC-220' };

  const input = {
    name: 'Black Fig and Cassis',
    sku: 'CC-BFC-220',
    categoryId: 'home-fragrance' as const,
    productType: 'Container candle'
  };

  beforeEach(() => {
    db.state.specInsert = { data: SPEC, error: null };
    db.state.productInsert = { data: PRODUCT, error: null };
    db.state.lookup = { data: null, error: null };
    db.state.specPayload = null;
    db.state.productPayload = null;
    db.state.lookupFilters = [];
    db.state.archived = [];
  });

  beforeEach(() => {
    recordLog.created.length = 0;
    recordLog.changed.length = 0;
  });

  it('writes a line to the record log for a product that was actually created', async () => {
    const result = await createProduct(input, 'acct-1111');

    expect(result.ok).toBe(true);
    expect(recordLog.created).toHaveLength(1);
    const [accountId, product] = recordLog.created[0];
    // The account comes from the entitlement, exactly as the two INSERTs' does. There is no
    // second source for it anywhere in this file.
    expect(accountId).toBe('acct-1111');
    expect(product.id).toBe('prod-1');
  });

  it('writes no log line for a create the database refused', async () => {
    db.state.specInsert = { data: null, error: { code: 'P0001', hint: 'sku_limit_reached' } };

    const result = await createProduct(input, 'acct-1111');

    expect(result.ok).toBe(false);
    // A record of a product that was never created is worse than a missing record: the log is
    // append-only, so nobody could ever take it back out.
    expect(recordLog.created).toHaveLength(0);
  });

  it('writes the log line for a create recovered from a lost response, because it did happen', async () => {
    db.state.productInsert = { data: null, error: { message: 'Failed to fetch' } };
    db.state.lookup = { data: PRODUCT, error: null };

    const result = await createProduct(input, 'acct-1111');

    expect(result.ok).toBe(true);
    expect(recordLog.created).toHaveLength(1);
  });


  it('sends the account id it was given, on both rows', async () => {
    await createProduct(input, 'acct-1111');
    expect(db.state.specPayload?.account_id).toBe('acct-1111');
    expect(db.state.productPayload?.account_id).toBe('acct-1111');
  });

  it('omits the column entirely when no account has been resolved', async () => {
    // Omitted means the database's own default decides. Sending null would be an explicit
    // claim that the row belongs to no account, and would fail the NOT NULL constraint.
    await createProduct(input);
    expect(db.state.specPayload).not.toHaveProperty('account_id');
    expect(db.state.productPayload).not.toHaveProperty('account_id');
  });

  /**
   * THE ACCOUNT IS THE SESSION'S, AND THERE IS NO SECOND WAY IN.
   *
   * Rule 2 at the top of lib/products.ts: "NOTHING IN THIS FILE EVER TAKES AN ACCOUNT ID FROM A
   * FORM, a URL or a props chain that a screen could influence. It comes from the entitlement
   * read and nowhere else." The entitlement is resolved by the database for this deployment's
   * brand, so the id in the parameter is the session's; `input` is the dialog's, and the dialog
   * is the half a screen could reach.
   *
   * Today the type is the enforcement — NewProductInput has no account field — and a type is
   * exactly the thing a later refactor widens without meaning to (a spread of a form object, a
   * `Record<string, unknown>` payload, an added optional field). This asserts the behaviour
   * underneath the type, so widening it fails here rather than in production. RLS would still
   * refuse an id that is not the caller's; what it would NOT refuse is a second id of the
   * caller's own, which is how a maker's product gets filed in the wrong one of their
   * workspaces silently — the exact failure `account_ambiguous` exists to prevent.
   */
  it('takes the account from the session, never from anything the caller passed in', async () => {
    const fromTheScreen = {
      ...input,
      account_id: 'acct-somebody-elses',
      accountId: 'acct-somebody-elses'
    } as NewProductInput;

    await createProduct(fromTheScreen, 'acct-1111');

    expect(db.state.specPayload?.account_id).toBe('acct-1111');
    expect(db.state.productPayload?.account_id).toBe('acct-1111');
    // And no second spelling of it rode along into either payload, where a column rename
    // would one day pick it up.
    expect(db.state.specPayload).not.toHaveProperty('accountId');
    expect(db.state.productPayload).not.toHaveProperty('accountId');
  });

  it('sends no account at all when the session has none, whatever the caller passed', async () => {
    // The unresolved case is where a supplied id would be most tempting and most wrong: with
    // nothing to check it against, the column default — current_account_id() — is the only
    // thing entitled to decide.
    const fromTheScreen = { ...input, account_id: 'acct-somebody-elses' } as NewProductInput;

    await createProduct(fromTheScreen);

    expect(db.state.specPayload).not.toHaveProperty('account_id');
    expect(db.state.productPayload).not.toHaveProperty('account_id');
  });

  /**
   * The meter's refusal, as a maker reads it.
   *
   * classifyWriteError is tested above in isolation; this is the same refusal through the
   * function a screen actually calls, because the classification only matters if createProduct
   * returns it rather than the generic failure. The message must be the app's own sentence —
   * SkuLimitNotice states the allowance from the entitlement, and the number has one source —
   * and it must never be the database's, which is customer-facing copy the migration reserves
   * the right to rewrite.
   */
  it('surfaces the SKU limit as the limit message, not as a Postgres error', async () => {
    db.state.productInsert = {
      data: null,
      error: {
        code: 'P0001',
        hint: 'sku_limit_reached',
        message: 'SKU limit reached: this account already holds 3 of 3 SKUs.'
      }
    };

    const result = await createProduct(input, 'acct-1111');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('sku_limit');
      expect(result.message).toMatch(/as many products as its plan allows/i);
      // Not the trigger's sentence, and nothing that reads like a database at all.
      expect(result.message).not.toContain('SKU limit reached:');
      expect(result.message).not.toMatch(/P0001|violates|constraint|row-level|null value/i);
      // It states no number: the allowance has one source and this is not it.
      expect(result.message).not.toMatch(/\d/);
    }
  });

  it('writes a cosmetic as phases and a device as a bill of materials', async () => {
    // The shape-varying half of a composition goes in `specifications.data`, and the typed
    // columns stay null for a shape that has no fragrance and no load. Sending a mixture's
    // columns for a face oil would classify it against a recipe it does not have.
    await createProduct(
      { name: 'Rosehip Face Oil', sku: 'FO-RH-30', categoryId: 'cosmetics', productType: 'Face oil' },
      'acct-1111'
    );
    expect(db.state.specPayload?.kind).toBe('phased');
    expect(db.state.specPayload?.fragrance_id).toBeNull();
    expect(db.state.specPayload?.load).toBeNull();
    expect(db.state.specPayload?.data).toHaveProperty('phases');

    await createProduct(
      { name: 'Wax Warmer', sku: 'WW-100', categoryId: 'electronics', productType: 'Wax warmer' },
      'acct-1111'
    );
    expect(db.state.specPayload?.kind).toBe('bom');
    expect(db.state.specPayload?.data).toHaveProperty('items');
    expect(db.state.specPayload?.data).toHaveProperty('ratings');
  });

  it('trims the name and the code, and sends an empty code as no code', async () => {
    // A SKU of '' would take the unique index's slot for the empty string, so the second
    // product created without a code would be told somebody already has that code.
    await createProduct({ ...input, name: '  Black Fig  ', sku: '   ' }, 'acct-1111');
    expect(db.state.specPayload?.name).toBe('Black Fig');
    expect(db.state.productPayload?.sku).toBeNull();
  });

  /**
   * The first insert failing, which is the ordinary case and the one with nothing to clean up.
   *
   * A product carries the foreign key, so the specification has to exist before it can be
   * written — which means a refused specification must leave the product insert UNSENT. If it
   * were ever sent anyway it would be sent with a specification_id of nothing, and the
   * interesting half of this function (was a specification left behind? may it be archived?)
   * would be reasoning about a row that was never created.
   */
  it('never reaches the second table when the first insert was refused', async () => {
    db.state.specInsert = {
      data: null,
      error: { code: 'P0001', hint: 'sku_limit_reached', message: 'SKU limit reached' }
    };

    const result = await createProduct(input, 'acct-1111');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('sku_limit');
    expect(db.state.productPayload).toBeNull();
    // Nothing was created, so nothing may be archived — an archive here would be reaching for
    // a row id that does not exist.
    expect(db.state.archived).toEqual([]);
  });

  it('treats a specification insert that returned no row as a failure, not a success', async () => {
    // No error and no row. Nothing to hang a product off, and carrying on would insert one
    // with an undefined specification_id.
    db.state.specInsert = { data: null, error: null };

    const result = await createProduct(input, 'acct-1111');

    expect(result.ok).toBe(false);
    expect(db.state.productPayload).toBeNull();
  });

  it('archives the specification when the meter definitely refused the product', async () => {
    db.state.productInsert = {
      data: null,
      error: { code: 'P0001', hint: 'sku_limit_reached', message: 'SKU limit reached' }
    };
    const result = await createProduct(input, 'acct-1111');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('sku_limit');
    expect(db.state.archived).toEqual(['spec-1']);
  });

  it('leaves the specification alone when the failure carried no refusal', async () => {
    // A dropped socket or a proxy 5xx: supabase-js hands back an error with no Postgres code.
    // Nothing here establishes that the database refused anything, so nothing may be archived
    // on the strength of it.
    db.state.productInsert = { data: null, error: { message: 'Failed to fetch' } };
    const result = await createProduct(input, 'acct-1111');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unknown');
    expect(db.state.archived).toEqual([]);
  });

  it('says the outcome is unknown rather than that nothing has changed', async () => {
    // The lookup that would have told us whether the insert landed failed too. The code
    // already declines to archive on this path — an explicit admission that it does not know
    // — and then used to return "Nothing has changed. Please try again in a moment." A blind
    // retry from there either collides with the unique index or spends a second SKU slot of a
    // three-SKU plan on one intended product.
    db.state.productInsert = { data: null, error: { message: 'Failed to fetch' } };
    db.state.lookup = { data: null, error: { message: 'Failed to fetch' } };

    const result = await createProduct(input, 'acct-1111');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unknown');
      expect(result.message).not.toMatch(/nothing has changed/i);
      expect(result.message).toMatch(/check your products/i);
    }
    expect(db.state.archived).toEqual([]);
  });

  it('archives the specification when the account hints refuse the product row', async () => {
    // Not reachable today — both inserts carry the same account object, so the specification
    // fails first — but a refusal token missing from the archive decision is a specification
    // silently orphaned, and that is the failure this whole path exists for.
    db.state.productInsert = {
      data: null,
      error: { code: 'P0001', hint: 'account_ambiguous', message: 'which account?' }
    };
    const result = await createProduct(input, 'acct-1111');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('account_ambiguous');
    expect(db.state.archived).toEqual(['spec-1']);
  });

  it('returns the product when the insert won and only the answer was lost', async () => {
    // The expensive case. The row committed, the response did not come back, and archiving
    // the specification would hide a product that counts against the plan allowance on every
    // screen, for good.
    db.state.productInsert = { data: null, error: { message: 'Failed to fetch' } };
    db.state.lookup = { data: PRODUCT, error: null };

    const result = await createProduct(input, 'acct-1111');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe('prod-1');
    expect(db.state.archived).toEqual([]);
    expect(db.state.lookupFilters).toContainEqual(['specification_id', 'spec-1']);
  });

  it('treats a product insert that answered nothing as an unknown outcome', async () => {
    // No row and no error. There is no Postgres code to call a refusal, so the specification
    // stays — an orphaned composition is invisible and meters nothing, whereas an archived one
    // under a live product is unreachable from the browser for good.
    db.state.productInsert = { data: null, error: null };
    db.state.lookup = { data: null, error: null };

    const result = await createProduct(input, 'acct-1111');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unknown');
      expect(result.message).toMatch(/check your products/i);
    }
    expect(db.state.archived).toEqual([]);
  });

  it('archives nothing when it could not find out what happened', async () => {
    db.state.productInsert = { data: null, error: { code: '23505', message: 'duplicate key' } };
    db.state.lookup = { data: null, error: { message: 'Failed to fetch' } };

    const result = await createProduct(input, 'acct-1111');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('duplicate_sku');
    // A lookup that itself failed proves nothing either way. An orphaned specification is
    // invisible and meters nothing; an archived one under a live product is unreachable.
    expect(db.state.archived).toEqual([]);
  });
});

/**
 * Saving an edited composition, which is two untransacted UPDATEs across two tables.
 *
 * PostgREST cannot span them, so the pair is not atomic and the interesting case is the
 * second failing after the first has committed. That leaves the new recipe stored against the
 * old pack — a product the maker never approved, and the one that drives both the label and
 * the sixteen-section sheet. What the screen says about it is the whole test.
 */
describe('saving a composition', () => {
  const product = {
    id: 'prod-1',
    specificationId: 'spec-1',
    name: 'Black Fig and Cassis',
    sku: 'CC-BFC-220',
    categoryId: 'home-fragrance' as const,
    markets: ['GB' as const],
    regimes: [],
    spec: {
      kind: 'mixture' as const,
      productType: 'Container candle',
      baseId: 'ing-crw45',
      fragranceId: 'ing-bfc',
      load: 8,
      dyeId: 'ing-no-dye',
      additive: 'None',
      netQuantity: 220,
      netUnit: 'g' as const,
      packagingId: 'pkg-tumbler-250'
    },
    artefacts: [],
    identifiers: {},
    evidence: { obligations: {}, sdsSections: {} }
  };

  beforeEach(() => {
    // A row came back from each. That is what a write that actually happened looks like, and
    // the default has to be it — a `data: null` default would have made every test below pass
    // through the refusal branch and hidden the thing this suite is for.
    db.state.specUpdate = { data: [{ id: 'spec-1' }], error: null };
    db.state.productUpdate = { data: [{ id: 'prod-1' }], error: null };
    db.state.updated = [];
    db.state.updatePayloads = [];
  });

  beforeEach(() => {
    recordLog.changed.length = 0;
  });

  it('records a composition change once both halves are stored', async () => {
    const result = await saveComposition(product, product.spec, 'acct-1111');

    expect(result.ok).toBe(true);
    expect(recordLog.changed).toHaveLength(1);
    expect(recordLog.changed[0][0]).toBe('acct-1111');
  });

  it('records nothing when only half of the edit landed', async () => {
    // A partial save DID commit the composition, so a log line would not be false — but the
    // maker is being asked to press save again, and two entries for one edit would read as
    // two edits. The successful save writes the line.
    db.state.productUpdate = { data: [], error: null };

    const result = await saveComposition(product, product.spec, 'acct-1111');

    expect(result.ok === false && result.reason).toBe('partial_save');
    expect(recordLog.changed).toHaveLength(0);
  });

  it('still saves when no account was passed, and simply does not log it', async () => {
    const result = await saveComposition(product, product.spec);

    expect(result.ok).toBe(true);
    // The stub records the call; the real implementation returns early on a null account. A
    // composition edit refusing to commit because we could not file its log entry would be the
    // tail wagging the dog.
    expect(recordLog.changed[0]?.[0] ?? null).toBeNull();
  });


  it('stores an unchosen material and an unstated quantity as null, never as blank', async () => {
    // Both halves of this are label copy. A net quantity of 0 is a DECLARATION — the average
    // quantity rules are about a stated weight or volume — so storing a literal 0 would print
    // "0 g" on a container that is not empty. And an empty string in base_id or dye_id is a
    // material id that resolves to nothing, which a derivation reads as a missing material
    // rather than as one nobody has picked yet.
    const unfinished = { ...product.spec, baseId: '', dyeId: '', packagingId: '', netQuantity: 0 };

    const result = await saveComposition(product, unfinished);

    expect(result.ok).toBe(true);
    const [[, specPayload], [, packPayload]] = db.state.updatePayloads;
    expect(specPayload.base_id).toBeNull();
    expect(specPayload.dye_id).toBeNull();
    expect(packPayload.net_quantity).toBeNull();
    expect(packPayload.packaging_id).toBeNull();
    // The unit still goes: it is not a claim about how much is in the container.
    expect(packPayload.net_unit).toBe('g');
  });

  it('does not offer a retry on a write the policy refused', async () => {
    db.state.specUpdate = { data: null, error: { code: '42501', message: 'refused' } };
    const result = await saveComposition(product, product.spec);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // 42501 has three causes and the database will not say which (contract item 5). What
      // the app must not do is dress the refusal up as weather: "try again in a moment" to a
      // suspended maker is an invitation to press the button forever.
      expect(result.reason).toBe('refused');
      expect(result.message).toMatch(/nothing has changed/i);
      expect(result.message).not.toMatch(/try again in a moment/i);
    }
    // And it never reached the second table, so there is nothing to be half-saved.
    expect(db.state.updated).toEqual(['specifications']);
  });

  it('does not report success for an update that changed nothing', async () => {
    // THE ONE THIS PAIR OF `.select()` CALLS EXISTS FOR. An UPDATE refused by an RLS `using`
    // clause matches no rows and does NOT raise, so this is exactly the shape supabase-js
    // hands back when a maker is suspended, or removed from the account, with the
    // specification screen open. It used to return {ok: true}; the screen said it had saved
    // and then reloaded into "No such product".
    db.state.specUpdate = { data: [], error: null };
    const result = await saveComposition(product, product.spec);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('refused');
      expect(result.message).not.toMatch(/try again in a moment/i);
    }
    // Nothing committed, so the second statement must not have been sent either — a
    // 'partial_save' here would claim the composition was stored on no evidence at all.
    expect(db.state.updated).toEqual(['specifications']);
  });

  it('admits a half-save rather than claiming nothing changed', async () => {
    // The composition committed and the pack did not. "Nothing has changed" here is false in
    // the direction that makes somebody stop trying — and stopping is what makes it durable,
    // because pressing save again heals it.
    db.state.productUpdate = { data: null, error: { message: 'Failed to fetch' } };
    const result = await saveComposition(product, product.spec);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('partial_save');
      expect(result.message).not.toMatch(/nothing has changed/i);
      expect(result.message).toMatch(/composition was stored/i);
      expect(result.message).toMatch(/save again/i);
    }
    expect(db.state.updated).toEqual(['specifications', 'products']);
  });

  it('reads a silently refused pack update as a half-save too', async () => {
    // Same silence as the case above, on the second table. The composition IS stored — a row
    // came back from it — so this is a half-save however the pack failed, and the copy that
    // says so is the only one available.
    db.state.productUpdate = { data: [], error: null };
    const result = await saveComposition(product, product.spec);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('partial_save');
    expect(db.state.updated).toEqual(['specifications', 'products']);
  });

  it('writes both halves when both succeed', async () => {
    const result = await saveComposition(product, product.spec);
    expect(result.ok).toBe(true);
    expect(db.state.updated).toEqual(['specifications', 'products']);
  });

  it('refuses to guess which composition to rewrite when the product carries no id', async () => {
    // A product read back without its specification id cannot be edited: the only way to
    // proceed would be to pick a specification, and a wrong pick rewrites the classification —
    // the fragrance, the base, the load — of a DIFFERENT product. Silently. So it does not
    // proceed, and it sends nothing.
    const result = await saveComposition({ ...product, specificationId: '' }, product.spec);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('failed');
    expect(db.state.updated).toEqual([]);
  });
});

/**
 * A read that failed, which must never arrive on a screen as "you have no products".
 *
 * This is the sentence lib/product-store.tsx was written around: "A failed read rendered as
 * 'you have no products yet' is indistinguishable from a brand new account, and to a maker with
 * forty SKUs it reads as 'your data is gone'." The store can only tell the two apart if the
 * reader does — `{ok: true, products: []}` and `{ok: false}` are the same number of rows and
 * completely different sentences, and the difference is made here.
 *
 * The failure is deliberately not the Postgres message either. A read failure is ours, the
 * screen says so and offers a retry, and a customer is never shown a relation name.
 */
describe('a products read that could not be answered', () => {
  beforeEach(() => {
    db.state.lookupFilters = [];
    db.state.productsRead = { data: [], error: null };
    db.state.specificationsRead = { data: [], error: null };
  });

  it('fails rather than reporting an empty account when the products read errors', async () => {
    db.state.productsRead = { data: null, error: { code: '08006', message: 'connection failure' } };

    const result = await fetchProducts('acct-1111');

    expect(result.ok).toBe(false);
    // The thing that must not happen: ok with nothing in it. That is the empty state, and the
    // empty state is a claim about the account that nothing here has established.
    if (result.ok) expect(result.products).not.toEqual([]);
    if (!result.ok) {
      expect(result.message).toMatch(/this is us, not you/i);
      expect(result.message).toMatch(/nothing has been lost/i);
      expect(result.message).not.toMatch(/connection failure|08006/);
    }
  });

  it('fails when only the specifications read errors', async () => {
    // Half an answer is not an answer. The products came back, but without their compositions
    // every one of them would be dropped by the join below — which would render as an empty
    // account off the back of a read that half worked.
    db.state.productsRead = { data: [productRow()], error: null };
    db.state.specificationsRead = { data: null, error: { message: 'statement timeout' } };

    const result = await fetchProducts('acct-1111');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toMatch(/statement timeout/);
  });

  it('reports an account that genuinely holds nothing as an answer, not as a failure', async () => {
    // The other half of the same rule, and the first screen every real customer sees. An empty
    // list from a read that WORKED is the answer, and the store is entitled to say so.
    const result = await fetchProducts('acct-1111');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.products).toEqual([]);
  });

  it('drops a product whose composition did not come back rather than rendering it blank', async () => {
    // Reachable only by archiving a specification out from under a live product. There is no
    // composition, so there is no classification, no label and no sheet — a row on the screen
    // would be a product with nothing behind it, and every screen that opened it would fail.
    db.state.productsRead = {
      data: [productRow(), productRow({ id: 'prod-2', specification_id: 'spec-archived' })],
      error: null
    };
    db.state.specificationsRead = { data: [specRow()], error: null };

    const result = await fetchProducts('acct-1111');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.products.map((entry) => entry.id)).toEqual(['prod-1']);
    }
  });

  it('scopes every read to the account, and to live rows only', async () => {
    await fetchProducts('acct-1111');

    // Once per table, and there are FOUR now: products, specifications, artefacts and the
    // record log. RLS is the boundary; this is the narrowing, and dropping it on any one of
    // them is what renders one workspace of a person's under another one's chrome. The two
    // that joined carry a maker's print history and their compliance record, so an unscoped
    // read of either is the same defect with worse contents.
    const accountFilters = db.state.lookupFilters.filter(([column]) => column === 'account_id');
    expect(accountFilters).toEqual([
    ['account_id', 'acct-1111'],
    ['account_id', 'acct-1111'],
    ['account_id', 'acct-1111'],
    ['account_id', 'acct-1111']]
    );
  });
});

/**
 * Reading the list, and the one case where RLS alone is not the same answer as "this account".
 *
 * `accountId` comes from the entitlement, which the database resolved for THIS deployment's
 * brand. Null means we do not know it, and the read then falls back to RLS — which returns
 * every account the caller is a member of, not one. With one account per person those are the
 * same list, which is exactly why the gap is easy to ship.
 *
 * The way it stops being the same list is not hypothetical: a suspended membership makes
 * `is_member_of` false for that account, so `entitlements.account_id` comes back NULL while
 * RLS quietly keeps returning the person's OTHER account's rows. The fallback would then lay
 * a sibling brand's products out under this brand's heading — the wrong workspace, which is
 * what §1 of the migration says must not happen ("those are two accounts and they must not see
 * each other's products").
 *
 * `account_id` is read back for this and only this. Nothing renders it.
 */
describe('reading the products list without an account to scope it to', () => {
  beforeEach(() => {
    db.state.lookupFilters = [];
    db.state.productsRead = { data: [], error: null };
    db.state.specificationsRead = { data: [], error: null };
  });

  /**
   * A NULL ID MEANS DO NOT READ.
   *
   * This used to read unfiltered and then check whether the rows spanned two accounts. That
   * guard was blind to the case that actually matters — ONE account, the WRONG one — which
   * is what a null id returns for somebody who holds a Batchlabel account and a sibling-brand
   * account. Dropping the predicate does not narrow the query to nothing; it widens it to
   * everything the caller may see, and RLS then hides only the rows they may not.
   */
  it('refuses outright rather than reading unfiltered', async () => {
    db.state.productsRead = { data: [productRow()], error: null };
    db.state.specificationsRead = { data: [specRow()], error: null };

    const result = await fetchProducts(null);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Nothing failed and nothing is lost — it is the wrong-workspace risk being refused —
      // and the copy has to say so, or it reads as data loss.
      expect(result.message).toMatch(/nothing has been lost/i);
      // Not a retry prompt: a second attempt resolves to the same null id.
      expect(result.message).not.toMatch(/try again|in a moment/i);
    }
  });

  it('issues no query at all, so a single wrong account cannot come back', async () => {
    // The previous behaviour returned this row. One account, so the span check passed, and it
    // rendered under whichever brand's deployment asked. The refusal has to happen before the
    // request, not after it.
    db.state.productsRead = {
      data: [productRow({ id: 'sibling-1', account_id: 'acct-sibling' })],
      error: null
    };
    db.state.specificationsRead = { data: [specRow()], error: null };

    const result = await fetchProducts(null);

    expect(result.ok).toBe(false);
    expect(db.state.lookupFilters).toEqual([]);
  });

  it('does not second-guess a read it scoped itself', async () => {
    // With an id in hand the filter already guaranteed one account, so the check is not run —
    // and must not be, or a stale account_id on a row would break a correctly scoped read.
    db.state.productsRead = {
      data: [productRow(), productRow({ id: 'prod-2', account_id: 'acct-2222' })],
      error: null
    };
    db.state.specificationsRead = { data: [specRow()], error: null };

    const result = await fetchProducts('acct-1111');

    expect(result.ok).toBe(true);
    expect(db.state.lookupFilters).toContainEqual(['account_id', 'acct-1111']);
  });
});

describe('the schema every domain read and write goes through', () => {
  /**
   * `products` and `specifications` left `public` in 20260804120000 so that the
   * next Orchestrate brand can have a `products` table meaning stock rather than
   * candles. Nothing in the type system holds them there — `.schema()` takes a
   * string — so this is the thing that notices a revert.
   *
   * The failure it guards against is quiet rather than loud: `public.products`
   * does not exist after the move, so a client that drifted back would not throw
   * a nice error. It would 404 on a schema PostgREST does not serve and the
   * screen would say "we could not read your products", or — worse, if somebody
   * ever recreates a decoy in `public` — succeed and report an empty workspace to
   * a maker who has products.
   */
  it('is batchlabel, never public', async () => {
    db.state.productsRead = { data: [productRow()], error: null };
    db.state.specificationsRead = { data: [specRow()], error: null };

    await fetchProducts('acct-1111');

    expect(db.state.schemas.length).toBeGreaterThan(0);
    expect([...new Set(db.state.schemas)]).toEqual(['batchlabel']);
  });

  it('holds for writes too, not only reads', async () => {
    db.state.schemas = [];
    db.state.specInsert = { data: { id: 'spec-1' }, error: null };
    db.state.productInsert = { data: { id: 'prod-1' }, error: null };

    await createProduct(
      { name: 'Amber', sku: 'AMB-1', categoryId: 'home-fragrance', productType: 'candle' },
      'acct-1111'
    );

    expect([...new Set(db.state.schemas)]).toEqual(['batchlabel']);
  });
});

/* ------------------------------------------------------------------------ */

const artefactRow = (over: Partial<ArtefactRow> = {}): ArtefactRow => ({
  id: 'art-1',
  product_id: 'prod-1',
  artefact_type: 'unit-label',
  version: 1,
  width_mm: 52,
  height_mm: 74,
  produced_at: '2026-07-01T09:00:00.000Z',
  printed_at: '2026-07-01T09:00:00.000Z',
  specification_hash: 'hash-a',
  is_placeholder: true,
  notes: null,
  ...over
});

/**
 * The four states an artefact can be in, and why a boolean could not hold them.
 *
 * `current: boolean` resolved every unproduced surface to `true`, so the specification screen
 * painted a green "Current" pill on every row of a list whose every row also said "Not yet
 * produced". A maker scanning the pills concluded their label and their sheet were up to date
 * and in existence. Currency is now a comparison of the hash stored at print time against what
 * `batchlabel.artefact_source_fingerprint` returns now — a database answer, not an assumption.
 */
describe('an artefact, against the composition it was produced from', () => {
  const category = categoryById('home-fragrance');

  const label = (rows: ArtefactRow[], live: string | null) => {
    const surface = artefactsFor(category, 'mixture', rows, live).
    find((a) => a.type === 'unit-label');
    if (!surface) throw new Error('home fragrance has no unit label surface');
    return surface;
  };

  it('is current only when the stored fingerprint still matches', () => {
    expect(label([artefactRow({ specification_hash: 'hash-a' })], 'hash-a').currency).toBe('current');
    expect(label([artefactRow({ specification_hash: 'hash-a' })], 'hash-b').currency).toBe('out-of-date');
  });

  it('is unknown, never current, when the fingerprint could not be computed', () => {
    // The RPC failed, or returned null for a row this caller cannot see. Borrowing either
    // answer here is how a maker is told their label is fine by code that did not look.
    expect(label([artefactRow()], null).currency).toBe('unknown');
    expect(label([artefactRow({ specification_hash: null })], 'hash-a').currency).toBe('unknown');
  });

  it('is not-produced when no row exists, and claims no version or date', () => {
    const surface = label([], 'hash-a');
    expect(surface.currency).toBe('not-produced');
    expect(surface.version).toBe('Not yet produced');
    expect(surface.printedOn).toBe('—');
  });

  it('describes the highest version, because an artefact IS a version', () => {
    const surface = label(
      [
      artefactRow({ id: 'a1', version: 1, specification_hash: 'hash-old' }),
      artefactRow({ id: 'a3', version: 3, specification_hash: 'hash-a' }),
      artefactRow({ id: 'a2', version: 2, specification_hash: 'hash-old' })],
      'hash-a'
    );
    expect(surface.version).toBe('v3');
    expect(surface.currency).toBe('current');
  });

  it('falls back to the production date when nothing was printed', () => {
    const surface = label([artefactRow({ printed_at: null })], 'hash-a');
    expect(surface.printedOn).toBe('2026-07-01T09:00:00.000Z');
  });

  it('treats an unreadable is_placeholder as a placeholder, never as a real file', () => {
    // The column is NOT NULL DEFAULT TRUE, so a null is a shape this build does not
    // understand — and "we are not sure whether Batchlabel generated this file" has exactly
    // one safe reading.
    expect(label([artefactRow({ is_placeholder: null })], 'hash-a').isPlaceholder).toBe(true);
    expect(label([artefactRow({ is_placeholder: true })], 'hash-a').isPlaceholder).toBe(true);
    expect(label([artefactRow({ is_placeholder: false })], 'hash-a').isPlaceholder).toBe(false);
  });
});

/** One product's evidence, or a failure saying the log produced none for it. */
function evidenceFor(map: Map<string, ProductEvidence>, productId: string): ProductEvidence {
  const found = map.get(productId);
  if (!found) throw new Error(`no evidence was grouped under ${productId}`);
  return found;
}

const eventRow = (over: Partial<RecordEventRow> = {}): RecordEventRow => ({
  id: 'ev-1',
  kind: 'compliance.evidence_recorded',
  product_id: 'prod-1',
  occurred_at: '2026-07-01T00:00:00.000Z',
  obligation_id: 'cpr-pif',
  reference: 'PIF-1',
  summary: 'Assembled the product information file.',
  ...over
});

/**
 * Reading the append-only log into the evidence a screen renders.
 *
 * This replaced `products.obligations`, a jsonb column written by nothing, which is why every
 * obligation was permanently outstanding. The rules below are the ones a log has that a flag
 * does not: entries supersede rather than overwrite, and an entry about no product in
 * particular is not evidence about every product.
 */
describe('the evidence a product carries, read from the log', () => {
  it('takes the most recent entry per obligation, the earlier one being superseded', () => {
    // The read orders by occurred_at descending and a correction is a new event, because the
    // log refuses UPDATE three separate ways. First-seen therefore means most recent.
    const map = evidenceByProduct([
    eventRow({ id: 'ev-new', occurred_at: '2026-08-01T00:00:00.000Z', reference: 'PIF-2' }),
    eventRow({ id: 'ev-old', occurred_at: '2026-07-01T00:00:00.000Z', reference: 'PIF-1' })]
    );
    expect(evidenceFor(map, 'prod-1').obligations['cpr-pif'].reference).toBe('PIF-2');
  });

  it('keeps one product\'s record out of another\'s', () => {
    const map = evidenceByProduct([
    eventRow({ id: 'a', product_id: 'prod-1', obligation_id: 'cpr-pif' }),
    eventRow({ id: 'b', product_id: 'prod-2', obligation_id: 'ce-doc-signed' })]
    );
    expect(Object.keys(evidenceFor(map, 'prod-1').obligations)).toEqual(['cpr-pif']);
    expect(Object.keys(evidenceFor(map, 'prod-2').obligations)).toEqual(['ce-doc-signed']);
  });

  it('attaches an account-level event to no product at all', () => {
    // An identity change or a data request is evidence about nothing in particular. Spreading
    // it across every product would be an invented finding on each of them.
    expect(evidenceByProduct([eventRow({ product_id: null })]).size).toBe(0);
  });

  it('reads a safety data sheet review onto the section it names', () => {
    const map = evidenceByProduct([
    eventRow({
      kind: 'compliance.sds_section_reviewed',
      obligation_id: null,
      reference: '4',
      summary: 'Section 4 confirmed.'
    })]
    );
    expect(evidenceFor(map, 'prod-1').sdsSections[4].summary).toBe('Section 4 confirmed.');
  });

  it('drops a review that names no section rather than guessing one', () => {
    // Marking the wrong section signed off is worse than showing it still outstanding: it
    // takes a row off a work queue that a competent person has never looked at.
    for (const reference of [null, 'four', '0', '17', '']) {
      const map = evidenceByProduct([
      eventRow({ kind: 'compliance.sds_section_reviewed', obligation_id: null, reference })]
      );
      expect(map.get('prod-1')?.sdsSections ?? {}).toEqual({});
    }
  });
});

/**
 * The two reads that joined the products list, and what happens when one of them fails.
 */
describe('assembling a product from four reads', () => {
  beforeEach(() => {
    db.state.productsRead = {
      data: [
      {
        id: 'prod-1',
        account_id: 'acct-1',
        specification_id: 'spec-1',
        name: 'Candle',
        sku: 'C-1',
        net_quantity: 220,
        net_unit: 'g',
        packaging_id: 'pkg-tumbler-250',
        identifiers: {},
        data: {},
        created_at: '2026-07-01'
      }],
      error: null
    };
    db.state.specificationsRead = {
      data: [
      {
        id: 'spec-1',
        account_id: 'acct-1',
        name: 'Candle',
        category_id: 'home-fragrance',
        kind: 'mixture',
        product_type: 'Container candle',
        fragrance_id: 'ing-black-fig',
        base_id: 'ing-crw45',
        dye_id: null,
        load: 8,
        additive: null,
        markets: ['GB'],
        regimes: ['clp'],
        ufi: null,
        data: {}
      }],
      error: null
    };
    db.state.artefactsRead = { data: [], error: null };
    db.state.eventsRead = { data: [], error: null };
    db.state.fingerprints = {};
    db.state.fingerprintError = null;
    db.state.fingerprintCalls = [];
    db.state.lookupFilters = [];
  });

  it('refuses the whole read when the evidence log could not be read', async () => {
    // NOT "here are your products, with nothing recorded against any of them". That sentence
    // is a specific claim about the maker's compliance and it is indistinguishable from the
    // true version — which is the exact shape of failure this repository keeps finding.
    db.state.eventsRead = { data: null, error: { message: 'boom' } };
    const result = await fetchProducts('acct-1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/could not read your products/i);
  });

  it('refuses the whole read when the artefacts could not be read', async () => {
    db.state.artefactsRead = { data: null, error: { message: 'boom' } };
    const result = await fetchProducts('acct-1');
    expect(result.ok).toBe(false);
  });

  it('asks for no fingerprint at all when nothing has been produced', async () => {
    // A brand new account makes zero of these calls. The fingerprint is only meaningful
    // against something that was produced, and a round trip per product on a screen that
    // needs none is a cost with no answer at the end of it.
    const result = await fetchProducts('acct-1');
    expect(result.ok).toBe(true);
    expect(db.state.fingerprintCalls).toEqual([]);
    if (result.ok) {
      expect(result.products[0].artefacts.every((a) => a.currency === 'not-produced')).toBe(true);
    }
  });

  it('compares a produced artefact against the live fingerprint', async () => {
    db.state.artefactsRead = { data: [artefactRow({ specification_hash: 'hash-a' })], error: null };
    db.state.fingerprints = { 'prod-1': 'hash-a' };

    const result = await fetchProducts('acct-1');
    expect(db.state.fingerprintCalls).toEqual(['prod-1']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const label = result.products[0].artefacts.find((a) => a.type === 'unit-label');
      expect(label?.currency).toBe('current');
      expect(label?.version).toBe('v1');
    }
  });

  it('renders a fingerprint it could not get as unknown, and still returns the products', async () => {
    db.state.artefactsRead = { data: [artefactRow()], error: null };
    db.state.fingerprintError = { message: 'rpc down' };

    const result = await fetchProducts('acct-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const label = result.products[0].artefacts.find((a) => a.type === 'unit-label');
      expect(label?.currency).toBe('unknown');
    }
  });

  it('narrows the log to the compliance kinds rather than reading the whole history', async () => {
    await fetchProducts('acct-1');
    const kinds = db.state.lookupFilters.find(([column]) => column === 'in:kind');
    if (!kinds) throw new Error('the log was read without narrowing it to a set of kinds');
    expect(kinds[1]).toContain('compliance.evidence_recorded');
    expect(kinds[1]).toContain('compliance.sds_section_reviewed');
    // A production run is the Records screen's to render. This function assembles a product.
    expect(kinds[1]).not.toContain('batch.produced');
  });

  it('carries recorded evidence onto the product', async () => {
    db.state.eventsRead = { data: [eventRow()], error: null };
    const result = await fetchProducts('acct-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.products[0].evidence.obligations['cpr-pif'].reference).toBe('PIF-1');
    }
  });
});
