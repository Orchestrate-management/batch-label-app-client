import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Studio } from './Studio';
import { Products } from './Products';
import { Specification } from './Specification';
import { ArtefactDesigner } from './ArtefactDesigner';
import { WorkspaceProvider } from '../lib/workspace';
import { mapEntitlement, type Entitlement, type EntitlementRow } from '../lib/membership';
import type { EntitlementValue } from '../lib/entitlement';
import type { ProductsStatus } from '../lib/product-store';

/**
 * EVERY SCREEN A SIGNED-IN MAKER CAN REACH WITH NO ACCOUNT BEHIND THEM.
 *
 * The state is real and it is not rare. A Google signup abandoned at /finish-setup leaves a
 * genuine, verified, signed-in user with no account row: the session is good, so RequireAuth
 * lets them all the way into the app, and every screen behind it has nothing to scope a read
 * to. The products store publishes 'no-account' to say so — distinct from 'error' because
 * nothing failed, and distinct from 'ready' with an empty list because "you have no products"
 * is a claim we have not established.
 *
 * ONLY THE PRODUCTS SCREEN EVER READ IT. The other three answered the same fact with whatever
 * their own fall-through happened to be, and each one was a different untruth:
 *
 *   Studio (route `/`, the FIRST screen after sign-in) matched no branch at all and rendered
 *   a greeting, a New product button and blank space. Nothing on it said what had happened.
 *
 *   The specification screen and the designer both fell through to "No such product — we read
 *   your products and there is nothing here with this address. It may have been archived."
 *   No read was made, so every clause of that is false; worse, it is a deletion notice, shown
 *   on a bookmark, to somebody whose product is almost certainly still sitting there.
 *
 * There are three causes and they need three sentences, which is why this file checks the
 * words and not just that something rendered. Telling a half-finished signup "this is us, not
 * you" sends them away to wait for a fix that will never come.
 */

const entitlement = vi.fn<() => EntitlementValue>();
const entitlementRefresh = vi.fn();
const productsRefresh = vi.fn();

vi.mock('../lib/entitlement', () => ({
  useEntitlement: () => entitlement()
}));

vi.mock('../lib/meta-pixel', () => ({
  metaInitiateCheckout: () => {}
}));

const store = vi.hoisted(() => ({ status: 'no-account' as ProductsStatus }));

vi.mock('../lib/product-store', () => ({
  useProducts: () => ({
    status: store.status,
    products: [],
    error: null,
    refresh: productsRefresh,
    reload: async () => {}
  }),
  useProduct: () => ({
    status: store.status,
    product: null,
    error: null,
    refresh: productsRefresh
  })
}));

/** A row good in every respect except that no account could be resolved from it. */
const ROW: EntitlementRow = {
  brand: 'batchlabel',
  accountId: null,
  membershipStatus: 'active',
  businessName: 'Test Ltd',
  plan: 'free',
  planStatus: null,
  active: true,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trialEnd: null,
  skuLimit: 3,
  skuCount: null,
  skuUnlimited: false,
  editorSeatLimit: 1,
  canModify: true
};

function published(value: Entitlement): EntitlementValue {
  return { ...value, loading: false, refresh: entitlementRefresh };
}

/** Signup never finished. No row for this brand at all. */
const UNFINISHED = published(mapEntitlement(null));
/** The entitlement read itself did not come back. */
const UNREADABLE = published(mapEntitlement(null, true));
/** A membership we can read, whose account this brand could not single out. */
const AMBIGUOUS = published(mapEntitlement(ROW));

/** Every screen behind the auth gate that reads the products store. */
const SCREENS: Array<{name: string;draw: () => void;}> = [
{
  name: 'Studio, the first screen after sign-in',
  draw: () => drawAt('/', <Route path="/" element={<Studio />} />)
},
{
  name: 'the products list',
  draw: () => drawAt('/products', <Route path="/products" element={<Products />} />)
},
{
  name: 'a product bookmark',
  draw: () =>
  drawAt('/products/p-1', <Route path="/products/:productId" element={<Specification />} />)
},
{
  name: 'a label the maker was about to print',
  draw: () =>
  drawAt(
    '/products/p-1/artefacts/unit-label',
    <Route
      path="/products/:productId/artefacts/:artefactType"
      element={<ArtefactDesigner />} />

  )
}];


function drawAt(path: string, route: React.ReactNode) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <WorkspaceProvider>
        <Routes>{route}</Routes>
      </WorkspaceProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  store.status = 'no-account';
  entitlementRefresh.mockReset();
  productsRefresh.mockReset();
  entitlement.mockReturnValue(UNFINISHED);
});

