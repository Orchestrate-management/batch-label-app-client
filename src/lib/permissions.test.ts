import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_CAPABILITIES,
  ACCOUNT_ROLES,
  DEFAULT_MATRIX,
  assignableRoles,
  consumesSeat,
  isAccountRole,
  matrixDrift,
  mayAct,
  mayManageMember,
  permissionReason,
  readCapabilityRow,
  readRole,
  readRoleRow,
  roleCan,
  roleLabel,
  roleRank,
  type PermissionMatrix } from
'./permissions';

/**
 * THE MATRIX, AND THE FOUR PROPERTIES THAT MAKE IT SAFE TO GATE A BUTTON ON.
 *
 * 1. It agrees with the database's seed, cell for cell. Asserted as literal numbers below rather
 *    than derived from the same constants, because a test that reads its expectations out of the
 *    thing under test proves only that the thing is self-consistent.
 * 2. An unknown ROLE fails open and an unknown CAPABILITY fails closed. Those directions are
 *    opposite on purpose and each is argued where it is implemented.
 * 3. Nobody can be offered a role above their own, and nobody can be offered `owner` at all.
 * 4. `viewer` is the only role that does not consume a seat, which is the single fact all of the
 *    seat arithmetic in the app and in SQL is keyed on.
 */

describe('the role ladder', () => {
  it('holds the four ratified roles at the ranks the database seeds', () => {
    // 20260805120000_member_roles_and_seats.sql section 1. Spaced by ten so a role can be
    // inserted between two without renumbering.
    expect(ACCOUNT_ROLES.map((entry) => [entry.role, entry.rank])).toEqual([
    ['viewer', 10],
    ['editor', 20],
    ['admin', 30],
    ['owner', 40]]
    );
  });

  it('bills every role except viewer, which is the only fact the seat maths reads', () => {
    // Read-only seats are free and unlimited on every tier, which is why `editor_seat_limit` is
    // named for what it counts and why there is no read_only_seat_limit column to be enforced by
    // accident. If this assertion ever needs changing, the seat trigger changes with it.
    expect(ACCOUNT_ROLES.filter((entry) => !entry.consumesSeat).map((entry) => entry.role)).
    toEqual(['viewer']);
    expect(consumesSeat('viewer')).toBe(false);
    expect(consumesSeat('editor')).toBe(true);
    expect(consumesSeat('admin')).toBe(true);
    expect(consumesSeat('owner')).toBe(true);
  });

  it('files every capability at a rank one of those roles actually holds', () => {
    // The database enforces this with a foreign key from account_capabilities.min_rank to
    // account_roles.rank, so a capability filed at rank 25 is a 23503 at the moment somebody
    // tries. Nothing here can raise a 23503, so the same property is asserted instead: a
    // capability nobody holds is one every control gated on it is permanently dead.
    const ranks = new Set(ACCOUNT_ROLES.map((entry) => entry.rank));
    for (const capability of ACCOUNT_CAPABILITIES) {
      expect(ranks.has(capability.minRank), `${capability.capability} is filed at rank ${capability.minRank}, which no role holds`).
      toBe(true);
    }
  });

  it('places the six capabilities exactly where the migration seeds them', () => {
    expect(ACCOUNT_CAPABILITIES.map((entry) => [entry.capability, entry.minRank])).toEqual([
    ['read', 10],
    ['write_data', 20],
    ['manage_identity', 30],
    ['manage_members', 30],
    ['manage_billing', 40],
    ['manage_account', 40]]
    );
  });
});

describe('what each role may do', () => {
  /**
   * The whole matrix as one table, which is the thing a person actually wants to read.
   *
   * These are the four rows the migration prints from its own tables at apply time. The three
   * that matter most are on the viewer line: no write_data, no manage_identity, no
   * manage_account. Before roles were enforced, a viewer could rewrite the registered business
   * name printed on every label the account produces, append to the append-only compliance log,
   * and file an account erasure request. All three were measured.
   */
  const EXPECTED: Record<string, string[]> = {
    viewer: ['read'],
    editor: ['read', 'write_data'],
    admin: ['read', 'write_data', 'manage_identity', 'manage_members'],
    owner: [
    'read',
    'write_data',
    'manage_identity',
    'manage_members',
    'manage_billing',
    'manage_account']

  };

  it.each(Object.keys(EXPECTED))('gives %s exactly its ratified capabilities', (role) => {
    const held = ACCOUNT_CAPABILITIES.
    filter((entry) => roleCan(role, entry.capability)).
    map((entry) => entry.capability);
    expect(held).toEqual(EXPECTED[role]);
  });

  it('refuses a capability nobody has ever heard of, so a typo fails closed', () => {
    // `public.can()` does the same: its lookup returns null and the coalesce makes it false, so
    // a misspelt capability in a policy refuses everybody rather than admitting everybody.
    expect(roleCan('owner', 'manage_the_universe')).toBe(false);
    expect(mayAct('owner', 'manage_the_universe')).toBe(false);
  });

  it('refuses a role nobody has ever heard of', () => {
    expect(roleCan('superadmin', 'read')).toBe(false);
    expect(roleRank('superadmin')).toBeNull();
  });
});

