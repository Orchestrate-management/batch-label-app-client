import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A stand-in for the materials tables, chained the way supabase-js chains.
 *
 * WHAT IT IS FOR. Three properties of lib/materials.ts that a type check cannot see and that
 * are expensive to get wrong:
 *
 *   AN EMPTY REGISTER AND A FAILED READ ARE DIFFERENT ANSWERS. A brand new account holds no
 *   materials and the shipped catalogue is empty, so `{ok: true, materials: []}` is the first
 *   thing every real customer's screen is built from. A read that failed must never arrive in
 *   that shape, because "you have no materials" to somebody holding forty of them reads as
 *   data loss.
 *
 *   A PARTIAL READ IS A FAILED READ. The hazard rows come back from a different query than the
 *   materials do. If that query fails and the materials query does not, every ingredient
 *   arrives carrying an empty hazard list — which renders as a register of materials that have
 *   been classified and found harmless. That is the most dangerous possible output of this
 *   file, and it is one `if` away at all times.
 *
 *   A WRITE THAT REACHED NO ROW DID NOT SAVE. An UPDATE or DELETE excluded by an RLS `using`
 *   clause matches nothing and reports success; supabase-js hands back `{error: null}`. Every
 *   write here asks for the row back, and the mock has to be able to return an empty array
 *   because that is the shape the bug arrives in.
 */
const db = vi.hoisted(() => {
  const state = {
    reads: {} as Record<string, {data: unknown;error: unknown;}>,
    /** What each insert actually sent, by table. Some of these columns print on a label. */
    inserts: [] as Array<[string, Record<string, unknown>]>,
    insertResult: { data: null as unknown, error: null as unknown },
    updateResult: { data: [{ id: 'mat-1' }] as unknown, error: null as unknown },
    updatePayloads: [] as Array<[string, Record<string, unknown>]>,
    deleteResult: { data: [{ id: 'haz-1' }] as unknown, error: null as unknown },
    deleted: [] as Array<[string, unknown]>,
    /** Which Postgres schema each call went through. `batchlabel`, never `public`. */
    schemas: [] as string[],
    filters: [] as Array<[string, string, unknown]>
  };

  const read = (table: string) => state.reads[table] ?? { data: [], error: null };

  const supabase = {
    schema(name: string) {
      state.schemas.push(name);
      return supabase;
    },
    from(table: string) {
      return {
        select() {
          const q: Record<string, unknown> = {};
          const chain = () => q;
          Object.assign(q, {
            select: chain,
            is: chain,
            limit: chain,
            order: chain,
            in: chain,
            eq: (column: string, value: unknown) => {
              state.filters.push([table, column, value]);
              return q;
            },
            single: async () => read(table),
            maybeSingle: async () => read(table),
            then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
            Promise.resolve(read(table)).then(resolve, reject)
          });
          return q;
        },
        insert(payload: Record<string, unknown>) {
          state.inserts.push([table, payload]);
          const result = () => state.insertResult;
          const q: Record<string, unknown> = {};
          Object.assign(q, {
            select: () => q,
            single: async () => result(),
            maybeSingle: async () => result(),
            then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
            Promise.resolve(result()).then(resolve, reject)
          });
          return q;
        },
        update: (payload: Record<string, unknown>) => ({
          eq: (_column: string, _value: unknown) => {
            state.updatePayloads.push([table, payload]);
            return Object.assign(Promise.resolve(state.updateResult), {
              select: () => Promise.resolve(state.updateResult)
            });
          }
        }),
        delete: () => ({
          eq: (_column: string, value: unknown) => {
            state.deleted.push([table, value]);
            return Object.assign(Promise.resolve(state.deleteResult), {
              select: () => Promise.resolve(state.deleteResult)
            });
          }
        })
      };
    }
  };

  return { state, supabase };
});

vi.mock('./supabase', () => ({ supabase: db.supabase, isSupabaseConfigured: true }));

import {
  addHazard,
  archiveMaterial,
  classifyMaterialError,
  createMaterial,
  fetchMaterials,
  overrideReferenceMaterial,
  removeChildRow,
  updateMaterial } from
'./materials';
import { IngredientMaterial, Material, PackagingMaterial } from './model';

beforeEach(() => {
  db.state.reads = {};
  db.state.inserts = [];
  db.state.insertResult = { data: { id: 'mat-new' }, error: null };
  db.state.updateResult = { data: [{ id: 'mat-1' }], error: null };
  db.state.updatePayloads = [];
  db.state.deleteResult = { data: [{ id: 'haz-1' }], error: null };
  db.state.deleted = [];
  db.state.schemas = [];
  db.state.filters = [];
});