describe('no account behind the workspace', () => {
  it.each(SCREENS)('$name says so', ({ draw }) => {
    draw();
    expect(screen.getByText('This workspace has no account behind it yet')).toBeInTheDocument();
  });

  it.each(SCREENS)('$name claims nothing about what the account holds', ({ draw }) => {
    draw();
    // The three sentences that used to appear here, one per screen. Each is a statement about
    // rows nobody read, and two of them are about rows the maker very probably still has.
    expect(screen.queryByText('No products yet')).not.toBeInTheDocument();
    expect(screen.queryByText('No such product')).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing here yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/may have been archived/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing in your products with this address/i)).not.toBeInTheDocument();
  });

  it.each(SCREENS)('$name does not blame a failure that did not happen', ({ draw }) => {
    draw();
    expect(screen.queryByText(/could not read your products/i)).not.toBeInTheDocument();
  });
});

describe('the three causes, which are three different next steps', () => {
  it('tells a half-finished signup to go and finish, and offers no retry', () => {
    entitlement.mockReturnValue(UNFINISHED);
    SCREENS[0].draw();
    expect(screen.getByText(/has not finished being set up/i)).toBeInTheDocument();
    // A button that cannot work is worse than no button: it reads as broken software rather
    // than as a step the person still has to take.
    expect(screen.getByText(/a retry will not/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('blames itself, and offers a retry, when the entitlement read failed', () => {
    entitlement.mockReturnValue(UNREADABLE);
    SCREENS[0].draw();
    expect(screen.getByText(/This is us, not you/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('says it is showing none rather than the wrong one when it cannot single an account out', () => {
    entitlement.mockReturnValue(AMBIGUOUS);
    SCREENS[0].draw();
    expect(screen.getByText(/showing none rather than the wrong one/i)).toBeInTheDocument();
    // Settled fact about the data, not a blip. Asking again returns the same answer.
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });
});

/**
 * The create button, on the two screens that carry one.
 *
 * A workspace with no account behind it used to keep "New product" — only `suspended` hid it.
 * The dialog opened, the maker filled in four fields, and the write was refused. It was not
 * refused badly (lib/products.ts names the cause and points at the setup step) but the refusal
 * arrived after the typing, on the one cause where we knew before they started.
 *
 * The gate is `entitlement.status`, not the store's `no-account`, and the difference IS the
 * feature: all three causes publish `no-account`, and only one of them means the write cannot
 * land. Hiding the button on the other two would take a create away from somebody whose create
 * would have worked — see `createIsCertainToFail` in lib/membership.ts.
 */
describe('the create button, in a workspace with no account behind it', () => {
  const WITH_A_CREATE = [SCREENS[0], SCREENS[1]];

  it.each(WITH_A_CREATE)('$name does not offer one to an unfinished signup', ({ draw }) => {
    entitlement.mockReturnValue(UNFINISHED);
    draw();
    expect(screen.queryByRole('button', { name: /new product/i })).not.toBeInTheDocument();
    // And the screen is not silent about why the button is gone: the notice is already there
    // saying signup was not finished. A control that vanishes with nothing explaining it is
    // its own small mystery.
    expect(screen.getByText(/has not finished being set up/i)).toBeInTheDocument();
  });

  it.each(WITH_A_CREATE)('$name still offers one when OUR read failed', ({ draw }) => {
    // The expensive direction. `createProduct` omits account_id and the database resolves it,
    // so a single-account maker's create works — taking the button away because one read of
    // ours blipped costs them a product they could have made.
    entitlement.mockReturnValue(UNREADABLE);
    draw();
    expect(screen.getByRole('button', { name: /new product/i })).toBeInTheDocument();
  });

  it.each(WITH_A_CREATE)('$name still offers one when the account is ambiguous', ({ draw }) => {
    // Not a status we can see in advance; it is a hint the write returns. The refusal that
    // follows is honest and offers no retry, which is the right place for it.
    entitlement.mockReturnValue(AMBIGUOUS);
    draw();
    expect(screen.getByRole('button', { name: /new product/i })).toBeInTheDocument();
  });
});

/**
 * The retry has to re-read the thing that failed.
 *
 * It used to call the PRODUCTS store's refresh, which cannot change this answer: the store has
 * no account id, so re-running its effect publishes 'no-account' again, and again, for ever.
 * The entitlement is what resolves an account, and the store re-reads on its own the moment
 * one lands — `accountId` is in its effect's dependency list.
 */
describe('the retry', () => {
  it('re-reads the entitlement rather than the products', () => {
    entitlement.mockReturnValue(UNREADABLE);
    SCREENS[0].draw();
    screen.getByRole('button', { name: /try again/i }).click();
    expect(entitlementRefresh).toHaveBeenCalled();
    expect(productsRefresh).not.toHaveBeenCalled();
  });
});