describe('an unknown role', () => {
  it('fails OPEN, because taking an ability away from somebody who has it is the expensive mistake', () => {
    // Three ways to hold a null role: a database that predates the matrix, a read that failed,
    // and a read that has not landed. In the first there are no roles at all, so closing every
    // control would break the app for everybody in order to protect a role that cannot exist.
    // In the other two the database refuses anything this app gets wrong anyway.
    expect(mayAct(null, 'write_data')).toBe(true);
    expect(mayAct(null, 'manage_billing')).toBe(true);
  });

  it('is still not treated as a role, so it can never be offered one or manage anybody', () => {
    // Failing open on a GATE is not the same as failing open on an ACT. Offering a null-role
    // person a role picker would render a control whose every option is refused.
    expect(roleCan(null, 'write_data')).toBe(false);
    expect(assignableRoles(null)).toEqual([]);
    expect(mayManageMember(null, 'viewer')).toBe(false);
  });

  it('never quietly becomes viewer, which would lock an owner out of their own account', () => {
    expect(readRole(null)).toBeNull();
    expect(readRole('')).toBeNull();
    expect(readRole('Maker')).toBeNull();
    expect(readRole('OWNER')).toBe('owner');
    expect(readRole('  editor  ')).toBe('editor');
    expect(isAccountRole('viewer')).toBe(true);
    expect(isAccountRole('Read only')).toBe(false);
  });
});

describe('handing out a role', () => {
  it('never offers owner, because ownership does not move at all', () => {
    // account_invites carries `check (role <> 'owner')`, a partial unique index refuses a
    // second active owner even to a superuser, and the transfer RPC that used to exist was
    // withdrawn. So an owner option in a picker is an option the database refuses.
    for (const actor of ['admin', 'owner']) {
      expect(assignableRoles(actor).map((entry) => entry.role)).not.toContain('owner');
    }
  });

  it('never offers a role above the actor, which is what the UPDATE policy refuses', () => {
    expect(assignableRoles('admin').map((entry) => entry.role)).toEqual(['viewer', 'editor', 'admin']);
    expect(assignableRoles('owner').map((entry) => entry.role)).toEqual(['viewer', 'editor', 'admin']);
  });

  it('offers nothing at all to somebody who cannot manage members', () => {
    expect(assignableRoles('editor')).toEqual([]);
    expect(assignableRoles('viewer')).toEqual([]);
  });

  it('lets a manager act on a peer and never on somebody above them', () => {
    // `<=` rather than `<` is the ratified cell: two admins can each act on the other. Making it
    // strict would close that and would also mean two admins could never remove a rogue peer
    // without fetching the owner.
    expect(mayManageMember('admin', 'admin')).toBe(true);
    expect(mayManageMember('admin', 'editor')).toBe(true);
    expect(mayManageMember('admin', 'owner')).toBe(false);
    expect(mayManageMember('owner', 'admin')).toBe(true);
    expect(mayManageMember('editor', 'viewer')).toBe(false);
  });
});

describe('the sentence a disabled control says', () => {
  it('is null when the control is not disabled, so nothing renders over a working button', () => {
    expect(permissionReason('owner', 'manage_billing')).toBeNull();
    expect(permissionReason('editor', 'write_data')).toBeNull();
    expect(permissionReason(null, 'write_data')).toBeNull();
  });

  it('names the role the person holds, so they are not left guessing what they are', () => {
    expect(permissionReason('viewer', 'write_data')).toContain('read only');
    expect(permissionReason('editor', 'manage_identity')).toContain('editor');
    expect(permissionReason('admin', 'manage_billing')).toContain('admin');
  });

  it('says who can change it rather than only saying no', () => {
    // "You do not have permission" is the sentence this exists to replace: it does not say what
    // they DO have and it does not say who to ask, so it produces a support email either way.
    expect(permissionReason('viewer', 'write_data')).toMatch(/admin or the owner/i);
    expect(permissionReason('editor', 'manage_members')).toMatch(/admins and the owner/i);
    expect(permissionReason('admin', 'manage_billing')).toMatch(/owner/i);
  });

  it('carries no em dash and no X-not-Y construction, which is house copy doctrine', () => {
    for (const role of ['viewer', 'editor', 'admin']) {
      for (const capability of ACCOUNT_CAPABILITIES) {
        const sentence = permissionReason(role, capability.capability as never);
        if (!sentence) continue;
        expect(sentence, `${role} / ${capability.capability}`).not.toMatch(/—/);
        expect(sentence, `${role} / ${capability.capability}`).not.toMatch(/\bnot\b[^.]*\bbut\b/);
      }
    }
  });
});

