import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { mapEntitlement, type Entitlement, type EntitlementRow } from '../lib/membership';
import type { EntitlementValue } from '../lib/entitlement';
import type { ProductsStatus } from '../lib/product-store';
import type { ProducedArtefact, RecallResult, RecordEvent } from '../lib/records';

/**
 * THE FOUR SENTENCES THE RECALL SEARCH IS ALLOWED TO SAY, AND WHY THEY ARE FOUR.
 *
 * This screen replaced one that was withdrawn for a single defect, recorded in its own header:
 * a recall search over invented runs could tell a real maker "no run used a lot matching that"
 * — a false negative, on a recall, rendered as a confident sentence.
 *
 * There are now real rows behind it, which removes the invention and not the risk. The risk is
 * that the three ways of finding nothing get one sentence between them:
 *
 *   a search over 40 batch records that matched none of them  → an answer, and it is "no"
 *   a search over NO batch records                            → not an answer at all
 *   a search that failed                                      → not an answer, and it must
 *                                                               say so louder than either
 *
 * On the morning a supplier withdraws a drum these send somebody in three different
 * directions, and the middle one — an account that has been keeping its batch book on paper —
 * is the one that would otherwise be told, in a green box, that nothing is affected.
 *
 * The other half of this file is the same rule applied to the log itself: an empty log, a log
 * we could not read, a log withheld from a suspended account and a log there is no account to
 * read are four states, and only one of them is "nothing recorded yet".
 */

const entitlement = vi.fn<() => EntitlementValue>();
const productsStatus = { status: 'ready' as ProductsStatus };

vi.mock('../lib/entitlement', () => ({
  useEntitlement: () => entitlement()
}));

vi.mock('../lib/product-store', () => ({
  useProducts: () => ({
    status: productsStatus.status,
    products: [
    {
      id: 'product-1',
      specificationId: 'spec-1',
      name: 'Black Fig',
      sku: 'CC-BF-220',
      categoryId: 'home-fragrance',
      markets: ['GB'],
      regimes: ['clp'],
      spec: {},
      artefacts: [],
      identifiers: {},
      obligations: {}
    }],

    error: null,
    refresh: () => {},
    reload: async () => {}
  })
}));

const records = vi.hoisted(() => ({
  log: { ok: true, events: [] as RecordEvent[], truncated: false } as
  {ok: true;events: RecordEvent[];truncated: boolean;} | {ok: false;message: string;},
  recall: { ok: true, matches: [], totalBatchRecords: 0 } as RecallResult,
  artefacts: { ok: true, artefacts: [] } as
  {ok: true;artefacts: ProducedArtefact[];} | {ok: false;message: string;},
  fingerprint: null as string | null,
  noted: [] as unknown[],
  noteResult: { ok: true, value: 'event-note' } as
  {ok: true;value: string;} | {ok: false;reason: string;message: string;}
}));

vi.mock('../lib/records', async () => {
  const actual = await vi.importActual<typeof import('../lib/records')>('../lib/records');
  return {
    ...actual,
    fetchRecordLog: async () => records.log,
    fetchProducedArtefacts: async () => records.artefacts,
    currentSourceFingerprint: async () => records.fingerprint,
    insertEvent: async (input: unknown) => {
      records.noted.push(input);
      return records.noteResult;
    },
    recallByLot: async () => records.recall,
    recallByArtefact: async () => records.recall
  };
});

import { Records } from './Records';

const ROW: EntitlementRow = {
  brand: 'batchlabel',
  accountId: 'acct-1111',
  membershipStatus: 'active',
  businessName: 'Test Ltd',
  plan: 'free',
  planStatus: null,
  active: true,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trialEnd: null,
  skuLimit: 3,
  skuCount: 0,
  skuUnlimited: false,
  editorSeatLimit: 1,
  canModify: true
};

function published(value: Entitlement): EntitlementValue {
  return {
    ...value,
    loading: false,
    skuCountStale: false,
    refresh: vi.fn(),
    noteSkuCountChanged: vi.fn()
  };
}

function draw(path = '/records') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/records" element={<Records />} />
        <Route path="/records/:recordCode" element={<Records />} />
      </Routes>
    </MemoryRouter>
  );
}

function event(overrides: Partial<RecordEvent> = {}): RecordEvent {
  return {
    id: 'event-1',
    kind: 'batch.produced',
    occurredAt: '2026-08-01T09:00:00.000Z',
    recordedAt: '2026-08-01T09:00:01.000Z',
    productId: 'product-1',
    specificationId: 'spec-1',
    artefactId: null,
    materialId: null,
    batchCode: 'BF-2026-014',
    units: 120,
    identityKind: 'batch',
    serialFrom: '',
    serialTo: '',
    obligationId: '',
    reference: '',
    summary: 'Batch BF-2026-014 of Black Fig',
    detail: {},
    lots: [],
    artefacts: [],
    ...overrides
  };
}

