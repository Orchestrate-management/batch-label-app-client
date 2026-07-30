import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Card, Field, Input, Select } from './ui/Primitives';
import { CATEGORIES, categoryById, createProduct } from '../lib/products';
import { regimeById } from '../lib/regimes';
import { CategoryId } from '../lib/model';
import { ingredientById } from '../lib/catalog';
import { useWorkspace } from '../lib/workspace';

/**
 * Three fields, because everything else belongs in the pipeline. Category is
 * the only irreversible choice: it fixes the shape of the composition, the
 * regimes that attach and the outputs that follow.
 */
export function NewProductDialog({
  onClose,
  fragranceId



}: {onClose: () => void;fragranceId?: string;}) {
  const navigate = useNavigate();
  const { enabledCategories } = useWorkspace();
  const categories = CATEGORIES.filter((category) => enabledCategories.includes(category.id));
  const startingMaterial = fragranceId ? ingredientById(fragranceId) : undefined;

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<CategoryId>(categories[0]?.id ?? 'home-fragrance');
  const category = categoryById(categoryId);
  const [productType, setProductType] = useState(category.productTypes[0]);

  const changeCategory = (next: CategoryId) => {
    setCategoryId(next);
    setProductType(categoryById(next).productTypes[0]);
  };

  const sku = name ?
  `${name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'NEW'}-${String(Date.now()).slice(-4)}` :
  '';

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    const product = createProduct({
      name: name.trim(),
      sku,
      categoryId,
      productType,
      fragranceId: category.specKind === 'mixture' ? fragranceId : undefined
    });
    toast('Product created', {
      description: `${product.name} is at the start of its pipeline. Add materials to begin.`
    });
    onClose();
    navigate(`/products/${product.id}`);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/20 px-6"
      role="dialog"
      aria-modal="true"
      aria-label="New product">
      
      <Card className="w-full max-w-lg px-6 py-6">
        <h2 className="font-display text-lg font-medium text-ink">New product</h2>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-secondary">
          {startingMaterial ?
          `Starting from ${startingMaterial.name}. Everything else is filled in as you work through the pipeline.` :
          'Just enough to begin. The composition, market and outputs are filled in as you work through the pipeline.'}
        </p>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <Field label="Name" hint={sku ? `Product code ${sku}` : 'Used on the label and in every record'}>
            <Input
              autoFocus
              value={name}
              placeholder="Black Fig and Cassis"
              onChange={(event) => setName(event.target.value)} />
            
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

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!name.trim()}>
              Create product
            </Button>
          </div>
        </form>
      </Card>
    </div>);

}