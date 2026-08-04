import { RefreshCwIcon } from 'lucide-react';
import { Button, Callout } from './ui/Primitives';
import { useEntitlement } from '../lib/entitlement';

/**
 * What to say on a screen that has no account to read from.
 *
 * WHY THIS IS A COMPONENT AND NOT THREE COPIES. The products store publishes `no-account`,
 * and it is reached by three different causes that need three different sentences (see
 * ProductsStatus in lib/product-store.tsx). The copy lived inline on the products screen and
 * nowhere else, so every other screen a maker can reach in that state answered it with
 * whatever its own fall-through happened to be — a blank work queue on Studio, and "there is
 * nothing in your products with this address, it may have been archived" on a product
 * bookmark, which is a deletion notice for a product that is very probably still there.
 *
 * THE CASE THAT PRODUCES IT MOST OFTEN IS A SIGNUP NOBODY FINISHED. A Google signup abandoned
 * at /finish-setup leaves a real, signed-in user with no account row — so the session is
 * good, RequireAuth lets them all the way in, and every screen behind it has nothing to scope
 * a read to. They must be told to go and finish, not shown a workspace that looks new.
 *
 * THE RETRY RE-READS THE ENTITLEMENT, WHICH IS THE READ THAT FAILED. It used to be the
 * products store's own `refresh`, and that button could not fix what it was offered for: the
 * store has no account id, so re-running its effect publishes `no-account` again, every time,
 * for ever. `entitlement.refresh()` re-reads the row that resolves the account, and the store
 * re-reads on its own the moment an id lands — `accountId` is in its effect's dependencies.
 * So this is the retry that can actually change the answer.
 *
 * IT IS OFFERED FOR EXACTLY ONE OF THE THREE CAUSES. A read that failed is worth asking
 * again. An unfinished signup is not — nothing about pressing a button finishes it, and a
 * retry that cannot work reads as the software being broken rather than as a step being
 * missed. Neither is an account this deployment's brand cannot single out: that is a settled
 * fact about the data, not a blip.
 */
export function NoAccountNotice({ className }: {className?: string;}) {
  const entitlement = useEntitlement();

  // The entitlement read itself did not come back. The only one of the three worth a retry.
  const unreadable = entitlement.status === 'unknown';

  return (
    <Callout
      tone="info"
      role="status"
      title="This workspace has no account behind it yet"
      className={className}>

      {/* NOT an empty state, and not an error either. Nothing failed and nothing is missing —
          we simply have no account to scope a read to, so we are showing nothing rather than
          guessing. "You have no products" here would tell somebody who may hold a full
          workspace that it is empty, which is the one sentence these screens must never get
          wrong. */}
      <p className="max-w-prose leading-relaxed">
        {entitlement.status === 'no_membership' ?
        'Your account has not finished being set up, so there is nothing to show yet. Finishing signup fixes this — a retry will not.' :
        unreadable ?
        'We could not read which account this workspace belongs to just now. This is us, not you, and nothing of yours has been lost.' :
        'We could not tell which of your accounts this workspace should be showing, so it is showing none rather than the wrong one. Nothing has been lost.'}
      </p>
      {unreadable &&
      <Button size="sm" variant="secondary" className="mt-3" onClick={entitlement.refresh}>
          <RefreshCwIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          Try again
        </Button>
      }
    </Callout>);

}
