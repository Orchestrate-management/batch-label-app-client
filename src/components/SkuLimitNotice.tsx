import { Link } from 'react-router-dom';
import { Callout } from './ui/Primitives';
import { useEntitlement } from '../lib/entitlement';
import { allowanceLabel, mayModify } from '../lib/membership';
import { metaInitiateCheckout } from '../lib/meta-pixel';

/**
 * What to say to a maker whose account already holds as many products as their plan allows.
 *
 * THIS IS THE SKU METER'S FACE, and it is deliberately not PlanNotice. PlanNotice answers
 * "may they use this at all" — free, lapsed, suspended, unreadable. This answers "how many
 * may they have", and the two must never be conflated: an account at its SKU limit is
 * `active = true` AND at its limit. That is two facts, and telling somebody who is paying
 * £35 a month that "this is part of a paid plan" because they hit an allowance would be
 * wrong, and insultingly so.
 *
 * WHERE THE NUMBER COMES FROM. `allowanceLabel(entitlement)`, which reads `sku_limit` and
 * `sku_unlimited` off the entitlements view. Not from a constant here, not from a plan table
 * in the bundle, and above all not from the Postgres error — the trigger that refuses the
 * insert says in its own comment that its sentence is customer-facing copy that will be
 * rewritten, and to match its `hint` instead. So the app matches the hint and writes the
 * sentence, from the one number the database resolved.
 *
 * IT FAILS OPEN, AND THAT IS NOT A BUG TO TIDY UP. `mayModify` is true whenever `can_modify`
 * is null — an account whose allowance could not be resolved, a user mid-signup, a read that
 * failed. The database does the same thing at the trigger, on purpose: "a missing allowance
 * must never become a lockout". So this notice stays silent when we do not know, and the
 * insert is allowed to go and find out. The only thing a wrong guess costs then is one
 * refused write with an honest message; the other way round it costs a paying customer their
 * own product.
 */

/**
 * `refused` is for after the fact: the write came back with the meter's hint, so this account
 * is at its limit however the entitlement read it. It is a separate input rather than a
 * re-read because the two can legitimately disagree for a moment — `can_modify` is computed
 * when the entitlement is read, and a product created in another tab since then moves the
 * count without moving anything on this screen.
 */
export function SkuLimitNotice({
  refused = false,
  className



}: {refused?: boolean;className?: string;}) {
  const entitlement = useEntitlement();

  // Nothing to say until the read resolves, unless a write has already been refused — in
  // which case the fact is established and does not depend on the read at all.
  if (!refused && entitlement.loading) return null;
  if (!refused && mayModify(entitlement)) return null;

  const allowance = allowanceLabel(entitlement);
  const knowsAllowance = entitlement.skuLimit !== null && !entitlement.skuUnlimited;

  return (
    <Callout
      tone="info"
      role={refused ? 'alert' : undefined}
      title="This account is at its product allowance"
      className={className}>

      <p className="max-w-prose leading-relaxed">
        {knowsAllowance ?
        `Your plan allowance is ${allowance}, and this account is holding that many now. ` :
        'This account is holding as many products as its plan allows. '}
        Nothing has been locked: every product you already have stays fully editable,
        printable and exportable, whatever plan you are on. A larger plan raises how many you
        can hold at once.
      </p>
      {/* `plan-gate` rather than a new surface value. This IS a plan gate — a control that
          names an allowance and offers a plan — and the union in lib/meta-pixel.ts is a
          contract with events already sitting in the Meta dataset. Splitting the SKU gate out
          would be a reporting nicety bought with a change to a live tracking type. */}
      <Link
        to="/billing"
        onClick={() => metaInitiateCheckout('plan-gate')}
        className="mt-3 inline-flex h-9 items-center gap-2 rounded-control bg-teal px-3 text-[0.8125rem] font-medium text-white transition-colors hover:bg-teal-hover">

        See plans
      </Link>
    </Callout>);

}
