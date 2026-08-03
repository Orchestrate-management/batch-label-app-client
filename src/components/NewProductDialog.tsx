import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Field, FormError, Input, Select } from './ui/Primitives';
import { SkuLimitNotice } from './SkuLimitNotice';
import { CATEGORIES, categoryById } from '../lib/categories';
import { useEntitlement } from '../lib/entitlement';
import { createProduct, type WriteFailure } from '../lib/products';
import { useProducts } from '../lib/product-store';
import { regimeById } from '../lib/regimes';
import { CategoryId } from '../lib/model';
import { ingredientById } from '../lib/catalog';
import { useWorkspace } from '../lib/workspace';

/**
 * Four fields, because everything else belongs in the pipeline. Category is
 * the only irreversible choice: it fixes the shape of the composition, the
 * regimes that attach and the outputs that follow.
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
 */
export function NewProductDialog({
  onClose,
  fragranceId



}: {onClose: () => void;fragranceId?: string;}) {
  const navigate = useNavigate();
  const { enabledCategories } = useWorkspace();
  const { reload } = useProducts();
  const entitlement = useEntitlement();
  const categories = CATEGORIES.filter((category) => enabledCategories.includes(category.id));
  const startingMaterial = fragranceId ? ingredientById(fragranceId) : undefined;

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [categoryId, setCategoryId] = useState<CategoryId>(categories[0]?.id ?? 'home-fragrance');
  const category = categoryById(categoryId);
  const [productType, setProductType] = useState(category.productTypes[0]);

  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{reason: WriteFailure;message: string;} | null>(null);

  const changeCategory = (next: CategoryId) => {
    setCategoryId(next);
    setProductType(categoryById(next).productTypes[0]);
  };

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
        fragranceId: category.specKind === 'mixture' ? fragranceId : undefined
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

    // Land the list before leaving, so the product screen finds the product it is about to
    // render rather than racing a background refresh into a "no such product" state.
    await reload();
    onClose();
    navigate(`/products/${result.value.id}`);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/20 px-6"
      role="dialog"
      aria-modal="true"
      aria-label="New product">

      <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto px-6 py-6">
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

          <Field
            label="Category"
            hint="Fixes the shape of the composition and the regimes that apply. It cannot be changed later.">

            <Select
              value={categoryId}
              onChange={(event) => changeCategory(event.target.value as CategoryId)}>

              {categories.map((option) =>
              <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              )}
            </Select>
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

          <p className="rounded-control border border-paper-line bg-paper-panel/60 px-4 py-3 text-2xs leading-relaxed text-ink-tertiary">
            This product will be subject to{' '}
            {category.regimes.map((regime) => regimeById(regime).short).join(', ')}, and will
            produce {category.artefacts.length + (category.specKind === 'bom' ? 0 : 1)} outputs.
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
      </Card>
    </div>);

}
