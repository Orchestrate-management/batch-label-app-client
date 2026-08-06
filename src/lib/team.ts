/**
 * WHO IS IN THIS ACCOUNT, WHICH ACCOUNTS THIS PERSON IS IN, AND WHAT EACH OF THEM ALLOWS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS AT ALL, WHICH IS THE FINDING THAT MATTERS MOST
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `public.entitlements` is keyed by OWNERSHIP. It selects from `public.brand_memberships`, it is
 * security_invoker, the only SELECT policy on that table is `auth.uid() = user_id`, and the
 * account is resolved by a lateral join on `owner_user_id = m.user_id`. So an ACTIVE INVITED
 * MEMBER selecting from it gets zero rows. Measured, on a live chain, in the design that
 * preceded this change.
 *
 * `src/lib/membership.ts` read exactly that view and it was the app's only source of an account
 * id. Left alone, every invited member would have signed in and been shown the "your account is
 * still being set up" screen forever: seats would have shipped broken for precisely the people
 * they are sold to.
 *
 * Widening the view is not the fix, because it would put one person's plan, Stripe status and
 * billing state onto another person's row. Membership identity and the allowance are two
 * different questions with two different keys, so the database answers them with two functions
 * and this file calls both:
 *
 *   public.my_accounts()                 which accounts am I in, and as what. Keyed on
 *                                        auth.uid(), takes no argument, so it is not a probe.
 *   public.account_entitlement(uuid)     what does THIS ACCOUNT allow, plus my own role in it
 *                                        and its seat usage. Keyed on the account, and guarded
 *                                        by a trailing `is_member_of(p_account_id)` so a
 *                                        stranger gets zero rows.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE BROWSER MAY AND MAY NOT DO TO A MEMBERSHIP
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   SELECT   yes, on every member of an account you are in.
 *   UPDATE   yes, on (role, status) ONLY. The grant is column-level, and a column privilege is
 *            checked BEFORE row level security is consulted, so account_id and user_id are
 *            unreachable from here by construction rather than by a policy somebody could get
 *            wrong. There is no code path in this file that could move a member between
 *            accounts, and there could not be one.
 *   INSERT   never. A browser that could insert here would hand itself a colleague's data. The
 *            only path to a new row is `accept_account_invite`, which needs a token.
 *   DELETE   never. Removal is `status = 'removed'`. A compliance product cannot discard the
 *            record of who was in the account and when, or "was this batch signed off by
 *            somebody authorised at the time" stops being answerable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY CREATING AN INVITE IS A CROSS-ORIGIN POST AND NOT AN RPC
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `public.create_account_invite` is service-role only and returns the plaintext token exactly
 * once, so that the token can be emailed. A token that transits a browser is a token in a
 * history entry, a network tab, a screen share, a referrer header and any client-side error
 * report. So the app posts to a www endpoint with its bearer JWT, www verifies the token, takes
 * the actor from THAT verified token and from nowhere else, calls the RPC under the service
 * role, sends the email, and answers `{ ok: true }` carrying no token. That is the same shape
 * lib/billing.ts already proves for three endpoints.
 *
 * THE ENDPOINT IS NOT DEPLOYED YET. `batch-label-www/api/` holds create-checkout-session,
 * create-portal-session, plans and stripe-webhook, and nothing else. Until the invite route
 * exists, `sendInvite` gets a 404 and says so in words a person can act on rather than
 * pretending the address was wrong. That state is checked for, named, and NOT dressed up as a
 * failure of theirs.
 */

import { supabase } from './supabase';
import { MARKETING_URL } from './marketing';
import {
  DEFAULT_MATRIX,
  readCapabilityRow,
  readRoleRow,
  type PermissionMatrix } from
'./permissions';

/* ------------------------------------------------------------------ shapes */

export type TeamResult<T> = {ok: true;value: T;} | {ok: false;message: string;};

/** One row of `public.my_accounts()`. */
export interface AccountMembership {
  accountId: string;
  brand: string | null;
  accountName: string | null;
  role: string;
  roleRank: number | null;
  roleLabel: string | null;
  isOwner: boolean;
  joinedAt: string | null;
}

