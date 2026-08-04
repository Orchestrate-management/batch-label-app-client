import { beforeEach, describe, expect, it } from 'vitest';
import {
  ADDRESSES,
  BUSINESS,
  addressForMarket,
  hasPrintedAddress,
  hasPrintedIdentity,
  printedIdentityGaps,
  setPrintedIdentity } from
'./identity';

/**
 * WHAT PRINTS ON A LABEL, AND WHAT PRINTS WHEN NOBODY HAS TOLD US ANYTHING.
 *
 * This module is read synchronously by the label renderer, by sections 1 and 15 of the safety
 * data sheet, by the specification screen and by the artefact designer. Every one of them
 * imports `BUSINESS` and `addressForMarket` directly, so the two properties that matter are
 * that a save reaches them and that a sign-out does too.
 *
 * The second is the one with teeth. A holder that survived an account change would print one
 * maker's registered address under another maker's product name, on a document whose section
 * 15 is a legal statement about who supplied the product.
 */

beforeEach(() => {
  setPrintedIdentity(null);
});

describe('before an account has told us anything', () => {
  it('prints bracketed placeholders rather than blanks', () => {
    expect(BUSINESS.name).toBe('[Your registered business name]');
    expect(BUSINESS.phone).toBe('[Your telephone number]');
    expect(BUSINESS.vatNumber).toBe('[Your VAT number]');
  });

  it('keeps a block for every market, so the renderer has something to index', () => {
    // The renderer reads lines[0] and lines[length - 2] to compress an address onto a small
    // surface. A missing block is not an empty block; it is a crash or a name where a
    // postcode belongs.
    expect(ADDRESSES).toHaveLength(2);
    for (const address of ADDRESSES) expect(address.lines.length).toBeGreaterThanOrEqual(3);
    expect(addressForMarket('GB').market).toBe('GB');
    expect(addressForMarket('EU').market).toBe('EU');
  });

  it('reports all three printed fields as ones we do not hold', () => {
    expect(hasPrintedIdentity()).toBe(false);
    expect(printedIdentityGaps()).toEqual(['name', 'address', 'telephone']);
  });
});

describe('once an account has saved its identity', () => {
  beforeEach(() => {
    setPrintedIdentity({
      business: {
        registeredName: 'Willow and Wick Ltd',
        tradingName: 'Willow & Wick',
        telephone: '01273 000000',
        email: 'hello@willowandwick.co.uk',
        website: 'willowandwick.co.uk',
        vatNumber: 'GB123456789'
      },
      addresses: [
      { market: 'GB', lines: ['Willow and Wick Ltd', '1 Test Street', 'Lewes BN7 2QA', 'United Kingdom'] }]

    });
  });

  it('prints what was saved, through the same import every renderer uses', () => {
    expect(BUSINESS.name).toBe('Willow and Wick Ltd');
    expect(BUSINESS.tradingName).toBe('Willow & Wick');
    expect(BUSINESS.phone).toBe('01273 000000');
    expect(addressForMarket('GB').lines[0]).toBe('Willow and Wick Ltd');
  });

  it('leaves a market with no stored block on its placeholder', () => {
    expect(hasPrintedAddress('GB')).toBe(true);
    expect(hasPrintedAddress('EU')).toBe(false);
    expect(addressForMarket('EU').lines[0]).toMatch(/^\[/);
  });

  it('names only what is genuinely missing', () => {
    expect(printedIdentityGaps('GB')).toEqual([]);
    expect(printedIdentityGaps('EU')).toEqual(['address']);
  });

  it('clears back to placeholders when the account goes away', () => {
    setPrintedIdentity(null);
    expect(BUSINESS.name).toBe('[Your registered business name]');
    expect(addressForMarket('GB').lines[0]).toBe('[Your registered business name]');
    expect(hasPrintedIdentity()).toBe(false);
  });

  it('replaces rather than merges, so a previous account leaves nothing behind', () => {
    setPrintedIdentity({
      business: {
        registeredName: 'Second Account Ltd',
        tradingName: null,
        telephone: null,
        email: null,
        website: null,
        vatNumber: null
      },
      addresses: []
    });
    expect(BUSINESS.name).toBe('Second Account Ltd');
    expect(BUSINESS.phone).toBe('[Your telephone number]');
    expect(addressForMarket('GB').lines[0]).toMatch(/^\[/);
    expect(hasPrintedAddress('GB')).toBe(false);
  });
});

describe('the trading name, which is what the label face carries', () => {
  it('falls back to the registered name rather than to a placeholder', () => {
    // A placeholder standing in for information we are holding is worse than useless: the
    // maker told us who they are, and the label would deny it.
    setPrintedIdentity({
      business: {
        registeredName: 'Acme Candles Ltd',
        tradingName: null,
        telephone: '01273 000000',
        email: null,
        website: null,
        vatNumber: null
      },
      addresses: []
    });
    expect(BUSINESS.tradingName).toBe('Acme Candles Ltd');
  });
});

describe('an extra market block', () => {
  it('appears beside the standing two rather than replacing them', () => {
    setPrintedIdentity({
      business: null,
      addresses: [{ market: 'NI', lines: ['A Person', 'A Street', 'Belfast BT1 1AA'] }]
    });
    expect(ADDRESSES.map((address) => address.market)).toEqual(['GB', 'EU', 'NI']);
    expect(hasPrintedAddress('NI')).toBe(true);
  });
});
