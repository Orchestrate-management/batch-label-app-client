import { SupplierAddress } from './model';

/**
 * The printed supplier identity — WHICH IS NOW A ROW IN A TABLE, AND SAYS SO WHEN IT IS NOT.
 *
 * WHAT THIS FILE USED TO BE. Six frozen placeholder strings and two placeholder address
 * blocks, with a header explaining at length that there was nowhere to store any of it. That
 * was true and it is not any more: `batchlabel.business_identity` (one row per account, only
 * `registered_name` NOT NULL) and `batchlabel.supplier_addresses` (one row per market, lines
 * constrained to 3–6 non-blank entries) both exist and both are writable by the browser under
 * `is_member_of(account_id)`.
 *
 * WHY IT IS STILL A MODULE-LEVEL HOLDER AND NOT A HOOK. Five screens print this — the label
 * renderer in six places, the safety data sheet's sections 1 and 15, the specification screen,
 * the artefact designer — and they read it synchronously, from functions and from render
 * bodies alike. Threading a context through all of them is the right shape eventually; doing
 * it today means editing four files that three other people are editing this evening. So the
 * holder stays, `SettingsProvider` fills it from the database, and every consumer keeps the
 * import it already had.
 *
 * The one thing that arrangement must not do is go stale silently. `setPrintedIdentity` is
 * called only from the provider, and the provider sets React state in the same tick — so the
 * tree re-renders and every reader below it picks up the new values. It is also called with
 * `null` on sign-out and on an account change, because the alternative is one maker's
 * registered address rendered under the next maker's product name.
 *
 * WHAT AN UNSET FIELD PRINTS, AND WHY IT IS BRACKETED. A bracketed placeholder is the
 * printer's convention for a field nobody has filled in, and it is the truth: this account has
 * not told us. It renders at roughly the right length, so the geometry checks in the designer
 * still mean something, and no maker can mistake it for a setting they once entered. What it
 * must never be is a plausible invented business — an earlier version of this file printed
 * "Hearth and Hollow Ltd" of Lewes onto the label preview and into section 15 of the safety
 * data sheet of every signed-in customer, which is a legal statement about who supplied a
 * product, made about a company that does not exist.
 */

export interface PrintedBusiness {
  /** The only field the table requires. Everything else is genuinely optional. */
  registeredName: string;
  tradingName: string | null;
  telephone: string | null;
  email: string | null;
  website: string | null;
  vatNumber: string | null;
}

export type PrintedMarket = 'GB' | 'EU' | 'NI';

export interface PrintedAddress {
  market: PrintedMarket;
  lines: string[];
}

const UNSET = {
  name: '[Your registered business name]',
  tradingName: '[Your business name]',
  phone: '[Your telephone number]',
  email: '[Your email address]',
  website: '[your-website]',
  vatNumber: '[Your VAT number]'
};

/**
 * What each market's block MEANS, which is not a preference and is not editable.
 *
 * The GB block is the supplier and manufacturer; the EU block is the economic operator under
 * GPSR. A maker fills in the lines; they do not get to relabel what the block is for, because
 * the label and the role are what decide which block a product prints, and a renamed block
 * would print in the wrong place.
 */
export const ADDRESS_BLOCKS: Record<
  PrintedMarket,
  {label: string;role: string;isDefault: boolean;}> =
{
  GB: { label: 'Great Britain', role: 'Supplier and manufacturer', isDefault: true },
  EU: {
    label: 'European Union and Northern Ireland',
    role: 'Responsible person and economic operator',
    isDefault: false
  },
  NI: { label: 'Northern Ireland', role: 'Responsible person', isDefault: false }
};

/**
 * The lines shown when an account has stored no block for a market.
 *
 * Four each, and the count matters: the renderer indexes into this array (`lines[0]`,
 * `lines[length - 2]`) to lay out a compressed address on a small surface, so a block of one
 * line would print a name where a postcode belongs.
 */
const PLACEHOLDER_LINES: Record<PrintedMarket, string[]> = {
  GB: [UNSET.name, '[Your street address]', '[Your town and postcode]', 'United Kingdom'],
  EU: [
  '[Your EU responsible person]',
  '[Responsible person for your business]',
  '[Their street address]',
  '[Their country]'],

  NI: [
  '[Your Northern Ireland responsible person]',
  '[Their street address]',
  '[Their town and postcode]',
  'Northern Ireland']
};

/** The markets that always have a block on screen, stored or not. */
const STANDING_MARKETS: PrintedMarket[] = ['GB', 'EU'];

function placeholderBlock(market: PrintedMarket): SupplierAddress {
  return {
    id: `addr-${market.toLowerCase()}`,
    market,
    label: ADDRESS_BLOCKS[market].label,
    role: ADDRESS_BLOCKS[market].role,
    lines: [...PLACEHOLDER_LINES[market]],
    isDefault: ADDRESS_BLOCKS[market].isDefault
  };
}