/** One row of `public.account_members`, for the account currently being worked in. */
export interface AccountMember {
  userId: string;
  role: string;
  status: string;
  joinedAt: string | null;
  /**
   * The address this person was invited at, when they joined through an invitation.
   *
   * THE APP CANNOT READ ANOTHER MEMBER'S EMAIL, and this is the honest workaround rather than a
   * gap somebody forgot. `public.profiles` publishes `auth.uid() = id` only, so the only email
   * address the browser can ever see is its own. `public.account_invite_list` is readable by
   * anybody holding manage_members and carries the invited address alongside `accepted_by`, so
   * a member who joined by invitation can be named. The founding owner joined through
   * `ensure_account` rather than an invite and therefore has none, which the screen says
   * plainly instead of leaving a blank.
   */
  email: string | null;
}

export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired' | 'unknown';

/** One row of `public.account_invite_list`. */
export interface AccountInvite {
  id: string;
  email: string;
  role: string;
  status: InviteStatus;
  createdAt: string | null;
  expiresAt: string | null;
  acceptedAt: string | null;
  acceptedBy: string | null;
}

/* ------------------------------------------------------------- boilerplate */

const NOT_CONNECTED =
'This app is not connected to its database, so there is nothing to read and nothing can be saved. This is us, not you.';

const READ_FAILED =
'We could not read who is in this account just now. This is us, not you, and nothing has changed.';

const WRITE_FAILED =
'We could not save that just now. Nothing has changed, so please try again in a moment.';

/**
 * Said when a statement was accepted, raised nothing, and reached no row.
 *
 * The trap every write module in this repo documents: an UPDATE excluded by an RLS `using`
 * clause matches nothing and reports success. On this table it has a second and sharper cause
 * now that roles are enforced. `using (can(account_id,'manage_members') and
 * account_role_rank(role) <= account_rank(account_id))` makes a row ABOVE your own rank
 * invisible to your UPDATE, so an admin trying to demote the owner gets no error and no row.
 * Reading that as a save would tell somebody they had removed the owner of the business.
 */
const REACHED_NOTHING =
'Nothing changed. That person is not somebody this account lets you change, so the edit did not reach them.';

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/* ------------------------------------------------------- accounts and plan */

/**
 * Every account this person is an active member of.
 *
 * A FAILED READ IS NOT AN EMPTY LIST, and the two are returned differently on purpose. Empty
 * means the database looked and there is nothing, which for this app means signup did not
 * finish. `ok: false` means we could not look, and the screens must say so rather than telling a
 * paying customer their account is gone.
 *
 * THE MISSING-FUNCTION CASE IS TREATED AS A FAILED READ AND NOT AS ZERO ACCOUNTS. An environment
 * whose migrations stop before 20260805120000 has no `my_accounts`, and PostgREST answers that
 * with PGRST202. Reading it as "you are in no accounts" would black out every screen in the app
 * the moment this deploy landed ahead of the migration, which is the ordinary order of a deploy.
 * `missing` says which, and the caller falls back to the entitlements view.
 */
export interface MyAccountsResult {
  ok: boolean;
  accounts: AccountMembership[];
  /** True when the RPC itself is not published by this database. */
  missing: boolean;
  message: string | null;
}

const FUNCTION_NOT_FOUND = 'PGRST202';

export async function fetchMyAccounts(): Promise<MyAccountsResult> {
  const client = supabase;
  if (!client) return { ok: false, accounts: [], missing: false, message: NOT_CONNECTED };

  const { data, error } = await client.rpc('my_accounts');

  if (error) {
    const missing = error.code === FUNCTION_NOT_FOUND;
    return {
      ok: false,
      accounts: [],
      missing,
      message: missing ? null : READ_FAILED
    };
  }

  const rows = Array.isArray(data) ? data : [];
  const accounts: AccountMembership[] = [];
  for (const raw of rows) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const accountId = text(row.account_id);
    const role = text(row.role);
    if (!accountId || !role) continue;
    accounts.push({
      accountId,
      brand: text(row.brand),
      accountName: text(row.account_name),
      role,
      roleRank: num(row.role_rank),
      roleLabel: text(row.role_label),
      isOwner: row.is_owner === true,
      joinedAt: text(row.joined_at)
    });
  }
  return { ok: true, accounts, missing: false, message: null };
}

/**
 * The plan, allowance, seat usage and caller's own role for ONE account.
 *
 * Returns the row shape `readEntitlementRow` in lib/membership.ts already parses, plus the three
 * columns the view never carried: `seats_in_use`, `caller_role` and `caller_rank`. The mapping
 * lives there rather than here so that "what does active mean" stays in one file.
 */
