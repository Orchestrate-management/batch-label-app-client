import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Field, FormError, Input, Select } from './ui/Primitives';
import { PlanNotice } from './PlanNotice';
import { SkuLimitNotice } from './SkuLimitNotice';
import { CATEGORIES, categoryById } from '../lib/categories';
import { useCan } from '../lib/active-account';
import { useEntitlement } from '../lib/entitlement';
import { createProduct, type WriteFailure } from '../lib/products';
import { useProducts } from '../lib/product-store';
import { regimeById } from '../lib/regimes';
import { CategoryId } from '../lib/model';
import { ingredientById } from '../lib/material-index';

/**
 * Three fields, because everything else belongs in the pipeline.
 *
 * There USED TO BE A FOURTH, and it was a category picker. Home fragrance is the only category,
 * so the control offered one option, could not be set to anything else, and made the choice it
 * claimed to be asking about. The category still fixes the shape of the composition, the regimes
 * that attach and the outputs that follow — it is just not a question any more.
 *
 * IT NOW ACTUALLY CREATES SOMETHING. This dialog used to push onto an in-memory array and
 * raise a toast saying "Product created", which was true until the tab was reloaded. It
 * writes two rows — a specification and the product that is one pack of it — and does not
 * close, does not navigate and does not congratulate anybody until the database has said yes.
 *
 * THE ACCOUNT IT LANDS IN IS NOT TYPED INTO THIS FORM. It comes from the entitlement, which
 * the database resolved for the signed-in user and this deployment's brand; where that has not
 * resolved one, the column is omitted and the database's own default decides. Either way the
 * INSERT policy refuses an account the caller is not a member of, so no field on this screen
 * can move a product into somebody else's workspace. See lib/products.ts, rule 2.
 *
 * THE PRODUCT CODE IS EDITABLE, which it was not before. It used to be generated from the
 * name and the clock — `BLA-4821` — and shown as an un-editable hint, so a maker was given a
 * code they never chose and could not change. It is also the one field that can be REFUSED:
 * codes are unique per account across live products, so a duplicate has to be fixable in the
 * form that caused it.
 *
 * A SUSPENDED ACCOUNT NEVER SEES THE FORM. Its insert is refused by the policy with a bare
 * 42501 — the migration will not say why, and is right not to (section 3) — so a form here
 * would collect four fields in order to fail on all of them, every time, with a message that
 * cannot name the cause. The cause is already in hand: `entitlement.status === 'suspended'`,
 * from a read taken before anything rendered, so the dialog says that instead. The screens
 * that open it hide their create buttons on the same fact; this is the backstop for a
 * suspension that lands between their render and this one.
 *
 * AN UNFINISHED SIGNUP DOES SEE THE FORM, AND THAT IS DELIBERATE. The create surfaces now hide
 * their button for `no_membership` too (`createIsCertainToFail`, lib/membership.ts), so the
 * only way to reach this dialog in that state is the same narrow race. It gets no early return
 * of its own because, unlike suspension, the write path can already name the cause exactly:
 * `createProduct` answers `no_account` with NO_ACCOUNT_MESSAGE, which says the signup was not
 * finished, says nothing was saved, and points at the step that fixes it. A second copy of
 * that sentence here would be a second place for it to drift.
 */