describe('reading a matrix out of the database', () => {
  it('takes a row it can use and refuses one it cannot', () => {
    expect(readRoleRow({ role: 'editor', rank: 20, consumes_seat: true, label: 'Editor' })).toEqual({
      role: 'editor',
      rank: 20,
      consumesSeat: true,
      label: 'Editor'
    });
    // A row with no rank cannot be compared with anything, so it is dropped rather than
    // defaulted to zero, which would make it hold every capability filed at rank 10 and above.
    expect(readRoleRow({ role: 'editor' })).toBeNull();
    expect(readRoleRow({ rank: 20 })).toBeNull();
    expect(readRoleRow(null)).toBeNull();
    // Absent `consumes_seat` reads as false rather than as true: a role wrongly counted as free
    // oversells seats, a role wrongly counted as billed blocks an invite the plan allows, and
    // the database is the thing that actually enforces the ceiling either way.
    expect(readRoleRow({ role: 'x', rank: 5 })).toEqual({
      role: 'x',
      rank: 5,
      consumesSeat: false,
      label: 'x'
    });
  });

  it('reads a capability row, and refuses one with no rank', () => {
    expect(readCapabilityRow({ capability: 'read', min_rank: 10 })).toEqual({
      capability: 'read',
      minRank: 10
    });
    expect(readCapabilityRow({ capability: 'read' })).toBeNull();
    expect(readCapabilityRow({ min_rank: 10 })).toBeNull();
  });

  it('answers from the DATABASE copy rather than the compiled one when both are supplied', () => {
    // This is what makes the two tables the single definition at runtime. Moving write_data up
    // to admin is one UPDATE in SQL, and this app follows it without being redeployed.
    const moved: PermissionMatrix = {
      roles: DEFAULT_MATRIX.roles,
      capabilities: [{ capability: 'write_data', minRank: 30 }]
    };
    expect(roleCan('editor', 'write_data', moved)).toBe(false);
    expect(roleCan('admin', 'write_data', moved)).toBe(true);
    // And the compiled copy is untouched by that, so nothing has been mutated in place.
    expect(roleCan('editor', 'write_data')).toBe(true);
  });
});

describe('drift between the compiled matrix and the database', () => {
  it('reports nothing when they agree', () => {
    expect(matrixDrift(DEFAULT_MATRIX)).toEqual([]);
  });

  it('names a capability the database has moved', () => {
    const drift = matrixDrift({
      roles: DEFAULT_MATRIX.roles,
      capabilities: DEFAULT_MATRIX.capabilities.map((entry) =>
      entry.capability === 'manage_members' ? { ...entry, minRank: 40 } : entry
      )
    });
    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain('manage_members');
    expect(drift[0]).toContain('40');
  });

  it('names a role whose rank or billing has moved', () => {
    const drift = matrixDrift({
      roles: DEFAULT_MATRIX.roles.map((entry) =>
      entry.role === 'viewer' ? { ...entry, rank: 15, consumesSeat: true } : entry
      ),
      capabilities: DEFAULT_MATRIX.capabilities
    });
    expect(drift.join(' ')).toContain('viewer');
    expect(drift.join(' ')).toMatch(/rank 15/);
    expect(drift.join(' ')).toMatch(/consumes a seat in the database/);
  });

  it('names a role or capability the database does not have at all', () => {
    const drift = matrixDrift({ roles: [], capabilities: [] });
    expect(drift).toHaveLength(ACCOUNT_ROLES.length + ACCOUNT_CAPABILITIES.length);
    expect(drift.join(' ')).toContain('account_roles');
    expect(drift.join(' ')).toContain('account_capabilities');
  });

  it('does NOT report a role the database has and this app does not', () => {
    // A fifth role seeded later is a database that has moved ahead of a bundle somebody loaded
    // this morning, which is handled by the database's copy simply winning. Reporting it would
    // file an error on every session for the whole of a deploy window.
    const drift = matrixDrift({
      roles: [...DEFAULT_MATRIX.roles, { role: 'auditor', rank: 15, consumesSeat: false, label: 'Auditor' }],
      capabilities: DEFAULT_MATRIX.capabilities
    });
    expect(drift).toEqual([]);
  });
});

describe('printing a role', () => {
  it('uses the label the database gave it', () => {
    expect(roleLabel('viewer')).toBe('Read only');
    expect(roleLabel('owner')).toBe('Owner');
  });

  it('falls back to the slug rather than inventing a name for a role it does not know', () => {
    expect(roleLabel('auditor')).toBe('auditor');
    expect(roleLabel(null)).toBe('Unknown');
  });
});