export interface AccountEntitlementResult {
  ok: boolean;
  row: Record<string, unknown> | null;
  missing: boolean;
}

export async function fetchAccountEntitlement(
accountId: string)
: Promise<AccountEntitlementResult> {
  const client = supabase;
  if (!client) return { ok: false, row: null, missing: false };

  const { data, error } = await client.rpc('account_entitlement', { p_account_id: accountId });

  if (error) {
    return { ok: false, row: null, missing: error.code === FUNCTION_NOT_FOUND };
  }
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const first = rows[0] as Record<string, unknown> | undefined;
  return { ok: true, row: first ?? null, missing: false };
}

/**
 * The live matrix, read out of the database.
 *
 * Both tables grant SELECT to `authenticated` and hold no secret: the app renders the matrix as
 * which buttons are disabled, so it is published rather than protected. Reading it is what makes
 * the database the single definition at runtime instead of a bundle somebody loaded three weeks
 * ago. A failure falls back to the compiled copy, which is stale by construction and advisory
 * either way.
 */
export async function fetchPermissionMatrix(): Promise<PermissionMatrix | null> {
  const client = supabase;
  if (!client) return null;

  const [roles, capabilities] = await Promise.all([
  client.from('account_roles').select('role, rank, consumes_seat, label'),
  client.from('account_capabilities').select('capability, min_rank')]
  );

  if (roles.error || capabilities.error) return null;

  const roleRows = (roles.data ?? []).map(readRoleRow).filter((row) => row !== null);
  const capabilityRows = (capabilities.data ?? []).
  map(readCapabilityRow).
  filter((row) => row !== null);

  // A matrix missing either half decides nothing safely, so it is refused wholesale rather
  // than merged with the compiled copy. Half a ladder answers questions confidently and wrongly.
  if (roleRows.length === 0 || capabilityRows.length === 0) return null;

  return {
    roles: roleRows as PermissionMatrix['roles'],
    capabilities: capabilityRows as PermissionMatrix['capabilities']
  };
}

export { DEFAULT_MATRIX };

/* ------------------------------------------------------------------ people */

const MEMBER_COLUMNS = 'user_id, role, status, created_at';

/**
 * Everybody in the account, with the address they were invited at where there is one.
 *
 * The invite read is OPTIONAL and its failure is not the member list's failure: only somebody
 * holding manage_members can see invites, so an editor or a viewer opening this screen gets the
 * members with no addresses attached, which is exactly right. A viewer must not be handed an
 * email harvest of everybody they work with.
 */
export async function fetchMembers(accountId: string): Promise<TeamResult<AccountMember[]>> {
  const client = supabase;
  if (!client) return { ok: false, message: NOT_CONNECTED };

  const { data, error } = await client.
  from('account_members').
  select(MEMBER_COLUMNS).
  eq('account_id', accountId).
  order('created_at', { ascending: true });

  if (error) return { ok: false, message: READ_FAILED };

  const invites = await fetchInvites(accountId);
  const byUser = new Map<string, string>();
  if (invites.ok) {
    for (const invite of invites.value) {
      if (invite.acceptedBy && invite.email) byUser.set(invite.acceptedBy, invite.email);
    }
  }

  const members: AccountMember[] = [];
  for (const raw of data ?? []) {
    const row = raw as Record<string, unknown>;
    const userId = text(row.user_id);
    const role = text(row.role);
    if (!userId || !role) continue;
    members.push({
      userId,
      role,
      status: text(row.status) ?? 'active',
      joinedAt: text(row.created_at),
      email: byUser.get(userId) ?? null
    });
  }
  return { ok: true, value: members };
}

const INVITE_COLUMNS =
'id, email, role, status, created_at, expires_at, accepted_at, accepted_by';

function readInviteStatus(value: unknown): InviteStatus {
  const word = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (word === 'pending' || word === 'accepted' || word === 'revoked' || word === 'expired') {
    return word;
  }
  // A status word the view grew later must not read as one of the four. `unknown` renders as a
  // quiet pill saying so, which is a great deal better than calling a revoked invite pending.
  return 'unknown';
}

/**
 * The invitations, read through the VIEW and never through the table.
 *
 * PostgREST issues `select *`. Against a table carrying column-level SELECT grants that is a
 * blanket 42501 for everybody, including the admin who is entitled to read the row. So
 * `public.account_invites` is unreadable from this app by design and
 * `public.account_invite_list` is the readable surface: every column except `token_hash`, plus a
 * derived status. It is security_invoker, so the `manage_members` policy on the table underneath
 * is what decides visibility.
 */