/** One account material, resolved, with one hazard and one allergen against it. */
function seedOneOwnMaterial() {
  db.state.reads.resolved_materials = {
    data: [
    {
      account_id: 'acct-1',
      source: 'account',
      material_id: 'mat-1',
      reference_material_id: null,
      reference_version_id: null,
      reference_version: null,
      provenance: null,
      slug: 'my-wax',
      material_class: 'ingredient',
      name: 'Coconut and rapeseed wax',
      supplier: 'Kerax',
      supplier_code: 'CRW-45',
      role: 'Wax',
      categories: ['home-fragrance'],
      overrides_reference: false
    }],

    error: null
  };
  db.state.reads.materials = {
    data: [
    {
      id: 'mat-1',
      account_id: 'acct-1',
      slug: 'my-wax',
      material_class: 'ingredient',
      name: 'Coconut and rapeseed wax',
      supplier: 'Kerax',
      supplier_code: 'CRW-45',
      role: 'Wax',
      categories: ['home-fragrance'],
      cas: null,
      format: null,
      capacity_ml: null,
      label_area_width_mm: null,
      label_area_height_mm: null,
      food_contact: null,
      child_resistant: null,
      overrides_reference_id: null,
      notes: null,
      archived_at: null,
      created_at: null,
      updated_at: null
    }],

    error: null
  };
  db.state.reads.material_hazards = {
    data: [
    {
      id: 'haz-1',
      material_id: 'mat-1',
      code: 'H317',
      statement: 'May cause an allergic skin reaction.',
      hazard_class: 'Skin Sens. 1',
      gcl: 1,
      scl: 0.4,
      pictogram: 'GHS07',
      signal: 'Warning',
      derivation: null
    }],

    error: null
  };
  db.state.reads.material_allergens = {
    data: [{ id: 'all-1', material_id: 'mat-1', name: 'linalool', pct: 3.1 }],
    error: null
  };
}