export function NewProductDialog({
  onClose,
  fragranceId



}: {onClose: () => void;fragranceId?: string;}) {
  const navigate = useNavigate();
  const { reload } = useProducts();
  const entitlement = useEntitlement();
  const startingMaterial = fragranceId ? ingredientById(fragranceId) : undefined;

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [categoryId] = useState<CategoryId>(CATEGORIES[0].id);
  const category = categoryById(categoryId);
  const [productType, setProductType] = useState(category.productTypes[0]);

  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{reason: WriteFailure;message: string;} | null>(null);

  // Only `suspended`. Free, lapsed and past_due all create products — the SKU allowance is the
  // only thing a plan governs here, and SkuLimitNotice below is what states it.
  const suspended = !entitlement.loading && entitlement.status === 'suspended';
  // AND THE ROLE, WHICH IS A DIFFERENT QUESTION FROM THE PLAN. Every surface that opens this
  // dialog already hides its button for a viewer; this is the backstop for the one that does
  // not, and for a role that changed while the dialog was open.
  const { can, reason } = useCan();
  const mayWrite = can('write_data');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setFailure(null);

    const result = await createProduct(
      {
        name: name.trim(),
        sku: sku.trim(),
        categoryId,
        productType,
        fragranceId
      },
      entitlement.accountId
    );

    if (!result.ok) {
      // The dialog stays open, holding everything typed into it. A form that closes on
      // failure makes the maker type it all again to find out whether it works the second
      // time, and a limit message shown over a screen with no form on it explains nothing.
      setSaving(false);
      setFailure({ reason: result.reason, message: result.message });
      return;
    }

    /**
     * THE ACCOUNT'S SKU COUNT JUST CHANGED, AND ONLY THE DATABASE KNOWS THE NEW ONE.
     *
     * `entitlements.sku_count` was read once when the provider mounted and, until this line,
     * was re-read by exactly one caller in the whole app — the return from Stripe Checkout.
     * So a maker who created their first product was then told "0 products · 3 things
     * outstanding across 1 product" on Studio and "every output on all 0 products this
     * account holds" on Settings, both from a count taken before the row existed. Billing's
     * meter and its progress bar were a create behind for the rest of the session too.
     *
     * The fix is deliberately not "count the list instead". That is the fallback Billing
     * removed on purpose: `fetchProducts` drops a product whose specification did not come
     * back, so the client's length and the meter's count can differ by exactly the amount
     * that makes a screen say "2 of 3" while the next insert is refused for holding 3.
     *
     * IT SAYS WHAT HAPPENED, NOT WHAT TO DO ABOUT IT. `noteSkuCountChanged` rather than a bare
     * `refresh`, because the fact this dialog holds is "the count moved", and a re-read on its
     * own leaves every screen free to keep stating the pre-create number for the round trip it
     * takes to answer. The provider marks the held count stale and re-reads; the screens then
     * have a state to render instead of a number they would have had to guess was old.
     *
     * IT IS FIRED HERE AND NOT INSIDE `reload`. The store's reload is also what a saved
     * composition calls, and a composition changes no count — refreshing the entitlement
     * there would be a round trip per save for a number that cannot have moved. A create is
     * the only write in this app that moves it.
     *
     * Not awaited, and before the list read rather than after it: the two are independent
     * reads, this one blocks nothing on screen, and the provider revalidates in the
     * background without blanking anything (see lib/entitlement.tsx).
     */
    entitlement.noteSkuCountChanged();

    // Land the list before leaving, so the product screen finds the product it is about to
    // render rather than racing a background refresh into a "no such product" state.
    await reload();
    onClose();
    navigate(`/products/${result.value.id}`);
  };

  // SAID BEFORE ANYTHING IS TYPED, and as an early return rather than a disabled button, because
  // there is nothing on this form for somebody who cannot create a product. The suspended branch
  // below is the same shape for the same reason.
  if (!mayWrite) {
    return (
      <Dialog>
        <h2 className="font-display text-lg font-medium text-ink">New product</h2>
        <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-secondary">
          {reason('write_data')}
        </p>
        <div className="flex justify-end pt-4">
          <Button type="button" variant="quiet" onClick={onClose}>
            Close
          </Button>
        </div>
      </Dialog>);

  }

  if (suspended) {
    return (
      <Dialog>
        <h2 className="font-display text-lg font-medium text-ink">New product</h2>
        <PlanNotice states={['suspended']} className="mt-4" />
        <div className="flex justify-end pt-4">
          <Button type="button" variant="quiet" onClick={onClose}>
            Close
          </Button>
        </div>
      </Dialog>);

  }

  return (
    <Dialog>
        <h2 className="font-display text-lg font-medium text-ink">New product</h2>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-secondary">
          {startingMaterial ?
          `Starting from ${startingMaterial.name}. Everything else is filled in as you work through the pipeline.` :
          'Just enough to begin. The composition, market and outputs are filled in as you work through the pipeline.'}
        </p>

        {/* Before anything is typed, so nobody fills a form in to be told at the end that
            their plan is full. Silent when the allowance is unknown — see SkuLimitNotice. */}
        <SkuLimitNotice className="mt-4" />

        <form onSubmit={submit} className="mt-5 space-y-4">
          <Field label="Name" hint="Used on the label and in every record">
            <Input
              autoFocus
              value={name}
              placeholder="Black Fig and Cassis"
              onChange={(event) => setName(event.target.value)} />

          </Field>

          <Field
            label="Product code"
            hint="Yours to choose, and unique across the products you sell. You can leave it empty and add it later.">

            <Input
              className="tabular"
              value={sku}
              placeholder="CC-BFC-220"
              aria-invalid={failure?.reason === 'duplicate_sku' || undefined}
              onChange={(event) => setSku(event.target.value)} />

          </Field>

          <Field label="Product type">
            <Select value={productType} onChange={(event) => setProductType(event.target.value)}>
              {category.productTypes.map((option) =>
              <option key={option} value={option}>
                  {option}
                </option>
              )}
            </Select>
          </Field>

          {/* WHAT THIS SENTENCE USED TO PROMISE. "…and will produce N outputs", where N was
              `category.artefacts.length + 1` from a shipped constant. Nothing produces an
              output: both export controls on the designer are stubs that say so when pressed,
              and no file is written anywhere in this application. A maker read this before
              typing anything and reasonably concluded that creating the product would result in
              N things they could send to a printer.

              The regimes half is true and stays — those are the rules that attach to this
              category, and they decide the shape of everything downstream. The outputs half now
              says what actually happens: previews, drawn at actual size, from the composition. */}
          <p className="rounded-control border border-paper-line bg-paper-panel/60 px-4 py-3 text-2xs leading-relaxed text-ink-tertiary">
            This product will be subject to{' '}
            {category.regimes.map((regime) => regimeById(regime).short).join(', ')}. Batchlabel
            will draw{' '}
            {category.artefacts.length + 1} previews for it at actual size —{' '}
            {category.artefacts.length}{' '}
            {category.artefacts.length === 1 ? 'label surface' : 'label surfaces'} and a draft
            safety data sheet. Producing a print-ready file is not built yet.
          </p>

          {/* Said here rather than discovered on the composition screen. The four fields above
              are the whole form, and a maker who assumes the rest is filled in for them will
              print a label carrying a base wax and a net quantity nobody chose — which is
              exactly what this dialog used to do. */}
          <p className="text-2xs leading-relaxed text-ink-tertiary">
            Nothing else is filled in for you. The composition starts empty — no base, no
            packaging, no net quantity — because those are facts about your product that this app
            cannot guess, and every one of them ends up on the label.
          </p>

          {/* The meter refused it. The allowance, not the Postgres sentence: the trigger's own
              comment says to match its hint and never its message. */}
          {failure?.reason === 'sku_limit' && <SkuLimitNotice refused />}

          {failure && failure.reason !== 'sku_limit' &&
          <FormError>{failure.message}</FormError>
          }

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="quiet" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!name.trim() || saving}>
              {saving ? 'Creating…' : 'Create product'}
            </Button>
          </div>
        </form>
    </Dialog>);

}

/**
 * The modal chrome, shared by the form and by the suspension notice that replaces it.
 *
 * Extracted so the suspended branch can be an early return rather than a pair of fragments
 * wrapped around the form — the form is long, and threading a condition through it to hide it
 * is how a field ends up rendered on a screen that is not showing a form.
 */
function Dialog({ children }: {children: React.ReactNode;}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/20 px-6"
      role="dialog"
      aria-modal="true"
      aria-label="New product">

      <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto px-6 py-6">{children}</Card>
    </div>);

}