/** What the account has told us. Null business, empty addresses = nothing yet. */
let held: {business: PrintedBusiness | null;stored: Set<PrintedMarket>;} = {
  business: null,
  stored: new Set()
};

export const BUSINESS = {
  get name(): string {
    return held.business?.registeredName ?? UNSET.name;
  },
  /**
   * FALLS BACK TO THE REGISTERED NAME, DELIBERATELY.
   *
   * This is the name printed on the face of the label. A maker who has told us they are
   * "Acme Candles Ltd" and left the trading name blank trades under that name — printing
   * "[Your business name]" beside a registered name we are holding would be worse than
   * useless, because it is a placeholder standing in for information we have.
   */
  get tradingName(): string {
    return held.business?.tradingName ?? held.business?.registeredName ?? UNSET.tradingName;
  },
  get phone(): string {
    return held.business?.telephone ?? UNSET.phone;
  },
  get email(): string {
    return held.business?.email ?? UNSET.email;
  },
  get website(): string {
    return held.business?.website ?? UNSET.website;
  },
  /**
   * A REGULATORY reference, not a billing field, which is why it sits with the rest of the
   * printed identity: it appears in section 15 of every safety data sheet. The VAT number
   * Stripe needs for the reverse charge is a different value collected in Checkout and
   * editable in the billing portal, and the two must not be conflated — one is printed on a
   * document, the other decides what a customer is charged.
   */
  get vatNumber(): string {
    return held.business?.vatNumber ?? UNSET.vatNumber;
  }
};

/**
 * Address blocks by market, live.
 *
 * Mutated in place rather than reassigned, because `import { ADDRESSES }` is a binding and a
 * reassignment here would be invisible to anything that had already destructured it. Always
 * carries GB and EU whether stored or not, so the settings screen has something to draw and
 * the renderer has something to index.
 */
export const ADDRESSES: SupplierAddress[] = STANDING_MARKETS.map(placeholderBlock);

/**
 * Replaces what is printed. The provider calls this and nothing else does.
 *
 * `null` clears back to placeholders, which is what a sign-out and an account change both
 * mean. A market with no stored row keeps its placeholder block rather than disappearing:
 * an address block that vanishes reads as "not needed", and the EU block being absent from a
 * screen is not the same statement as its lines being unfilled.
 */
export function setPrintedIdentity(
next: {business: PrintedBusiness | null;addresses: PrintedAddress[];} | null)
: void {
  const business = next?.business ?? null;
  const supplied = new Map<PrintedMarket, string[]>();
  for (const address of next?.addresses ?? []) {
    if (address.lines.length > 0) supplied.set(address.market, [...address.lines]);
  }

  held = { business, stored: new Set(supplied.keys()) };

  const markets: PrintedMarket[] = [...STANDING_MARKETS];
  for (const market of supplied.keys()) {
    if (!markets.includes(market)) markets.push(market);
  }

  const blocks = markets.map((market) => {
    const block = placeholderBlock(market);
    const lines = supplied.get(market);
    return lines ? { ...block, lines } : block;
  });

  ADDRESSES.splice(0, ADDRESSES.length, ...blocks);
}

/** True when this account has told us its registered name. */
export function hasPrintedIdentity(): boolean {
  return held.business !== null;
}

/** True when a stored address block exists for this market. */
export function hasPrintedAddress(market: PrintedMarket): boolean {
  return held.stored.has(market);
}

export type PrintedGap = 'name' | 'address' | 'telephone';

/**
 * WHICH OF THE THREE PRINTED FIELDS WE DO NOT HOLD. A fact about our data, not a verdict.
 *
 * CLP Article 17 requires a label to carry the supplier's name, address and telephone number.
 * This checks that we are holding a value for each of the three and nothing else — it does not
 * inspect the value, it does not know whether the address is real, and it is not a statement
 * that a label with none of these gaps is compliant. Every screen that renders it says so.
 */
export function printedIdentityGaps(market: PrintedMarket = 'GB'): PrintedGap[] {
  const gaps: PrintedGap[] = [];
  if (!held.business) gaps.push('name');
  if (!hasPrintedAddress(market)) gaps.push('address');
  if (!held.business?.telephone) gaps.push('telephone');
  return gaps;
}

/**
 * The competent person who reviews a safety data sheet before it is issued.
 *
 * STILL A PLACEHOLDER, and still for the reason it always was: `competent_persons` was named
 * as deferred when the domain schema was built and no table was created. Naming a reviewer —
 * a real one, or a plausible invented one — beside a count of sheets signed tells a maker a
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

export function addressForMarket(market: 'GB' | 'EU'): SupplierAddress {
  return ADDRESSES.find((a) => a.market === market) ?? ADDRESSES[0];
}