describe('reading the register', () => {
  it('goes through the batchlabel schema, never public', () => {
    // The domain moved out of `public` so a sibling brand can have its own `products`. A
    // client that quietly went back would read an empty decoy table and report a register
    // with nothing in it — a silent, plausible, wrong answer.
    return fetchMaterials('acct-1').then(() => {
      expect(db.state.schemas.length).toBeGreaterThan(0);
      expect(new Set(db.state.schemas)).toEqual(new Set(['batchlabel']));
    });
  });

  it('filters every read by the account, not just the view', async () => {
    await fetchMaterials('acct-1');
    const tables = new Set(
      db.state.filters.filter(([, column]) => column === 'account_id').map(([table]) => table)
    );
    // RLS is the boundary; this is the narrowing, and the two are not substitutes. A child
    // table read without it would return another account's hazard rows to be joined onto
    // this account's materials by material_id.
    expect(tables).toContain('resolved_materials');
    expect(tables).toContain('materials');
    expect(tables).toContain('material_hazards');
    expect(tables).toContain('material_allergens');
    expect(tables).toContain('material_ifra_limits');
    expect(tables).toContain('material_documents');
  });

  it('refuses to read at all without an account id', async () => {
    const result = await fetchMaterials(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/which account/i);
    // And it did not widen the query to whatever RLS allows.
    expect(db.state.filters).toEqual([]);
  });

  it('returns an empty register as an ANSWER, not as a failure', async () => {
    const result = await fetchMaterials('acct-1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.materials).toEqual([]);
  });

  it('assembles a material with its hazards and allergens', async () => {
    seedOneOwnMaterial();
    const result = await fetchMaterials('acct-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const material = result.materials[0] as IngredientMaterial;
    expect(material.name).toBe('Coconut and rapeseed wax');
    expect(material.source).toBe('account');
    expect(material.editable).toBe(true);
    expect(material.hazards[0].code).toBe('H317');
    expect(material.hazards[0].scl).toBe(0.4);
    expect(material.allergens[0]).toMatchObject({ name: 'linalool', pct: 3.1 });
    // The child row id travels, or the remove control beside it has nothing to delete.
    expect(material.hazards[0].rowId).toBe('haz-1');
  });

  it('reports no document when the account holds none, rather than inventing one', async () => {
    seedOneOwnMaterial();
    const result = await fetchMaterials('acct-1');
    if (!result.ok) throw new Error('expected a read');
    expect(result.materials[0].document).toBeUndefined();
    expect(result.materials[0].documentFileHeld).toBe(false);
  });

  it('says a file is not held even when a document row exists', async () => {
    // `storage_path` null means no file is held. A recorded reference is the maker telling us
    // what their document is; it is not us holding it, and sections 3 and 16 of a safety data
    // sheet turn on the difference.
    seedOneOwnMaterial();
    db.state.reads.material_documents = {
      data: [
      {
        id: 'doc-1',
        material_id: 'mat-1',
        document_kind: 'Safety data sheet',
        reference: 'kerax-crw45-sds',
        version: '5.0',
        document_date: '2025-04-30',
        expires_at: null,
        received_at: null,
        storage_path: null,
        file_name: null,
        notes: null
      }],

      error: null
    };
    const result = await fetchMaterials('acct-1');
    if (!result.ok) throw new Error('expected a read');
    expect(result.materials[0].document?.version).toBe('5.0');
    expect(result.materials[0].documentFileHeld).toBe(false);
  });
});

describe('a read that only half worked', () => {
  it('fails the whole read when the hazard rows could not be fetched', async () => {
    // THE ONE THAT MATTERS MOST. Materials without their hazards render as materials that
    // have been classified and found harmless. Returning `{ok: true}` here would put that on
    // screen, and then into a derivation, and then onto a label.
    seedOneOwnMaterial();
    db.state.reads.material_hazards = { data: null, error: { code: '08006' } };
    const result = await fetchMaterials('acct-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/could not read/i);
      // It blames us and it does not say the register is empty.
      expect(result.message).toMatch(/this is us/i);
      expect(result.message).not.toMatch(/no materials|none/i);
    }
  });

  it('fails the whole read when the allergen rows could not be fetched', async () => {
    seedOneOwnMaterial();
    db.state.reads.material_allergens = { data: null, error: { code: '08006' } };
    expect((await fetchMaterials('acct-1')).ok).toBe(false);
  });

  it('fails the whole read when the view itself could not be fetched', async () => {
    db.state.reads.resolved_materials = { data: null, error: { code: '42501' } };
    expect((await fetchMaterials('acct-1')).ok).toBe(false);
  });

  it('drops a material the view named and the table did not return', async () => {
    // A race: archived between the two reads. The view row alone carries no hazards, so
    // rendering it would produce a material that looks classified and is not.
    seedOneOwnMaterial();
    db.state.reads.materials = { data: [], error: null };
    const result = await fetchMaterials('acct-1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.materials).toEqual([]);
  });
});

describe('a reference material', () => {
  function seedReference(payload: Record<string, unknown>, provenance = 'supplier-document') {
    db.state.reads.resolved_materials = {
      data: [
      {
        account_id: 'acct-1',
        source: 'reference',
        material_id: null,
        reference_material_id: 'ref-1',
        reference_version_id: 'ver-1',
        reference_version: 2,
        provenance,
        slug: 'ing-crw45',
        material_class: 'ingredient',
        name: 'Coconut and rapeseed wax CRW-45',
        supplier: 'Kerax',
        supplier_code: 'CRW-45',
        role: 'Wax',
        categories: ['home-fragrance'],
        overrides_reference: false
      }],

      error: null
    };
    db.state.reads.reference_material_versions = {
      data: [
      {
        id: 'ver-1',
        reference_material_id: 'ref-1',
        version: 2,
        provenance,
        document_kind: 'Safety data sheet',
        document_reference: 'kerax-crw45-sds',
        document_version: '5.0',
        document_date: '2025-04-30',
        document_expires: null,
        payload,
        notes: null
      }],

      error: null
    };
  }

  it('is keyed on its slug, so a composition written before this change still resolves', async () => {
    seedReference({ hazards: [] });
    const result = await fetchMaterials('acct-1');
    if (!result.ok) throw new Error('expected a read');
    expect(result.materials[0].id).toBe('ing-crw45');
    expect(result.materials[0].referenceMaterialId).toBe('ref-1');
  });

  it('is never editable and never claims a file is held for the account', async () => {
    seedReference({ hazards: [] });
    const result = await fetchMaterials('acct-1');
    if (!result.ok) throw new Error('expected a read');
    expect(result.materials[0].editable).toBe(false);
    expect(result.materials[0].documentFileHeld).toBe(false);
  });

  it('carries its provenance, so a screen can label an example as one', async () => {
    seedReference({ hazards: [] }, 'illustrative-example');
    const result = await fetchMaterials('acct-1');
    if (!result.ok) throw new Error('expected a read');
    expect(result.materials[0].provenance).toBe('illustrative-example');
  });

  it('reads its classification out of the immutable version payload', async () => {
    seedReference({
      hazards: [
      {
        code: 'H317',
        statement: 'May cause an allergic skin reaction.',
        hazardClass: 'Skin Sens. 1',
        gcl: 1
      }],

      allergens: [{ name: 'linalool', pct: 3.1 }]
    });
    const result = await fetchMaterials('acct-1');
    if (!result.ok) throw new Error('expected a read');
    const material = result.materials[0] as IngredientMaterial;
    expect(material.hazards[0].code).toBe('H317');
    expect(material.allergens[0].pct).toBe(3.1);
    // No row id: nothing can remove a published reference figure, so no control is offered.
    expect(material.hazards[0].rowId).toBeUndefined();
  });

  /**
   * THE REFERENCE PATH IS THE LEAST EXERCISED CODE IN THIS FILE AND THE HARDEST TO NOTICE
   * BREAKING, because the catalogue ships EMPTY on purpose — no customer runs any of it today.
   * The day Batchlabel publishes its first reference material, every one of these branches
   * executes for the first time, in production, on somebody's classification.
   *
   * Each of the four below is a place where a missing or malformed payload key could turn into
   * a confident claim rather than an absence.
   */
  it('does not invent an IFRA limit, an allergen or a hazard from a payload without them', async () => {
    seedReference({});
    const result = await fetchMaterials('acct-1');
    if (!result.ok) throw new Error('expected a read');
    const material = result.materials[0] as IngredientMaterial;
    // Empty, and empty from a payload key that was absent rather than from one that said none.
    // Both are rendered by derive() as "not worked out" rather than as "none required".
    expect(material.hazards).toEqual([]);
    expect(material.allergens).toEqual([]);
    expect(material.ifra).toEqual([]);
  });

  it('drops an allergen with no percentage and an IFRA limit with no maximum', async () => {
    // A named allergen at 0% and an IFRA category with no figure are both incomplete records,
    // and both would render as decided: "linalool, 0.0%" reads as measured and found absent,
    // and an IFRA maximum of 0 reads as a ban. Neither is what an empty field means.
    seedReference({
      allergens: [{ name: 'linalool', pct: 3.1 }, { name: 'limonene' }, { name: '', pct: 2 }],
      ifra: [{ category: '12', max: 4.5 }, { category: '4' }, { max: 9 }]
    });
    const result = await fetchMaterials('acct-1');
    if (!result.ok) throw new Error('expected a read');
    const material = result.materials[0] as IngredientMaterial;
    expect(material.allergens.map((a) => a.name)).toEqual(['linalool']);
    expect(material.ifra.map((limit) => limit.category)).toEqual(['12']);
  });

  it('reads an IFRA maximum written as max_pct as well as max', async () => {
    // The two spellings exist because the payload is written by hand today. A limit silently
    // dropped for being spelled the other way is a restriction that stops being checked.
    seedReference({ ifra: [{ category: '12', description: 'Candles', max_pct: 6 }] });
    const result = await fetchMaterials('acct-1');
    if (!result.ok) throw new Error('expected a read');
    expect((result.materials[0] as IngredientMaterial).ifra[0].max).toBe(6);
  });

  it('shows no document citation at all when the version carries no document kind', async () => {
    seedReference({ hazards: [] });
    db.state.reads.reference_material_versions = {
      data: [{ id: 'ver-1', reference_material_id: 'ref-1', version: 2, payload: {} }],
      error: null
    };
    const result = await fetchMaterials('acct-1');
    if (!result.ok) throw new Error('expected a read');
    // Undefined, not an object of empty strings. `documentHint` on the specification screen
    // renders whatever is here, and the defect it was written for was "Reference library · ,
    // read from document v" — a citation with the citation cut out of it.
    expect(result.materials[0].document).toBeUndefined();
  });

  it('assembles a reference PACK, with its geometry off the same payload', async () => {
    // The other half of the reference branch, and it decides two numbers that are checked
    // against a label: the capacity that picks a row of CLP Annex I Table 1.3, and the
    // printable area the artefact is measured against.
    db.state.reads.resolved_materials = {
      data: [
      {
        account_id: 'acct-1',
        source: 'reference',
        material_id: null,
        reference_material_id: 'ref-2',
        reference_version_id: 'ver-2',
        reference_version: 1,
        provenance: 'supplier-document',
        slug: 'pkg-tumbler-250',
        material_class: 'packaging',
        name: '250 ml amber tumbler',
        supplier: 'A glassworks',
        categories: ['home-fragrance'],
        overrides_reference: false
      }],

      error: null
    };
    db.state.reads.reference_material_versions = {
      data: [
      {
        id: 'ver-2',
        reference_material_id: 'ref-2',
        version: 1,
        payload: { capacityMl: 250, labelAreaMm: { width: 60, height: 40 } }
      }],

      error: null
    };
    const result = await fetchMaterials('acct-1');
    if (!result.ok) throw new Error('expected a read');
    const pack = result.materials[0];
    expect(pack.class).toBe('packaging');
    expect(pack.source).toBe('reference');
    expect((pack as {capacityMl?: number;}).capacityMl).toBe(250);
    expect((pack as {labelAreaMm?: {width: number;};}).labelAreaMm?.width).toBe(60);
  });

  it('leaves a pack with no recorded geometry undefined rather than at zero', async () => {
    // "Capacity 0 ml" and "Printable area 0 × 0 mm" are what an absent measurement used to
    // render as, next to a label the designer then checked against them.
    db.state.reads.resolved_materials = {
      data: [
      {
        account_id: 'acct-1',
        source: 'reference',
        material_id: null,
        reference_material_id: 'ref-3',
        reference_version_id: 'ver-3',
        reference_version: 1,
        provenance: 'supplier-document',
        slug: 'pkg-unknown',
        material_class: 'packaging',
        name: 'A pack nobody measured',
        categories: ['home-fragrance'],
        overrides_reference: false
      }],

      error: null
    };
    db.state.reads.reference_material_versions = {
      data: [{ id: 'ver-3', reference_material_id: 'ref-3', version: 1, payload: {} }],
      error: null
    };
    const result = await fetchMaterials('acct-1');
    if (!result.ok) throw new Error('expected a read');
    expect((result.materials[0] as {capacityMl?: number;}).capacityMl).toBeUndefined();
    expect((result.materials[0] as {labelAreaMm?: unknown;}).labelAreaMm).toBeUndefined();
  });
});

describe('packaging geometry', () => {
  function seedPack(row: Record<string, unknown>) {
    db.state.reads.resolved_materials = {
      data: [
      {
        account_id: 'acct-1',
        source: 'account',
        material_id: 'pack-1',
        reference_material_id: null,
        reference_version_id: null,
        reference_version: null,
        provenance: null,
        slug: null,
        material_class: 'packaging',
        name: 'Amber tumbler',
        supplier: null,
        supplier_code: null,
        role: null,
        categories: ['home-fragrance'],
        overrides_reference: false
      }],

      error: null
    };
    db.state.reads.materials = {
      data: [
      {
        id: 'pack-1',
        account_id: 'acct-1',
        slug: null,
        material_class: 'packaging',
        name: 'Amber tumbler',
        supplier: null,
        supplier_code: null,
        role: null,
        categories: ['home-fragrance'],
        cas: null,
        format: null,
        capacity_ml: null,
        label_area_width_mm: null,
        label_area_height_mm: null,
        food_contact: null,
        child_resistant: null,
        overrides_reference_id: null,
        notes: null,
        archived_at: null,
        created_at: null,
        updated_at: null,
        ...row
      }],

      error: null
    };
  }

  it('leaves an unrecorded capacity absent rather than defaulting it', async () => {
    // Capacity decides which row of CLP Annex I Table 1.3 the label is sized against. A
    // default of 100 ml is a label sized against a number nobody entered.
    seedPack({});
    const result = await fetchMaterials('acct-1');
    if (!result.ok) throw new Error('expected a read');
    expect((result.materials[0] as PackagingMaterial).capacityMl).toBeUndefined();
  });

  it('takes a label area only when both dimensions are recorded', async () => {
    seedPack({ label_area_width_mm: 72 });
    const half = await fetchMaterials('acct-1');
    if (!half.ok) throw new Error('expected a read');
    expect((half.materials[0] as PackagingMaterial).labelAreaMm).toBeUndefined();

    seedPack({ label_area_width_mm: 72, label_area_height_mm: 60 });
    const both = await fetchMaterials('acct-1');
    if (!both.ok) throw new Error('expected a read');
    expect((both.materials[0] as PackagingMaterial).labelAreaMm).toEqual({ width: 72, height: 60 });
  });

  it('reads numerics that arrive as strings', async () => {
    // PostgREST serialises `numeric` as a JSON number, but a proxy that stringifies must not
    // turn a 250 ml jar into no capacity at all.
    seedPack({ capacity_ml: '250.00' });
    const result = await fetchMaterials('acct-1');
    if (!result.ok) throw new Error('expected a read');
    expect((result.materials[0] as PackagingMaterial).capacityMl).toBe(250);
  });
});

describe('creating a material', () => {
  it('sends the account id the entitlement resolved', async () => {
    await createMaterial(
      { materialClass: 'ingredient', name: 'My wax', categories: ['home-fragrance'] },
      'acct-1'
    );
    expect(db.state.inserts[0][1].account_id).toBe('acct-1');
  });

  it('omits the account id when the entitlement resolved none, letting the default decide', async () => {
    await createMaterial(
      { materialClass: 'ingredient', name: 'My wax', categories: ['home-fragrance'] },
      null
    );
    expect(db.state.inserts[0][1]).not.toHaveProperty('account_id');
  });

  it('nulls packaging geometry on an ingredient rather than letting the CHECK refuse it', async () => {
    await createMaterial(
      {
        materialClass: 'ingredient',
        name: 'My wax',
        categories: ['home-fragrance'],
        capacityMl: 250
      },
      'acct-1'
    );
    expect(db.state.inserts[0][1].capacity_ml).toBeNull();
  });

  it('sends a blank optional field as null, never as an empty string', async () => {
    // An empty string in a text column prints as a blank line under a heading on a label.
    await createMaterial(
      {
        materialClass: 'ingredient',
        name: 'My wax',
        supplier: '   ',
        supplierCode: '',
        categories: ['home-fragrance']
      },
      'acct-1'
    );
    expect(db.state.inserts[0][1].supplier).toBeNull();
    expect(db.state.inserts[0][1].supplier_code).toBeNull();
  });

  it('reports a duplicate short code as a duplicate, with no retry offered', async () => {
    db.state.insertResult = { data: null, error: { code: '23505' } };
    const result = await createMaterial(
      { materialClass: 'ingredient', name: 'My wax', slug: 'wax', categories: [] },
      'acct-1'
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('duplicate');
      expect(result.message).toMatch(/different code/i);
      expect(result.message).not.toMatch(/try again/i);
    }
  });

  it('reports a refusal without dressing it up as a diagnosis', async () => {
    db.state.insertResult = { data: null, error: { code: '42501' } };
    const result = await createMaterial(
      { materialClass: 'ingredient', name: 'My wax', categories: [] },
      'acct-1'
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('refused');
      expect(result.message).toMatch(/nothing has been saved/i);
    }
  });

  it('says signup is unfinished only when the database says so', async () => {
    db.state.insertResult = { data: null, error: { code: 'P0001', hint: 'account_missing' } };
    const result = await createMaterial(
      { materialClass: 'ingredient', name: 'My wax', categories: [] },
      null
    );
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('no_account');
  });
});

describe('holding your own version of one of ours', () => {
  const reference: Material = {
    id: 'ing-crw45',
    source: 'reference',
    referenceMaterialId: 'ref-1',
    class: 'ingredient',
    role: 'Wax',
    name: 'Coconut and rapeseed wax CRW-45',
    supplier: 'Kerax',
    supplierCode: 'CRW-45',
    categories: ['home-fragrance'],
    editable: false,
    hazards: [
    { code: 'H317', statement: 'May cause an allergic skin reaction.', hazardClass: 'Skin Sens. 1', gcl: 1 }],

    allergens: [{ name: 'linalool', pct: 3.1 }],
    ifra: []
  };

  it('links the new row to the reference material it stands in place of', async () => {
    await overrideReferenceMaterial(reference, 'acct-1');
    expect(db.state.inserts[0][1].overrides_reference_id).toBe('ref-1');
  });

  it('copies identity and NOT the classification', async () => {
    // The whole point of holding your own is that your supplier's document is the authority.
    // A row that says "yours" and carries our figures is the failure the override rule exists
    // to prevent, and it would be invisible: the screen would say Yours.
    await overrideReferenceMaterial(reference, 'acct-1');
    const [table, payload] = db.state.inserts[0];
    expect(table).toBe('materials');
    expect(payload.name).toBe('Coconut and rapeseed wax CRW-45');
    expect(payload.supplier).toBe('Kerax');
    // Nothing was written to any child table.
    expect(db.state.inserts.map(([entry]) => entry)).toEqual(['materials']);
  });

  it('reports a second override as a duplicate rather than creating a rival row', async () => {
    db.state.insertResult = { data: null, error: { code: '23505' } };
    const result = await overrideReferenceMaterial(reference, 'acct-1');
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('duplicate');
    expect(result.message).toMatch(/already hold your own version/i);
  });

  it('refuses to stand in place of a material that is already the account\'s own', async () => {
    const own: Material = { ...reference, source: 'account', referenceMaterialId: undefined };
    const result = await overrideReferenceMaterial(own, 'acct-1');
    if (result.ok) throw new Error('expected a refusal');
    expect(db.state.inserts).toEqual([]);
    expect(result.message).toMatch(/already yours/i);
  });
});

describe('a write that reached no row', () => {
  it('reports an update that matched nothing as a refusal, not a save', async () => {
    // An UPDATE excluded by an RLS `using` clause changes nothing WITHOUT raising. Reporting
    // it as success is how a maker is congratulated on a save that never happened.
    db.state.updateResult = { data: [], error: null };
    const result = await updateMaterial('mat-1', {
      materialClass: 'ingredient',
      name: 'My wax',
      categories: []
    });
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('reached_nothing');
    expect(result.message).toMatch(/nothing was saved/i);
    expect(result.message).not.toMatch(/try again in a moment/i);
  });

  it('reports an archive that matched nothing the same way', async () => {
    db.state.updateResult = { data: [], error: null };
    const result = await archiveMaterial('mat-1');
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('reached_nothing');
  });

  it('reports a child-row delete that matched nothing the same way', async () => {
    db.state.deleteResult = { data: [], error: null };
    const result = await removeChildRow('material_hazards', 'haz-1');
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('reached_nothing');
  });

  it('archives rather than deletes, so a product built on the material keeps working', async () => {
    await archiveMaterial('mat-1');
    expect(db.state.deleted).toEqual([]);
    expect(db.state.updatePayloads[0][0]).toBe('materials');
    expect(db.state.updatePayloads[0][1]).toHaveProperty('archived_at');
  });

  it('never lets an edit move which reference material a row stands in place of', async () => {
    // Set once, when the maker chooses to replace ours. Moving it afterwards would silently
    // change which of our materials disappears from their picker.
    await updateMaterial('mat-1', {
      materialClass: 'ingredient',
      name: 'My wax',
      categories: [],
      overridesReferenceId: 'ref-2'
    });
    expect(db.state.updatePayloads[0][1]).not.toHaveProperty('overrides_reference_id');
  });
});

describe('adding a hazard', () => {
  it('sends a missing concentration limit as null rather than as zero', async () => {
    // "a null must be rendered as unknown and never as zero" — the column comment on
    // material_hazards.gcl. Zero transfers the hazard at every load.
    await addHazard(
      'mat-1',
      { code: 'H317', statement: 'May cause an allergic skin reaction.', hazardClass: 'Skin Sens. 1' },
      'acct-1'
    );
    expect(db.state.inserts[0][1].gcl).toBeNull();
    expect(db.state.inserts[0][1].scl).toBeNull();
  });

  it('names the duplicate hazard code rather than offering a retry', async () => {
    db.state.insertResult = { data: null, error: { code: '23505' } };
    const result = await addHazard(
      'mat-1',
      { code: 'H317', statement: 'x', hazardClass: 'Skin Sens. 1' },
      'acct-1'
    );
    if (result.ok) throw new Error('expected a refusal');
    expect(result.message).toMatch(/already on this material/i);
  });
});

describe('classifying a write failure', () => {
  it('reads the hint before the code, because all three hints share one code', () => {
    expect(classifyMaterialError({ code: 'P0001', hint: 'account_ambiguous' }).reason).toBe(
      'account_ambiguous'
    );
  });

  it('offers no retry on an ambiguous account, because a retry finds the same two', () => {
    const { message } = classifyMaterialError({ code: 'P0001', hint: 'account_ambiguous' });
    expect(message).toMatch(/trying again will not change that/i);
  });

  it('explains a constraint violation in terms of what the maker typed', () => {
    const { reason, message } = classifyMaterialError({ code: '23514' });
    expect(reason).toBe('constraint');
    expect(message).toMatch(/nothing has been saved/i);
  });

  it('falls back to a generic failure without claiming to know why', () => {
    const { reason, message } = classifyMaterialError({ code: '08006' });
    expect(reason).toBe('failed');
    expect(message).toMatch(/nothing has changed/i);
  });
});

/**
 * THE READS AND WRITES THAT COME BACK WITH NOTHING, WHICH IS THE SHAPE EVERY DANGEROUS BUG IN
 * THIS FILE ARRIVES IN.
 *
 * PostgREST answers a statement excluded by an RLS `using` clause with success and no rows, and
 * supabase-js reports that as `{error: null}`. So every "did it work" question here has three
 * answers rather than two, and the third — accepted, reached nothing — is the one that renders
 * as a save that did not happen or as a register that is empty rather than unreadable.
 */
describe('an answer with nothing in it', () => {
  it('fails the WHOLE read when the reference versions could not be fetched', async () => {
    // A resolved row says "reference, version ver-1" and the version read fails. Falling back
    // to the row alone would produce a material with no hazards, no allergens and no IFRA
    // limit — which renders as one that has been classified and found harmless.
    db.state.reads.resolved_materials = {
      data: [
      {
        account_id: 'acct-1',
        source: 'reference',
        material_id: null,
        reference_material_id: 'ref-1',
        reference_version_id: 'ver-1',
        reference_version: 1,
        provenance: 'supplier-document',
        slug: 'ing-x',
        material_class: 'ingredient',
        name: 'Something published',
        categories: ['home-fragrance'],
        overrides_reference: false
      }],

      error: null
    };
    db.state.reads.reference_material_versions = { data: null, error: { code: '08006' } };

    const result = await fetchMaterials('acct-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/could not read your materials/i);
  });

  it('drops an account row the view listed and the table did not return', async () => {
    // Archived between the two reads. The view row on its own carries no hazards, so keeping
    // it would put an unclassified copy of a real material into the register — the same false
    // "no hazards required" by another route. Dropping it is right; the register is simply a
    // row shorter until the next read.
    db.state.reads.resolved_materials = {
      data: [
      {
        account_id: 'acct-1',
        source: 'account',
        material_id: 'mat-gone',
        reference_material_id: null,
        reference_version_id: null,
        material_class: 'ingredient',
        name: 'Archived a moment ago',
        categories: ['home-fragrance'],
        overrides_reference: false
      }],

      error: null
    };
    db.state.reads.materials = { data: [], error: null };

    const result = await fetchMaterials('acct-1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.materials).toEqual([]);
  });

  it('reports an edit that reached no row as not saved, rather than as saved', async () => {
    db.state.updateResult = { data: [], error: null };
    const result = await updateMaterial('mat-1', {
      materialClass: 'ingredient',
      name: 'Renamed',
      categories: ['home-fragrance']
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('reached_nothing');
      expect(result.message).toMatch(/nothing/i);
    }
  });

  it('reports an archive that reached no row the same way', async () => {
    db.state.updateResult = { data: [], error: null };
    const result = await archiveMaterial('mat-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('reached_nothing');
  });

  it('never sends an edit that would move which reference row a material replaces', async () => {
    // Set once, when the maker chooses to replace one of ours. Moving it afterwards silently
    // changes which reference material disappears from everybody else's picker.
    db.state.updateResult = { data: [{ id: 'mat-1' }], error: null };
    await updateMaterial('mat-1', {
      materialClass: 'ingredient',
      name: 'Renamed',
      categories: ['home-fragrance'],
      overridesReferenceId: 'ref-99'
    });
    const [[, payload]] = db.state.updatePayloads.filter(([table]) => table === 'materials');
    expect(payload).not.toHaveProperty('overrides_reference_id');
    expect(payload.name).toBe('Renamed');
  });

  it('refuses geometry on an ingredient rather than letting the database refuse it', async () => {
    // `materials_packaging_check` would reject it with a 23514, and a constraint violation is
    // an error message about a form the maker cannot see. Nulled here so the error path stays
    // free for real mistakes.
    db.state.insertResult = { data: { id: 'mat-2' }, error: null };
    await createMaterial(
      {
        materialClass: 'ingredient',
        name: 'A wax',
        categories: ['home-fragrance'],
        capacityMl: 250,
        labelAreaWidthMm: 60
      },
      'acct-1'
    );
    const [[, payload]] = db.state.inserts.filter(([table]) => table === 'materials');
    expect(payload.capacity_ml).toBeNull();
    expect(payload.label_area_width_mm).toBeNull();
  });
});

/**
 * ROWS THAT ARE NOT WHOLE, and the rule that covers all four of them: a partial record is
 * dropped rather than rendered with the missing half blank.
 *
 * Every one of these columns is NOT NULL in the schema, so a row missing one did not come from
 * this app. What makes dropping right rather than merely tidy is what the alternative LOOKS
 * like on a label: an H-code with no statement beside it, an allergen with no percentage, an
 * IFRA category with no maximum. Each reads as a figure that failed to render, and a maker
 * chasing a rendering fault is not chasing the data problem they actually have.
 */
describe('a child row missing a column the schema says it cannot be missing', () => {
  const seedMaterial = () => {
    db.state.reads.resolved_materials = {
      data: [
      {
        account_id: 'acct-1',
        source: 'account',
        material_id: 'mat-1',
        material_class: 'ingredient',
        name: 'Black Fig and Cassis',
        role: 'Fragrance oil',
        categories: ['home-fragrance'],
        overrides_reference: false
      }],

      error: null
    };
    db.state.reads.materials = {
      data: [
      {
        id: 'mat-1',
        account_id: 'acct-1',
        material_class: 'ingredient',
        name: 'Black Fig and Cassis',
        role: 'Fragrance oil',
        categories: ['home-fragrance']
      }],

      error: null
    };
  };

  it('drops a hazard with no statement, and keeps the whole one beside it', async () => {
    seedMaterial();
    db.state.reads.material_hazards = {
      data: [
      { id: 'h-1', material_id: 'mat-1', code: 'H317', statement: null, hazard_class: 'Skin Sens. 1' },
      { id: 'h-2', material_id: 'mat-1', code: 'H319', statement: 'Causes serious eye irritation.', hazard_class: 'Eye Irrit. 2' }],

      error: null
    };
    const result = await fetchMaterials('acct-1');
    if (!result.ok) throw new Error('expected a read');
    const material = result.materials[0] as IngredientMaterial;
    expect(material.hazards.map((h) => h.code)).toEqual(['H319']);
  });

  it('drops an allergen with no percentage and an IFRA row with no maximum', async () => {
    seedMaterial();
    db.state.reads.material_allergens = {
      data: [
      { id: 'a-1', material_id: 'mat-1', name: 'linalool', pct: null },
      { id: 'a-2', material_id: 'mat-1', name: 'limonene', pct: 2.4 }],

      error: null
    };
    db.state.reads.material_ifra_limits = {
      data: [
      { id: 'i-1', material_id: 'mat-1', category: '12', max_pct: null },
      { id: 'i-2', material_id: 'mat-1', category: '4', max_pct: 8 }],

      error: null
    };
    const result = await fetchMaterials('acct-1');
    if (!result.ok) throw new Error('expected a read');
    const material = result.materials[0] as IngredientMaterial;
    expect(material.allergens.map((a) => a.name)).toEqual(['limonene']);
    expect(material.ifra.map((limit) => limit.category)).toEqual(['4']);
  });

  it('records a document with no kind as a file held, and cites nothing', async () => {
    // The one case where the row still says something true: we know a file exists and we do
    // not know what it is. A citation is either real or it is not shown.
    seedMaterial();
    db.state.reads.material_documents = {
      data: [
      {
        id: 'd-1',
        material_id: 'mat-1',
        document_kind: null,
        storage_path: 'acct-1/mat-1/thing.pdf',
        recorded_at: '2026-07-01T00:00:00.000Z'
      }],

      error: null
    };
    const result = await fetchMaterials('acct-1');
    if (!result.ok) throw new Error('expected a read');
    expect(result.materials[0].document).toBeUndefined();
    expect(result.materials[0].documentFileHeld).toBe(true);
  });

  it('keeps only the categories it can actually draw', async () => {
    // An unknown id is one a later version of this app added or this one removed. Keeping it
    // would put a material in a surface with no screen behind it.
    seedMaterial();
    db.state.reads.resolved_materials.data = [
    {
      ...(db.state.reads.resolved_materials.data as Record<string, unknown>[])[0],
      categories: ['home-fragrance', 'aromatherapy', 'cosmetics']
    }];

    db.state.reads.materials.data = [
    {
      ...(db.state.reads.materials.data as Record<string, unknown>[])[0],
      categories: ['home-fragrance', 'aromatherapy', 'cosmetics']
    }];

    const result = await fetchMaterials('acct-1');
    if (!result.ok) throw new Error('expected a read');
    // Both 'aromatherapy' and 'cosmetics' are ids this build cannot draw — one it never had,
    // one it removed — and neither survives the read.
    expect(result.materials[0].categories).toEqual(['home-fragrance']);
  });

  it('names the thing that is already there for every kind of duplicate', async () => {
    // One code, five sentences. A maker told "that already exists" without being told what
    // has to go looking for it.
    expect(classifyMaterialError({ code: '23505' }, 'hazard').message).toMatch(/hazard code/i);
    expect(classifyMaterialError({ code: '23505' }, 'allergen').message).toMatch(/allergen/i);
    expect(classifyMaterialError({ code: '23505' }, 'ifra').message).toMatch(/IFRA category/i);
    expect(classifyMaterialError({ code: '23505' }, 'override').message).toMatch(/your own version/i);
  });

  it('says which account is missing before it says anything about the code', async () => {
    expect(classifyMaterialError({ code: '23505', hint: 'account_missing' }).reason).toBe(
      'no_account'
    );
  });
});