export async function fetchInvites(accountId: string): Promise<TeamResult<AccountInvite[]>> {
  const client = supabase;
  if (!client) return { ok: false, message: NOT_CONNECTED };

  const { data, error } = await client.
  from('account_invite_list').
  select(INVITE_COLUMNS).
  eq('account_id', accountId).
  order('created_at', { ascending: false });

  if (error) return { ok: false, message: READ_FAILED };

  const invites: AccountInvite[] = [];
  for (const raw of data ?? []) {
    const row = raw as Record<string, unknown>;
    const id = text(row.id);
    const email = text(row.email);
    const role = text(row.role);
    if (!id || !email || !role) continue;
    invites.push({
      id,
      email,
      role,
      status: readInviteStatus(row.status),
      createdAt: text(row.created_at),
      expiresAt: text(row.expires_at),
      acceptedAt: text(row.accepted_at),
      acceptedBy: text(row.accepted_by)
    });
  }
  return { ok: true, value: invites };
}

/* ------------------------------------------------------------- seat maths */

export interface SeatState {
  /** How many editor seats the plan allows, or null when we could not read it. */
  limit: number | null;
  /** Active seat-consuming members plus live pending invites, counted by the database. */
  inUse: number | null;
  /** True when one more seat-consuming member cannot be added. Null-safe: unknown is false. */
  full: boolean;
  /** How many are left, or null when either half is unknown. Never negative. */
  remaining: number | null;
  /** True when the ceiling has dropped below what is already in use, which is a downgrade. */
  over: boolean;
}

/**
 * The seat picture, from the two numbers the database counted.
 *
 * OVER-LIMIT IS A NORMAL STEADY STATE AND NOT AN ERROR. `editor_seat_limit` follows the plan
 * down inside the same UPDATE that writes the plan, so a downgrade puts an account over its
 * ceiling within one webhook. The ruling is: block new seat consumption, strip nobody. Nothing
 * on the team screen may offer to remove somebody in order to fit, and nothing may suggest that
 * the people already there are at risk.
 *
 * UNKNOWN IS NOT FULL. Either half null yields `full: false`, so a failed read leaves the invite
 * form open and the database refuses at commit with `hint = seat_limit_reached` if it was in
 * fact full. One honest refusal beats hiding the only control that could fix the situation.
 */
export function seatState(limit: number | null, inUse: number | null): SeatState {
  if (limit === null || inUse === null) {
    return { limit, inUse, full: false, remaining: null, over: false };
  }
  return {
    limit,
    inUse,
    full: inUse >= limit,
    remaining: Math.max(0, limit - inUse),
    over: inUse > limit
  };
}

/* ------------------------------------------------------------------ writes */

/**
 * Changes what one member may do.
 *
 * Sends `role` and nothing else. The column grant is `update (role, status)`, so a payload
 * carrying `account_id` would be refused with 42501 for the wrong reason and there would be no
 * way to tell that apart from a policy refusal.
 *
 * The account is filtered as well as the user, for the same reason every read in this repo is:
 * row level security answers "may I touch this row" and the filter answers "is this the account
 * whose screen I am on". A user id is unique across accounts only because a person can be in two.
 */
export async function changeMemberRole(
accountId: string,
userId: string,
role: string)
: Promise<TeamResult<void>> {
  const client = supabase;
  if (!client) return { ok: false, message: NOT_CONNECTED };

  const { data, error } = await client.
  from('account_members').
  update({ role }).
  eq('account_id', accountId).
  eq('user_id', userId).
  select('user_id');

  if (error) return { ok: false, message: describeMemberFailure(error) };
  if (!data || data.length === 0) return { ok: false, message: REACHED_NOTHING };
  return { ok: true, value: undefined };
}

/**
 * Suspends, restores or removes a member.
 *
 * REMOVAL IS A STATUS AND NOT A DELETE, and the difference is visible to the person doing it:
 * the screen says the record of their membership stays. `is_member_of` requires
 * `status = 'active'`, so the change bites on their very next statement rather than on their
 * next sign-in, and it frees their seat at the same instant.
 */
