import { SupplierAddress } from './model';

/**
 * The printed supplier identity — AND AN HONEST ACCOUNT OF WHAT IT IS NOT.
 *
 * Everything in this file is a PLACEHOLDER. There is no table behind it. The account data
 * schema (supabase/migrations/20260803120000_account_data_schema.sql) creates accounts,
 * account_members, specifications and products, and deliberately nothing else; it says so in
 * its own header. So the supplier block, the market address blocks and the competent person
 * have nowhere to be stored, nothing writes them, and nothing reads them back.
 *
 * WHY THE VALUES CHANGED. They used to be Hearth and Hollow Ltd of Lewes BN7 2QA, with a
 * telephone number, a VAT number and a responsible person in Rotterdam. That is a fully
 * furnished identity for a business that does not exist, and it was printed onto the label
 * preview and into sections 1 and 15 of the safety data sheet of every signed-in customer.
 * On a screen whose entire promise is "this is what your label says", another company's
 * registered address rendered at actual size is the most dangerous fixture in the app: it
 * looks exactly like a saved setting, and section 15 of a safety data sheet is a legal
 * statement about who supplied the product.
 *
 * A bracketed placeholder is the printer's convention for a field nobody has filled in, and
 * it is the truth: this account has not told us any of this yet. It renders at the same
 * length, so the geometry checks on the designer still mean something, and no maker can
 * mistake it for a setting they once entered.
 *
 * FOR WHOEVER BUILDS THE IDENTITY TABLE. accounts.data is the jsonb the schema put there for
 * exactly this ("the flexibility knob", supabase/README.md), but `accounts` is READ ONLY to
 * the browser — every write to it is SECURITY DEFINER provisioning or the service role — so
 * an identity editor needs either a grant or an RPC before the Settings tab can save. Until
 * one exists, the Settings identity fields say so rather than claiming a save.
 */

const UNSET = {
  name: '[Your registered business name]',
  tradingName: '[Your business name]',
  phone: '[Your telephone number]',
  email: '[Your email address]',
  website: '[your-website]',
  vatNumber: '[Your VAT number]'
};

export const BUSINESS = {
  name: UNSET.name,
  tradingName: UNSET.tradingName,
  phone: UNSET.phone,
  email: UNSET.email,
  website: UNSET.website,
  /**
   * A REGULATORY reference, not a billing field, which is why it sits with the rest of the
   * printed identity: it appears in section 15 of every safety data sheet. The VAT number
   * Stripe needs for the reverse charge is a different value collected in Checkout and
   * editable in the billing portal, and the two must not be conflated — one is printed on a
   * document, the other decides what a customer is charged.
   */
  vatNumber: UNSET.vatNumber
};

/**
 * The competent person who reviews a safety data sheet before it is issued.
 *
 * Placeholder for the same reason and with the same consequence: naming a real reviewer, or
 * a plausible invented one, next to a count of "sheets signed to date" tells a maker that a
 * review happened. None has.
 */
export const COMPETENT_PERSON = {
  kind: 'external' as 'internal' | 'external',
  name: '[No reviewer named yet]',
  organisation: '[Their organisation]',
  email: '[their email address]',
  reviewed: 0,
  awaiting: 0
};

/**
 * Address blocks by market. Which block a label prints is decided by the market the product
 * is sold into, and that logic is real; the contents are not.
 *
 * Four lines each, and the count matters: the renderer indexes into this array
 * (`lines[0]`, `lines[length - 2]`) to lay out a compressed address on a small surface.
 */
export const ADDRESSES: SupplierAddress[] = [
{
  id: 'addr-gb',
  market: 'GB',
  label: 'Great Britain',
  role: 'Supplier and manufacturer',
  lines: [UNSET.name, '[Your street address]', '[Your town and postcode]', 'United Kingdom'],
  isDefault: true
},
{
  id: 'addr-eu',
  market: 'EU',
  label: 'European Union and Northern Ireland',
  role: 'Responsible person and economic operator',
  lines: [
  '[Your EU responsible person]',
  '[Responsible person for your business]',
  '[Their street address]',
  '[Their country]']

}];


export function addressForMarket(market: 'GB' | 'EU'): SupplierAddress {
  return ADDRESSES.find((a) => a.market === market) ?? ADDRESSES[0];
}
