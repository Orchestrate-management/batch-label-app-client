/**
 * THE PERMISSION MATRIX, APP SIDE. IT DECIDES WHICH BUTTONS ARE DISABLED AND NOTHING ELSE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS NOT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * It is NOT a security boundary and must never be treated as one. This app holds the anon key
 * and the signed-in person's JWT, so anything this file declines to render can still be POSTed
 * straight at PostgREST from a console. The authority is SQL: every account-scoped write policy
 * reads `public.can(account_id, '<capability>')`, which resolves the caller's rank through
 * `public.account_rank()` and compares it against `public.account_capabilities.min_rank`.
 *
 * So a disagreement between this file and the database costs a mis-rendered button. It does not
 * cost an unauthorised write. That asymmetry is what makes it safe to fail OPEN here (see
 * `mayAct`) rather than locking somebody out of their own account over a read that blipped.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE LADDER IS DATA AND NOT A `switch`
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The database holds the matrix as two tables — `public.account_roles` (role, rank,
 * consumes_seat, label, description) and `public.account_capabilities` (capability, min_rank,
 * description) — precisely so that moving a capability between roles is one UPDATE rather than
 * an edit in three layers. This file mirrors that shape row for row, which is what lets
 * `matrixDrift` compare the two mechanically instead of somebody reading both and hoping.
 *
 * At runtime the DATABASE's copy wins: `ActiveAccountProvider` reads both tables (they are
 * granted SELECT to `authenticated` and hold no secret) and hands the result to `can()`. The
 * literals below are the fallback for a read that failed and the source of the TypeScript
 * types. A fallback rather than the answer, because a matrix compiled into a bundle a customer
 * loaded three weeks ago is exactly the copy that drifts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE ROLE VOCABULARY, AND THE THREE THAT ARE NOT IT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   public.account_members.role   THIS ONE. viewer | editor | admin | owner.
 *   public.brand_memberships.role a separate Orchestrate identity system with a
 *                                 member | admin | owner vocabulary that nothing reads. It has
 *                                 no CHECK constraint and no column comment, so it is the one
 *                                 somebody grepping for "role" finds first. Do not read it.
 *   batchlabel.*.role             ingredient and address roles: base, fragrance, dye, packaging,
 *                                 phase-item, bom-item. Nothing to do with people.
 *
 * A FOURTH used to live in this repo: `model.ts` declared `TeamMember.role` as
 * `'Owner' | 'Maker' | 'Read only'`, fed by three invented people in the fixtures. It is deleted
 * in the same change that added this file, because an app carrying two contradictory role unions
 * is an app where one screen disagrees with another about what somebody may do.
 */

/* ------------------------------------------------------------------ roles */

/**
 * The ladder, mirroring the seed in 20260805120000_member_roles_and_seats.sql section 1.
 *
 * RANKS ARE SPACED BY TEN and are an ordering rather than an identifier: a role can be inserted
 * between two existing ones without renumbering, and every comparison is `>=`. Nothing in this
 * app or in the database uses a rank as a key.
 *
 * `consumesSeat` is the single definition of which roles are billed. It exists so that no list
 * of role names appears anywhere in the seat arithmetic, in this repo or in SQL. Viewer is the
 * only false one, because read-only seats are free and unlimited on every tier.
 */
export const ACCOUNT_ROLES = [
{
  role: 'viewer',
  rank: 10,
  consumesSeat: false,
  label: 'Read only',
  description:
  'Reads everything in the account and writes nothing. Free and unlimited on every plan.'
},
{
  role: 'editor',
  rank: 20,
  consumesSeat: true,
  label: 'Editor',
  description:
  'Creates and edits materials, compositions, products and the record log. Cannot manage people, cannot change what prints as the business, cannot touch billing.'
},
{
  role: 'admin',
  rank: 30,
  consumesSeat: true,
  label: 'Admin',
  description:
  'Everything an editor can do, plus managing people and the printed business identity. Not billing.'
},
{
  role: 'owner',
  rank: 40,
  consumesSeat: true,
  label: 'Owner',
  description:
  'Everything, including billing and handing the account to somebody else. One per account.'
}] as
const;

export type AccountRole = (typeof ACCOUNT_ROLES)[number]['role'];

/* ----------------------------------------------------------- capabilities */