beforeEach(() => {
  entitlement.mockReturnValue(published(mapEntitlement(ROW)));
  productsStatus.status = 'ready';
  records.log = { ok: true, events: [], truncated: false };
  records.recall = { ok: true, matches: [], totalBatchRecords: 0 };
  records.artefacts = { ok: true, artefacts: [] };
  records.fingerprint = null;
  records.noted.length = 0;
  records.noteResult = { ok: true, value: 'event-note' };
});

function artefact(overrides: Partial<ProducedArtefact> = {}): ProducedArtefact {
  return {
    id: 'artefact-1',
    productId: 'product-1',
    artefactType: 'unit-label',
    version: 3,
    producedAt: '2026-07-30T10:00:00.000Z',
    printedAt: null,
    specificationHash: 'hash-abc',
    isPlaceholder: true,
    notes: '',
    ...overrides
  };
}

/* ------------------------------------------------------------- the log */

describe('the log itself', () => {
  it('says an empty log is empty, and offers the thing that fills it', async () => {
    draw();

    expect(await screen.findByText(/Nothing recorded yet/i)).toBeInTheDocument();
    // Not a failure. Nothing failed, and this is the first screen every new account sees.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Record a batch/i })).toBeInTheDocument();
  });

  it('says a log it could not read is a failure, and never draws an empty log over it', async () => {
    records.log = { ok: false, message: 'We could not read your records just now.' };

    draw();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not read your records/i);
    // The sentence a maker with forty batch records must never be shown after a dropped
    // request. It reads as data loss, and it is the reason this screen has five states.
    expect(screen.queryByText(/Nothing recorded yet/i)).not.toBeInTheDocument();
    expect(alert).toHaveTextContent(/not an empty log/i);
    // And no control that writes, because we do not know what is already in there.
    expect(screen.queryByRole('button', { name: /Record a batch/i })).not.toBeInTheDocument();
  });

  it('draws the entries it was given, with the batch code and the units', async () => {
    records.log = { ok: true, events: [event()], truncated: false };

    draw();

    expect(await screen.findByText('Batch BF-2026-014 of Black Fig')).toBeInTheDocument();
    expect(screen.getByText('BF-2026-014')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
  });

  it('shows when an entry was written up long after it happened, and not otherwise', async () => {
    records.log = { ok: true, events: [event()], truncated: false };
    draw();
    expect(await screen.findByText('Batch BF-2026-014 of Black Fig')).toBeInTheDocument();
    expect(screen.queryByText(/written up/i)).not.toBeInTheDocument();

    records.log = {
      ok: true,
      events: [event({ recordedAt: '2026-08-06T09:00:00.000Z' })],
      truncated: false
    };
    draw();
    // Tuesday's batch written up on Friday. occurred_at is what a recall works backwards
    // from, and the log has to be able to say which of the two dates it is showing.
    expect(await screen.findAllByText(/written up/i)).not.toHaveLength(0);
  });

  it('tells a filtered view apart from an empty account', async () => {
    draw('/records/BF-2026-014');

    expect(await screen.findByText(/Nothing in the log matches this filter/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing recorded yet/i)).not.toBeInTheDocument();
  });

  it('withholds the log from a suspended account rather than calling it empty', async () => {
    entitlement.mockReturnValue(
      published(mapEntitlement({ ...ROW, membershipStatus: 'suspended', active: false }))
    );

    draw();

    // Zero rows come back for a suspended account with no error at all, so "nothing recorded
    // yet" would be a false sentence shown to somebody holding a book full of runs.
    await waitFor(() =>
    expect(screen.queryByText(/Nothing recorded yet/i)).not.toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: /Record a batch/i })).not.toBeInTheDocument();
  });

  it('says an unfinished signup is an unfinished signup', async () => {
    entitlement.mockReturnValue(published(mapEntitlement(null)));

    draw();

    await waitFor(() =>
    expect(screen.queryByText(/Nothing recorded yet/i)).not.toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: /Record a batch/i })).not.toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------- recall */

