import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../lib/records', () => ({
  fetchProducedArtefacts: async () => ({ ok: true, artefacts: [] }),
  recordArtefactVersion: async () => ({ ok: false, reason: 'failed', message: 'not used here' }),
  recordBatchProduced: async () => ({ ok: true, value: 'event-1' })
}));

import { RecordBatchDialog, madeOnToIso, todayValue } from './RecordBatchDialog';

/**
 * THE DATE ON A PRODUCTION RECORD, WHICH IS NOT THE DATE THE FORM WAS FILLED IN.
 *
 * `occurred_at` is what a recall works backwards from. Two things can move it by a day without
 * anybody noticing, and a day is exactly the resolution a recall is run at:
 *
 *   `new Date('2026-08-04')` is midnight UTC. For a maker an hour ahead that is the evening of
 *   the 3rd, so a batch made on the 4th would be filed under the 3rd — and a search bounded by
 *   day would miss it at the boundary. Midday local is far enough from both ends that no
 *   timezone moves it.
 *
 *   A typed future date is refused rather than clamped. Silently changing a date somebody
 *   entered on a compliance record is worse than telling them it is wrong.
 */
describe('the date a batch was made', () => {
  const now = new Date('2026-08-04T15:30:00.000Z');

  it('sends the actual moment when the day chosen is today', () => {
    // Today means somebody is standing at a bench now, and the time of day is real
    // information. Rounding it to midday would throw it away.
    expect(madeOnToIso(todayValue(now), now)).toBe(now.toISOString());
  });

  it('sends midday local for an earlier day, so no timezone moves it', () => {
    const iso = madeOnToIso('2026-07-28', now);
    expect(iso).not.toBeNull();
    const parsed = new Date(iso as string);
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(6);
    expect(parsed.getDate()).toBe(28);
    expect(parsed.getHours()).toBe(12);
  });

  it('refuses a day in the future rather than quietly moving it to today', () => {
    expect(madeOnToIso('2026-08-05', now)).toBeNull();
  });

  it('refuses anything that is not a date at all', () => {
    expect(madeOnToIso('', now)).toBeNull();
    expect(madeOnToIso('4 August', now)).toBeNull();
    expect(madeOnToIso('2026-8-4', now)).toBeNull();
  });

  it('writes today in the format the date control speaks, in the maker’s own timezone', () => {
    expect(todayValue(new Date(2026, 0, 9, 23, 30))).toBe('2026-01-09');
  });
});

describe('with nothing to record against', () => {
  it('says so, and offers no form that could not be submitted', () => {
    render(
      <RecordBatchDialog
        products={[]}
        accountId="acct-1111"
        onClose={() => {}}
        onRecorded={() => {}} />

    );

    expect(screen.getByText(/does not have one yet/i)).toBeInTheDocument();
    // No batch code box, because a production record belongs to a product and there is none.
    // A form that collects four fields in order to be refused is the pattern this codebase
    // keeps removing.
    expect(screen.queryByRole('button', { name: /Record this batch/i })).not.toBeInTheDocument();
  });
});