export async function setMemberStatus(
accountId: string,
userId: string,
status: 'active' | 'suspended' | 'removed')
: Promise<TeamResult<void>> {
  const client = supabase;
  if (!client) return { ok: false, message: NOT_CONNECTED };

  const { data, error } = await client.
  from('account_members').
  update({ status }).
  eq('account_id', accountId).
  eq('user_id', userId).
  select('user_id');

  if (error) return { ok: false, message: describeMemberFailure(error) };
  if (!data || data.length === 0) return { ok: false, message: REACHED_NOTHING };
  return { ok: true, value: undefined };
}

/**
 * Withdraws an invitation that has not been accepted.
 *
 * A direct PATCH rather than an RPC, because `revoked_at` is the only column `authenticated`
 * holds UPDATE on. It returns the reserved seat immediately, because the seat count is derived
 * from the invite rows rather than stored in a counter that could drift.
 */
export async function revokeInvite(inviteId: string): Promise<TeamResult<void>> {
  const client = supabase;
  if (!client) return { ok: false, message: NOT_CONNECTED };

  const { data, error } = await client.
  from('account_invites').
  update({ revoked_at: new Date().toISOString() }).
  eq('id', inviteId).
  select('id');

  if (error) return { ok: false, message: describeMemberFailure(error) };
  if (!data || data.length === 0) {
    return {
      ok: false,
      message:
      'Nothing changed. That invitation is not one this account lets you withdraw, so the change did not reach it.'
    };
  }
  return { ok: true, value: undefined };
}

/* ------------------------------------------------------------- invitations */

/** The www route that mints and emails an invitation. See the header. */
export const INVITE_ENDPOINT = '/api/account/invite';

export type InviteFailure =
'not_connected' |
'no_session' |
'not_deployed' |
'refused' |
'seat_limit' |
'failed';

export type SendInviteResult =
{ok: true;} |
{ok: false;reason: InviteFailure;message: string;};

const INVITE_NOT_DEPLOYED =
'Invitations cannot be sent from here yet. The account is ready for a second person and the database will let them in, but the part that sends the email is not switched on. Email hello@batchlabel.xyz and we will set it up with you.';

const INVITE_NO_SESSION =
'Your sign-in has expired. Refresh the page to sign in again and nothing will be lost.';

const INVITE_SEAT_LIMIT =
'This account is using all of its editor seats, so that invitation was not sent. Read-only seats are free and unlimited on every plan, so you can still invite somebody who only needs to look. To add another editor, move somebody to read only or change the plan on the billing page.';

const INVITE_FAILED =
'We could not send that invitation just now. Nothing has been sent, so please try again in a moment.';

async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Invites somebody by email.
 *
 * THE APP SENDS THE ACCOUNT AND NEVER THE ACTOR. The server takes who is asking from the
 * verified bearer token and from nowhere else, exactly as the billing endpoints do, so an edited
 * request body cannot invite somebody into a stranger's account. The RPC underneath re-resolves
 * the actor's rank itself, because SECURITY DEFINER bypasses row level security and the fact
 * that the call arrived proves nothing about who may make it.
 *
 * NO ANSWER HERE DEPENDS ON WHETHER THE ADDRESS BELONGS TO A REGISTERED USER. There is one email
 * and one link, and `create_account_invite` never reads `auth.users`, so there is no lookup to
 * time and no branch to compare. Whether the address is a real person is established when they
 * accept, against their own verified email.
 */