describe('the recall search', () => {
  const search = async () => {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Lot number/i), 'LOT-88213');
    await user.click(screen.getByRole('button', { name: /Search/i }));
  };

  it('refuses to call an empty log an answer of no', async () => {
    records.recall = { ok: true, matches: [], totalBatchRecords: 0 };

    draw();
    await screen.findByText(/Nothing recorded yet/i);
    await search();

    const answer = await screen.findByText(/There was nothing to search/i);
    expect(answer).toBeInTheDocument();
    // The exact failure this screen exists to prevent.
    expect(screen.queryByText(/No batch record names it/i)).not.toBeInTheDocument();
    expect(screen.getByText(/absence of an answer/i)).toBeInTheDocument();
  });

  it('does give the answer of no when there were records to search', async () => {
    records.recall = { ok: true, matches: [], totalBatchRecords: 40 };

    draw();
    await screen.findByText(/Nothing recorded yet/i);
    await search();

    expect(await screen.findByText(/No batch record names it/i)).toBeInTheDocument();
    expect(screen.getByText(/40/)).toBeInTheDocument();
    expect(screen.queryByText(/There was nothing to search/i)).not.toBeInTheDocument();
  });

  it('says a failed search is a failure, in as many words', async () => {
    records.recall = { ok: false, message: 'The search did not run, so this is not an answer.' };

    draw();
    await screen.findByText(/Nothing recorded yet/i);
    await search();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/The search did not run/i);
    expect(screen.queryByText(/No batch record names it/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/There was nothing to search/i)).not.toBeInTheDocument();
  });

  it('names the affected batches, and says when the unit total is a floor rather than a total', async () => {
    records.recall = {
      ok: true,
      matches: [event(), event({ id: 'event-2', batchCode: 'BF-2026-015', units: null })],
      totalBatchRecords: 9
    };

    draw();
    await screen.findByText(/Nothing recorded yet/i);
    await search();

    expect(await screen.findByText('BF-2026-014')).toBeInTheDocument();
    expect(screen.getByText('BF-2026-015')).toBeInTheDocument();
    // One of the two recorded a count. Reporting 120 as the affected total would understate
    // a recall, so the sentence says the real figure is higher.
    expect(screen.getByText(/the real figure is higher/i)).toBeInTheDocument();
  });
});

/* -------------------------------------------------- is the version still it */

describe('whether the version being searched for still matches what prints today', () => {
  const openVersionMode = async () => {
    const user = userEvent.setup();
    draw();
    await screen.findByText(/Nothing recorded yet/i);
    await user.click(screen.getByRole('button', { name: /By label version/i }));
  };

  it('will not say either way when the fingerprint could not be read', async () => {
    records.artefacts = { ok: true, artefacts: [artefact()] };
    records.fingerprint = null;

    await openVersionMode();

    // "Still matches" on a read that never happened is a compliance claim nothing checked.
    expect(await screen.findByText(/not a statement either way/i)).toBeInTheDocument();
  });

  it('says it still matches when the two fingerprints agree', async () => {
    records.artefacts = { ok: true, artefacts: [artefact()] };
    records.fingerprint = 'hash-abc';

    await openVersionMode();

    expect(await screen.findByText(/still matches the composition/i)).toBeInTheDocument();
  });

  it('says something that prints has moved when they do not', async () => {
    records.artefacts = { ok: true, artefacts: [artefact()] };
    records.fingerprint = 'hash-moved';

    await openVersionMode();

    expect(await screen.findByText(/Something that prints has changed/i)).toBeInTheDocument();
  });
});

/* -------------------------------------------- correcting an entry, the only way */

describe('adding a note', () => {
  /**
   * The batch form and the page header both say a mistake is corrected by adding another
   * entry, because `record_events` refuses UPDATE and DELETE from every browser session. A
   * screen that says that and offers no way to add an entry short of recording a whole batch
   * would be stating a capability that does not exist.
   */
  it('writes the note the maker typed, and closes on success', async () => {
    const user = userEvent.setup();
    draw();
    await screen.findByText(/Nothing recorded yet/i);

    await user.click(screen.getByRole('button', { name: /Add a note/i }));
    await user.type(
      screen.getByLabelText(/Add a note to the log/i),
      'The tins say BF-2026-041'
    );
    await user.click(screen.getByRole('button', { name: /Add to the log/i }));

    await waitFor(() => expect(records.noted).toHaveLength(1));
    expect(records.noted[0]).toMatchObject({
      kind: 'note',
      summary: 'The tins say BF-2026-041'
    });
    await waitFor(() =>
    expect(screen.queryByLabelText(/Add a note to the log/i)).not.toBeInTheDocument()
    );
  });

  it('holds the form open with the text still in it when the write failed', async () => {
    records.noteResult = { ok: false, reason: 'refused', message: 'That was refused.' };
    const user = userEvent.setup();
    draw();
    await screen.findByText(/Nothing recorded yet/i);

    await user.click(screen.getByRole('button', { name: /Add a note/i }));
    await user.type(screen.getByLabelText(/Add a note to the log/i), 'A correction');
    await user.click(screen.getByRole('button', { name: /Add to the log/i }));

    expect(await screen.findByText(/That was refused/i)).toBeInTheDocument();
    // Retyping a correction is how a correction stops being written down.
    expect(screen.getByLabelText(/Add a note to the log/i)).toHaveValue('A correction');
  });
});