/**
 * What a rank is allowed to do, mirroring the same seed.
 *
 * THREE OF THESE PLACEMENTS ARE DECISIONS RATHER THAN DEFAULTS and the survey measured why:
 * before roles were enforced, a member with role 'viewer' could rewrite
 * `business_identity.registered_name` (the legally responsible business printed on every label
 * the account produces), append to the append-only compliance log, and file an account erasure
 * request. So the identity tables sit at `manage_identity` and the erasure request sits at
 * `manage_account`, not at `write_data` where "they are just more tables a maker edits" would
 * have put them.
 *
 * `manage_billing` is enforced at the www billing endpoints, which take the actor from a
 * verified token. No table in the database is gated on it, which is why the billing screen is
 * the one place where hiding a control here is the only client-side gate there is.
 */
export const ACCOUNT_CAPABILITIES = [
{
  capability: 'read',
  minRank: 10,
  description: 'See everything in the account.'
},
{
  capability: 'write_data',
  minRank: 20,
  description:
  'Create and change materials, compositions, products, label versions and the record log.'
},
{
  capability: 'manage_identity',
  minRank: 30,
  description:
  'Change what prints as the business: the supplier block, the address blocks and the workspace preferences.'
},
{
  capability: 'manage_members',
  minRank: 30,
  description: 'Invite people, change what they can do, and remove them.'
},
{
  capability: 'manage_billing',
  minRank: 40,
  description: 'Start, change and cancel the subscription.'
},
{
  capability: 'manage_account',
  minRank: 40,
  description:
  'Account-level acts that are not product data: asking for your data and asking for erasure. Ownership is not one of them, because ownership does not move.'
}] as
const;

export type Capability = (typeof ACCOUNT_CAPABILITIES)[number]['capability'];

/* --------------------------------------------------------------- a matrix */

export interface RoleRow {
  role: string;
  rank: number;
  consumesSeat: boolean;
  label: string;
}

export interface CapabilityRow {
  capability: string;
  minRank: number;
}

/**
 * A matrix, from wherever it came from.
 *
 * The compiled default below and a matrix read out of the database have the same shape on
 * purpose, so that `can()` cannot tell which one it was handed and neither can a test.
 */
export interface PermissionMatrix {
  roles: readonly RoleRow[];
  capabilities: readonly CapabilityRow[];
}

export const DEFAULT_MATRIX: PermissionMatrix = {
  roles: ACCOUNT_ROLES.map((entry) => ({
    role: entry.role,
    rank: entry.rank,
    consumesSeat: entry.consumesSeat,
    label: entry.label
  })),
  capabilities: ACCOUNT_CAPABILITIES.map((entry) => ({
    capability: entry.capability,
    minRank: entry.minRank
  }))
};

/** Tolerant reader for one `public.account_roles` row. Null for anything unusable. */
export function readRoleRow(raw: unknown): RoleRow | null {
  const row = (raw ?? {}) as Record<string, unknown>;
  const role = typeof row.role === 'string' ? row.role.trim() : '';
  const rank = typeof row.rank === 'number' && Number.isFinite(row.rank) ? row.rank : null;
  if (!role || rank === null) return null;
  return {
    role,
    rank,
    consumesSeat: row.consumes_seat === true,
    label: typeof row.label === 'string' && row.label.trim() ? row.label.trim() : role
  };
}

/** Tolerant reader for one `public.account_capabilities` row. */
export function readCapabilityRow(raw: unknown): CapabilityRow | null {
  const row = (raw ?? {}) as Record<string, unknown>;
  const capability = typeof row.capability === 'string' ? row.capability.trim() : '';
  const minRank =
  typeof row.min_rank === 'number' && Number.isFinite(row.min_rank) ? row.min_rank : null;
  if (!capability || minRank === null) return null;
  return { capability, minRank };
}

/**
 * Where the compiled copy and the database disagree, as sentences.
 *
 * NOT USED TO DECIDE ANYTHING. It is reported, so that a matrix edited in SQL without the
 * corresponding edit here shows up as a line in an error report rather than as a button that
 * looks enabled and is refused. An empty array is agreement.
 *
 * Rows the database holds and this file does not are NOT drift: a fifth role seeded later is a
 * database that has moved ahead of a bundle somebody loaded this morning, and it is handled by
 * the database's copy simply winning. What is reported is a row present in both with different
 * numbers, and a row this file claims that the database does not have.
 */
