import React from 'react';
import { Logo } from './Logo';
import { Button, Card, Pill } from './ui/Primitives';
import { useActiveAccount } from '../lib/active-account';
import { roleLabel } from '../lib/permissions';

/**
 * WHICH WORKSPACE, ASKED ONCE, WHEN THERE IS GENUINELY MORE THAN ONE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE APP ASKS INSTEAD OF PICKING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `public.current_account_id()` returns an account only for somebody holding exactly one active
 * membership, and NULL for anybody holding two. Its own comment says the function will not be
 * taught to disambiguate, and it is right: the database cannot know which of a person's two
 * businesses a product belongs to, and a guess files a maker's SKU in the wrong company's
 * workspace with no error anywhere. Fourteen tables carry a BEFORE INSERT trigger that turns
 * that null into P0001 with `hint = 'account_ambiguous'` and a sentence saying, in those words,
 * that choosing the account is the app's job.
 *
 * This screen is the app doing that job. It is the only thing standing between a two-account
 * person and a write that either fails loudly or lands in the wrong place.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT REPLACES THE APP RATHER THAN SITTING IN THE SIDEBAR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every account-scoped read in this app is scoped to one account id, and every screen states
 * facts about "this account": how many products it holds, what prints on its labels, what is
 * outstanding. Rendering any of that before the question is answered means rendering it for an
 * account nobody chose. So nothing renders until it is answered, and after that the choice is
 * remembered and this screen is never seen again.
 *
 * IT IS NOT REACHED BY ANYBODY TODAY. Every customer holds exactly one account, and a single
 * account is selected with no UI at all. This exists so that the first person invited into a
 * second workspace does not discover the gap by having their work filed somewhere else.
 */
export function AccountChooser() {
  const { accounts, select } = useActiveAccount();

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-paper px-6 py-12">
      <div className="w-full max-w-lg">
        <Logo size={34} />
        <h1 className="mt-6 font-display text-xl font-semibold text-ink">
          Which workspace are you working in?
        </h1>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-secondary">
          You are a member of more than one. Everything you create belongs to the one you pick,
          so we will not choose for you. You can change it later in Settings, and this browser
          will remember it.
        </p>

        <Card className="mt-6 divide-y divide-paper-line">
          {accounts.map((account) =>
          <button
            key={account.accountId}
            type="button"
            onClick={() => select(account.accountId)}
            className="flex w-full flex-wrap items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-paper-panel">

              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">
                  {account.accountName ?? 'Unnamed workspace'}
                </span>
                <span className="block text-2xs text-ink-tertiary">
                  {account.brand ?? 'Batchlabel'}
                </span>
              </span>
              <Pill tone={account.isOwner ? 'good' : 'neutral'}>
                {account.roleLabel ?? roleLabel(account.role)}
              </Pill>
            </button>
          )}
        </Card>
      </div>
    </div>);

}

/**
 * The one state that stops the app: more than one account and none chosen.
 *
 * Everything else falls through deliberately.
 *
 *   loading     the shell and the skeletons are better than a second splash on top of the one
 *               RequireAuth already drew.
 *   none        signup did not finish. Every screen already says that, in its own words, with
 *               the next step attached. A gate here would replace six specific sentences with
 *               one general one.
 *   error       we could not read the list. The screens say "we could not check" and offer a
 *               retry; blocking the whole app on a read that blipped would be the expensive
 *               direction to be wrong in.
 *   legacy      a database that predates public.my_accounts(). One account, from the view,
 *               exactly as before.
 */
export function AccountGate({ children }: {children: React.ReactNode;}) {
  const { status } = useActiveAccount();
  if (status === 'choose') return <AccountChooser />;
  return <>{children}</>;
}

/**
 * The switcher, for a person who is in more than one account and has already chosen.
 *
 * Rendered on the team tab rather than in the sidebar, because it is a rare act for a rare
 * person and a permanent control in the navigation would be a permanent question for the
 * hundreds of people who only ever have one. Returns null for anybody holding a single account,
 * which is everybody today.
 */
export function AccountSwitcher() {
  const { accounts, accountId, select } = useActiveAccount();
  if (accounts.length < 2) return null;

  return (
    <Card className="divide-y divide-paper-line">
      {accounts.map((account) => {
        const current = account.accountId === accountId;
        return (
          <div key={account.accountId} className="flex flex-wrap items-center gap-3 px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">
                {account.accountName ?? 'Unnamed workspace'}
              </p>
              <p className="text-2xs text-ink-tertiary">
                {account.roleLabel ?? roleLabel(account.role)}
                {account.brand ? ` · ${account.brand}` : ''}
              </p>
            </div>
            {current ?
            <Pill tone="good">You are in this one</Pill> :

            <Button
              size="sm"
              variant="secondary"
              onClick={() => select(account.accountId)}>

                Work in this one
              </Button>
            }
          </div>);

      })}
    </Card>);

}