export async function sendInvite(input: {
  accountId: string;
  email: string;
  role: string;
}): Promise<SendInviteResult> {
  if (!supabase) return { ok: false, reason: 'not_connected', message: NOT_CONNECTED };

  const token = await accessToken();
  if (!token) return { ok: false, reason: 'no_session', message: INVITE_NO_SESSION };

  let response: Response;
  try {
    response = await fetch(`${MARKETING_URL}${INVITE_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        account_id: input.accountId,
        email: input.email.trim(),
        role: input.role
      })
    });
  } catch {
    // A network failure, or a CORS block because this origin is not on the marketing repo's
    // allow-list. The second is invisible in server logs and is the likeliest cause on a
    // preview deployment, which is why the endpoint being absent gets its own branch below
    // rather than being lumped in with everything unreachable.
    return { ok: false, reason: 'failed', message: INVITE_FAILED };
  }

  if (response.status === 404 || response.status === 501) {
    return { ok: false, reason: 'not_deployed', message: INVITE_NOT_DEPLOYED };
  }

  const payload = (await response.json().catch(() => null)) as
  {error?: unknown;hint?: unknown;} |
  null;

  if (!response.ok) {
    // The seat ceiling is raised at COMMIT by a deferred constraint trigger, with
    // `hint = 'seat_limit_reached'`. Match the hint and never the sentence: the sentence is
    // customer-facing copy in a migration and it will be rewritten.
    if (payload?.hint === 'seat_limit_reached') {
      return { ok: false, reason: 'seat_limit', message: INVITE_SEAT_LIMIT };
    }
    if (response.status === 401) {
      return { ok: false, reason: 'no_session', message: INVITE_NO_SESSION };
    }
    const message =
    typeof payload?.error === 'string' && payload.error.trim() ? payload.error : INVITE_FAILED;
    return {
      ok: false,
      reason: response.status === 403 ? 'refused' : 'failed',
      message
    };
  }

  return { ok: true };
}

/* -------------------------------------------------------------- accepting */

/**
 * The five outcomes `public.accept_account_invite` can return, and one for a read that failed.
 *
 * `invalid` collapses unknown, revoked and already-accepted, because telling the holder of a
 * token which of those it was would tell them they had been removed, or that somebody else used
 * their link. `expired` is deliberately NOT collapsed into it: to reach that branch you must
 * already hold a real token, which you got from the email, so it discloses nothing to a prober
 * while being the difference between a useful message and a dead end.
 */
export type AcceptOutcome =
'accepted' |
'invalid' |
'expired' |
'wrong_recipient' |
'no_seat' |
'failed';

export interface AcceptResult {
  outcome: AcceptOutcome;
  accountId: string | null;
  role: string | null;
}

export async function acceptInvite(token: string): Promise<AcceptResult> {
  const client = supabase;
  if (!client) return { outcome: 'failed', accountId: null, role: null };

  const { data, error } = await client.rpc('accept_account_invite', { p_token: token });

  if (error) return { outcome: 'failed', accountId: null, role: null };

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const row = (rows[0] ?? {}) as Record<string, unknown>;
  const outcome = text(row.outcome);

  if (
  outcome === 'accepted' ||
  outcome === 'invalid' ||
  outcome === 'expired' ||
  outcome === 'wrong_recipient' ||
  outcome === 'no_seat')
  {
    return {
      outcome,
      accountId: text(row.joined_account_id),
      role: text(row.joined_role)
    };
  }
  // An outcome word this app has never heard of is NOT reported as accepted. The screen would
  // then send somebody into an account they are not in, and every request afterwards would be
  // refused with no explanation.
  return { outcome: 'failed', accountId: null, role: null };
}

/* ------------------------------------------------------------ error voice */

type Postgrestish = {code?: string | null;hint?: string | null;message?: string | null;};

const SEAT_LIMIT_HINT = 'seat_limit_reached';
const OWNER_FLOOR_HINT = 'owner_floor';
const OWNER_MISMATCH_HINT = 'owner_mismatch';
const POLICY_REFUSAL = '42501';
const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

/**
 * A refusal from the membership table, said out loud.
 *
 * MATCH THE HINT, NEVER THE SENTENCE. The database's own message is customer-facing copy living
 * in a migration and it will be rewritten; the hint is the stable token the migration promises.
 * The three that arrive here are worth their own sentences because each one has a different next
 * step, and "that was refused" would send all three to support.
 */
export function describeMemberFailure(error: Postgrestish | null): string {
  const hint = error?.hint ?? '';
  const code = error?.code ?? '';

  if (hint === SEAT_LIMIT_HINT) return INVITE_SEAT_LIMIT;

  if (hint === OWNER_FLOOR_HINT) {
    return 'An account always has an owner, so this one cannot be left without one. If you want somebody else to own it, get in touch at hello@batchlabel.xyz: the subscription has to move with it, so we do that by hand.';
  }
  if (hint === OWNER_MISMATCH_HINT) {
    return 'The owner of this account and the person it is billed to have to be the same, so that change was refused. Get in touch and we will sort it out.';
  }
  if (code === UNIQUE_VIOLATION) {
    return 'An account can only have one owner, so that change was refused. If you want somebody else to own this account, get in touch at hello@batchlabel.xyz.';
  }
  if (code === FOREIGN_KEY_VIOLATION) {
    return 'That is not a role this account recognises, so nothing has changed.';
  }
  if (code === POLICY_REFUSAL) {
    return 'That was refused, so nothing has changed. Waiting will not clear it and trying again will not either. Get in touch and we will tell you why and put it right.';
  }
  return WRITE_FAILED;
}
