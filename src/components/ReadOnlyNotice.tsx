import { Callout } from './ui/Primitives';
import { useCan } from '../lib/active-account';
import type { Capability } from '../lib/permissions';

/**
 * SAYS WHY THE CONTROLS ON THIS SCREEN ARE NOT THERE. Renders nothing when they are.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A NOTICE RATHER THAN JUST HIDING THE BUTTONS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A read-only screen with no explanation is a screen somebody assumes is broken. They reload
 * it, they try a different browser, and then they email support to ask why the New product
 * button has disappeared. That is the whole cost of leaving the sentence out, and it is paid by
 * the person least able to work out what happened.
 *
 * So every screen that hides a write control also says, once, at the top: what role you hold,
 * that what is here is complete rather than truncated, and who can change it. The sentence
 * comes from `permissionReason` so there is one wording per capability rather than one per
 * screen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS NOT A SECURITY CONTROL AND MUST NOT BE MISTAKEN FOR ONE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Everything this component and its siblings do is disable buttons. The refusal that matters is
 * the one in the database: thirty-seven write policies read `public.can(account_id, ...)`, and a
 * request assembled by hand is refused there whatever this app rendered. What the client half
 * buys is that a viewer is not invited to fill in a form in order to be told no.
 *
 * FAILS OPEN, like everything else keyed on a role we might not have read. `useCan` answers true
 * for an unknown role, so a blipped read shows a normal screen rather than telling an owner
 * their account has gone read-only.
 */
export function ReadOnlyNotice({
  capability,
  title



}: {capability: Capability;title?: string;}) {
  const { can, reason } = useCan();
  if (can(capability)) return null;

  const sentence = reason(capability);
  if (!sentence) return null;

  return (
    <Callout title={title ?? 'You are reading, not editing'}>
      <p className="max-w-prose leading-relaxed">{sentence}</p>
    </Callout>);

}