export function matrixDrift(live: PermissionMatrix): string[] {
  const out: string[] = [];

  for (const mine of DEFAULT_MATRIX.roles) {
    const theirs = live.roles.find((entry) => entry.role === mine.role);
    if (!theirs) {
      out.push(`role ${mine.role} is compiled into the app and is not in account_roles`);
      continue;
    }
    if (theirs.rank !== mine.rank) {
      out.push(`role ${mine.role} is rank ${theirs.rank} in the database and ${mine.rank} here`);
    }
    if (theirs.consumesSeat !== mine.consumesSeat) {
      out.push(
        `role ${mine.role} ${theirs.consumesSeat ? 'consumes' : 'does not consume'} a seat in the database and ${mine.consumesSeat ? 'consumes' : 'does not consume'} one here`
      );
    }
  }

  for (const mine of DEFAULT_MATRIX.capabilities) {
    const theirs = live.capabilities.find((entry) => entry.capability === mine.capability);
    if (!theirs) {
      out.push(
        `capability ${mine.capability} is compiled into the app and is not in account_capabilities`
      );
      continue;
    }
    if (theirs.minRank !== mine.minRank) {
      out.push(
        `capability ${mine.capability} needs rank ${theirs.minRank} in the database and ${mine.minRank} here`
      );
    }
  }

  return out;
}

/* --------------------------------------------------------------- reading */

const KNOWN_ROLES: readonly string[] = ACCOUNT_ROLES.map((entry) => entry.role);

/** True for one of the four documented roles, and only those. */
export function isAccountRole(value: unknown): value is AccountRole {
  return typeof value === 'string' && KNOWN_ROLES.includes(value.trim().toLowerCase());
}

/**
 * A role name from a database column, or null.
 *
 * NULL IS "WE DO NOT KNOW", never "viewer". A role we could not read must not silently become
 * the least privileged one: that would turn one failed read into a read-only app for an owner,
 * with no error anywhere explaining it. `mayAct` is where the null is resolved, and it resolves
 * it open.
 */
export function readRole(value: unknown): AccountRole | null {
  if (!isAccountRole(value)) return null;
  return (value as string).trim().toLowerCase() as AccountRole;
}

/* -------------------------------------------------------------- deciding */

function rankOf(matrix: PermissionMatrix, role: string): number | null {
  const found = matrix.roles.find((entry) => entry.role === role);
  return found ? found.rank : null;
}

function minRankOf(matrix: PermissionMatrix, capability: string): number | null {
  const found = matrix.capabilities.find((entry) => entry.capability === capability);
  return found ? found.minRank : null;
}

/** The rank of a role, or null for a role neither the matrix nor this file knows. */
export function roleRank(role: string | null, matrix: PermissionMatrix = DEFAULT_MATRIX): number | null {
  if (!role) return null;
  return rankOf(matrix, role);
}

/** The printable name of a role, falling back to the slug rather than inventing one. */
export function roleLabel(role: string | null, matrix: PermissionMatrix = DEFAULT_MATRIX): string {
  if (!role) return 'Unknown';
  const found = matrix.roles.find((entry) => entry.role === role);
  return found ? found.label : role;
}

/** Whether holding this role uses one of the account's editor seats. Unknown roles do not. */
export function consumesSeat(role: string | null, matrix: PermissionMatrix = DEFAULT_MATRIX): boolean {
  if (!role) return false;
  const found = matrix.roles.find((entry) => entry.role === role);
  return found ? found.consumesSeat : false;
}

/**
 * THE STRICT ANSWER. A known role against a known capability, and false for anything else.
 *
 * An unknown capability name is false, which mirrors `public.can()`: its lookup returns null and
 * the `coalesce(..., false)` makes a typo in a policy fail closed. A typo here fails closed too,
 * so a control gated on a misspelt capability is visibly dead rather than quietly open.
 */
export function roleCan(
role: string | null,
capability: string,
matrix: PermissionMatrix = DEFAULT_MATRIX)
: boolean {
  const rank = roleRank(role, matrix);
  const needed = minRankOf(matrix, capability);
  if (rank === null || needed === null) return false;
  return rank >= needed;
}

/**
 * THE ANSWER A BUTTON SHOULD ASK FOR, WHICH FAILS OPEN ON AN UNKNOWN ROLE.
 *
 * Three ways to hold a null role and all three want the same treatment:
 *
 *   the schema predates the matrix   the migration has not been applied to this environment
 *                                    yet, so `account_entitlement` does not exist and there is
 *                                    no role to read. Every account is one owner in that world,
 *                                    so closing every control would break the whole app for
 *                                    everybody in order to protect a role that cannot exist.
 *   the read failed                  a blip. The same argument `mayModify` makes: denying on
 *                                    null locks out a paying customer, silently, with no error.
 *   the read has not landed          the first paint. Disabling every control for 200ms and
 *                                    then enabling it is worse than either steady state.
 *
 * The cost of being wrong this way round is one refused write with an honest message, because
 * the database refuses it whatever this function said. The cost of being wrong the other way
 * round is an owner who cannot use the product they pay for.
 */
