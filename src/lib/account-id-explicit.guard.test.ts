import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * EVERY WRITE SENDS AN ACCOUNT ID, AND NOTHING MAY QUIETLY STOP.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS GUARDS AND WHY A COMMENT WAS NOT ENOUGH
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Item 1 of the account_id contract in 20260803120000_account_data_schema.sql is that the app
 * SHOULD send account_id explicitly on every write. Until this change it was a convention held
 * by hand across five files, and eight of the twenty-three write paths quietly did not: they
 * spread `accountId ? { account_id: accountId } : {}` and let `public.current_account_id()`
 * decide when the id was absent.
 *
 * That is correct for exactly as long as every person holds exactly one account.
 * current_account_id() returns NULL for anybody holding two, and its own comment says it will
 * not be taught to disambiguate — so the day the first person is invited into a second
 * workspace, the conditional stops meaning "the database will work it out" and starts meaning
 * "this row is refused". The conditional is what made that silent.
 *
 * A comment cannot hold a convention across five files and a year of edits. This can:
 *
 *   1. NO CONDITIONAL SPREAD. The exact idiom that produced the defect is banned by shape, so
 *      it cannot come back by being pattern-matched from a neighbouring line.
 *   2. EVERY INSERT AND UPSERT NAMES account_id. Checked against the payload literal.
 *   3. EVERY UPDATE AND DELETE ON AN ACCOUNT-SCOPED TABLE FILTERS ON IT. Row level security is
 *      still the boundary; the filter is what stops this app sending a row id without stating
 *      which account it believes it is in, which matters more now that "zero rows changed" is
 *      also how a viewer's write is refused.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY NOT COVERED
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Tables in the `public` schema that are keyed on the PERSON rather than on the account:
 * profiles, consent_events, brand_memberships. And `account_members` / `account_invites`, which
 * are account-scoped but are read and written through lib/team.ts, whose own tests assert the
 * filters. The list below is the domain tables, which is where the contract applies.
 */

const LIB = resolve(__dirname);

/** Every account-scoped table in the `batchlabel` schema that this app writes. */
const ACCOUNT_SCOPED = [
'materials',
'material_hazards',
'material_allergens',
'material_ifra_limits',
'material_documents',
'specifications',
'products',
'artefacts',
'record_events',
'business_identity',
'supplier_addresses',
'workspace_preferences',
'account_data_requests'];


function shippingLibFiles(): string[] {
  return readdirSync(LIB).
  filter((name) => /\.tsx?$/.test(name)).
  filter((name) => !/\.(test|spec|guard)\.tsx?$/.test(name)).
  map((name) => join(LIB, name)).
  filter((path) => statSync(path).isFile());
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}

/**
 * `const account = accountId ? { account_id: accountId } : {}` and any spelling of it.
 *
 * Written loosely on purpose: what is banned is the SHAPE, a conditional that yields an object
 * carrying account_id or an empty one, whatever the variable is called.
 */
const CONDITIONAL_SPREAD = /\?\s*\{\s*account_id\s*:[^}]*\}\s*:\s*\{\s*\}/;

describe('the conditional that made the failure silent', () => {
  it('appears in nothing that ships', () => {
    const offenders = shippingLibFiles().
    filter((path) => CONDITIONAL_SPREAD.test(withoutComments(readFileSync(path, 'utf8')))).
    map((path) => relative(LIB, path));

    expect(
      offenders,
      `${offenders.join(', ')} falls back to the column default when no account is resolved. ` +
      'public.current_account_id() returns NULL for anybody in more than one account and will ' +
      'not be taught to disambiguate, so the fallback is a refused write that this app reports ' +
      'as a generic failure. Refuse before sending instead, as lib/products.ts does.'
    ).toEqual([]);
  });

  it('is a check that can actually fail', () => {
    // A guard that cannot fail reads as protection and provides none.
    expect(CONDITIONAL_SPREAD.test('const account = accountId ? { account_id: accountId } : {};')).
    toBe(true);
    expect(CONDITIONAL_SPREAD.test('const a = id ? { account_id: id } : {};')).toBe(true);
    expect(CONDITIONAL_SPREAD.test('insert({ account_id: accountId, name });')).toBe(false);
  });
});

/**
 * Every `.from('<table>')` in a shipping lib file, with the statement that followed it.
 *
 * A crude parse on purpose. The alternative is a TypeScript AST walk, which would be exact and
 * would also be a second program to maintain; this reads the same text a person reviewing the
 * diff reads, and the failure mode of getting it wrong is a false alarm rather than a silent
 * pass.
 */
function statementsFor(source: string): Array<{table: string;verb: string;body: string;}> {
  const clean = withoutComments(source);
  const out: Array<{table: string;verb: string;body: string;}> = [];
  for (const match of clean.matchAll(/\.\s*from\(\s*'([a-z_]+)'\s*\)/g)) {
    const table = match[1];
    const rest = clean.slice(match.index ?? 0, (match.index ?? 0) + 1200);
    const verb = /\.\s*(insert|upsert|update|delete)\s*\(/.exec(rest);
    if (!verb) continue;
    out.push({ table, verb: verb[1], body: rest });
  }
  return out;
}

describe('every write to an account-scoped table', () => {
  const found = shippingLibFiles().flatMap((path) =>
  statementsFor(readFileSync(path, 'utf8')).
  filter((statement) => ACCOUNT_SCOPED.includes(statement.table)).
  map((statement) => ({ ...statement, file: relative(LIB, path) }))
  );

  it('is a set this test can actually see, rather than an empty scan passing vacuously', () => {
    // The failure this exists to prevent in itself: a parse that matches nothing and reports
    // every rule as satisfied. The count is a floor rather than an exact number so that adding a
    // write does not redden CI for the wrong reason.
    expect(found.length).toBeGreaterThanOrEqual(15);
    expect(new Set(found.map((entry) => entry.file)).size).toBeGreaterThanOrEqual(4);
  });

  it('names account_id in the payload of every insert and upsert', () => {
    const offenders = found.
    filter((entry) => entry.verb === 'insert' || entry.verb === 'upsert').
    filter((entry) => !/account_id\s*:/.test(entry.body)).
    map((entry) => `${entry.file} -> ${entry.verb} into ${entry.table}`);

    expect(
      offenders,
      `${offenders.join(', ')} inserts without naming account_id. The column default is ` +
      'current_account_id(), which is NULL for anybody in two accounts, so the row is refused ' +
      'with a bare 42501 that says nothing.'
    ).toEqual([]);
  });

  it('filters on account_id in every update and delete', () => {
    const offenders = found.
    filter((entry) => entry.verb === 'update' || entry.verb === 'delete').
    filter((entry) => !/\.\s*eq\(\s*'account_id'/.test(entry.body)).
    map((entry) => `${entry.file} -> ${entry.verb} on ${entry.table}`);

    expect(
      offenders,
      `${offenders.join(', ')} sends a row id without saying which account it belongs to. ` +
      'Row level security still decides, but with roles enforced a statement that reaches zero ' +
      'rows is also how a viewer is refused, so an unscoped update cannot be reported truthfully.'
    ).toEqual([]);
  });

  it('is a check that can actually fail', () => {
    const bad = statementsFor("await client.from('products').insert({ name: 'x' }).select();");
    expect(bad).toHaveLength(1);
    expect(/account_id\s*:/.test(bad[0].body)).toBe(false);

    const worse = statementsFor("await client.from('materials').update({ a: 1 }).eq('id', id);");
    expect(/\.\s*eq\(\s*'account_id'/.test(worse[0].body)).toBe(false);
  });
});