export function mayAct(
role: string | null,
capability: string,
matrix: PermissionMatrix = DEFAULT_MATRIX)
: boolean {
  if (!role) return true;
  return roleCan(role, capability, matrix);
}

/**
 * WHY A CONTROL IS OFF, in one sentence, or null when it is not off.
 *
 * Every disabled control in this app has to be able to say why without the reader guessing, and
 * "you do not have permission" is not that sentence: it does not say what they DO have, and it
 * does not say who to ask. Each of these names the role the person holds and the person who can
 * change it.
 */
export function permissionReason(
role: string | null,
capability: Capability,
matrix: PermissionMatrix = DEFAULT_MATRIX)
: string | null {
  if (mayAct(role, capability, matrix)) return null;
  const name = roleLabel(role, matrix).toLowerCase();

  switch (capability) {
    case 'write_data':
      return `You are ${name} on this account, so you can see everything here and change nothing. An admin or the owner can give you an editor seat.`;
    case 'manage_identity':
      return `Changing what prints as the business is limited to admins and the owner, and you are ${name} on this account. What is here is what your labels and safety data sheets carry.`;
    case 'manage_members':
      return `Adding and removing people is limited to admins and the owner, and you are ${name} on this account.`;
    case 'manage_billing':
      return `The plan belongs to the account owner, and you are ${name} on this account. Ask them to make the change.`;
    case 'manage_account':
      return `That is the account owner's to do, and you are ${name} on this account.`;
    case 'read':
    default:
      return `You are ${name} on this account, so that is not something you can reach.`;
  }
}

/* ---------------------------------------------------- managing other people */

/**
 * The roles a manager may hand out, which is every role at or below their own EXCEPT owner.
 *
 * TWO RULES, BOTH ENFORCED IN SQL AND BOTH RESTATED HERE SO THE SELECT DOES NOT OFFER A CHOICE
 * THAT WOULD BE REFUSED:
 *
 *   never above yourself   the UPDATE policy on account_members compares
 *                          `account_role_rank(role) <= account_rank(account_id)` in BOTH its
 *                          USING and its WITH CHECK slots, so an admin naming 'owner' is
 *                          refused with 42501 and an admin touching the owner's row matches no
 *                          rows at all.
 *   never owner            OWNERSHIP DOES NOT MOVE AT ALL. accounts.owner_user_id is both who
 *                          runs the account and whose subscription pays for it, and the
 *                          migration that would have moved it was withdrawn once every
 *                          reachable path through it was measured corrupting one or the other
 *                          (20260805120000 section 8). A partial unique index refuses a second
 *                          active owner even to a superuser, a deferred constraint trigger
 *                          refuses a commit that leaves none, and `account_invites` carries
 *                          `check (role <> 'owner')`. So there is no path, and an owner option
 *                          in a picker is an option every layer beneath it refuses.
 *
 * Returns an empty list for somebody who cannot manage members at all, which is what stops a
 * role picker being rendered to an editor.
 */
export function assignableRoles(
actorRole: string | null,
matrix: PermissionMatrix = DEFAULT_MATRIX)
: RoleRow[] {
  if (!roleCan(actorRole, 'manage_members', matrix)) return [];
  const actorRank = roleRank(actorRole, matrix);
  if (actorRank === null) return [];
  return matrix.roles.
  filter((entry) => entry.role !== 'owner' && entry.rank <= actorRank).
  slice().
  sort((a, b) => a.rank - b.rank);
}

/**
 * Whether this actor may change or end THAT member's membership.
 *
 * The rank comparison is `<=` rather than `<`, which is the ratified cell and is worth knowing:
 * two admins can each act on the other. Making it `<` would close that and would also mean two
 * admins could never remove a rogue peer without fetching the owner. The owner can always
 * restore, and an admin can never touch the owner, so the blast radius is bounded.
 */
export function mayManageMember(
actorRole: string | null,
targetRole: string | null,
matrix: PermissionMatrix = DEFAULT_MATRIX)
: boolean {
  if (!roleCan(actorRole, 'manage_members', matrix)) return false;
  const actorRank = roleRank(actorRole, matrix);
  const targetRank = roleRank(targetRole, matrix);
  if (actorRank === null || targetRank === null) return false;
  return targetRank <= actorRank;
}
