import React, { useCallback, useEffect, useState } from 'react';
import { PlusIcon, XIcon } from 'lucide-react';
import { useCan } from '../lib/active-account';
import { ARTEFACT_LABELS } from '../lib/categories';
import { ArtefactType, formatDate, Product } from '../lib/model';
import {
  fetchProducedArtefacts,
  recordArtefactVersion,
  recordBatchProduced,
  type ProducedArtefact,
  type RecordFailure } from
'../lib/records';
import {
  Button,
  Callout,
  Card,
  Checkbox,
  Field,
  FormError,
  Input,
  Select } from
'./ui/Primitives';

/**
 * Writing one production record.
 *
 * THIS IS THE FORM A RECALL IS ANSWERED FROM, which is the only thing that decides what is on
 * it. A batch code, because a run with no code is traceable to nothing. A date the units were
 * MADE, which is not the date this form was filled in. The input lots, because a supplier
 * withdrawing a drum is one of the two ways a recall starts. And the label version that went
 * on the units, because a label found to be wrong is the other.
 *
 * IT WRITES THROUGH ONE RPC. `batchlabel.record_batch_produced` puts the event, its lots and
 * its label links in a single transaction — see lib/records.ts. The log is append-only and the
 * browser holds no UPDATE and no DELETE, so a half-written record could never be repaired by
 * anybody: it would sit there looking like a run made from no traceable inputs.
 *
 * NOTHING ON THIS FORM IS PREFILLED FROM A GUESS. The date defaults to today because today is
 * when somebody is standing at a bench with a tray of candles; every other field starts empty.
 * There is no suggested batch code, because a code this app invented is a code that is not on
 * the tin.
 */
export function RecordBatchDialog({
  products,
  accountId,
  onClose,
  onRecorded




}: {products: Product[];accountId: string | null;onClose: () => void;onRecorded: () => void;}) {
  // Whether this person may write product data at all. A viewer reaching this dialog would be
  // refused by the INSERT policy on record_events, and refused with a bare 42501 that says
  // nothing, so the answer is given before the form is filled in rather than after.
  const { can, reason } = useCan();
  const mayWrite = can('write_data');
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [batchCode, setBatchCode] = useState('');
  const [madeOn, setMadeOn] = useState(() => todayValue());
  const [units, setUnits] = useState('');
  const [note, setNote] = useState('');
  const [lots, setLots] = useState<LotRow[]>([blankLot()]);
  const [chosenArtefacts, setChosenArtefacts] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{reason: RecordFailure;message: string;} | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);

  const product = products.find((entry) => entry.id === productId) ?? products[0];

  const changeProduct = (next: string) => {
    setProductId(next);
    // The versions belong to the product that was selected, so a tick left behind after a
    // change of product would attach another product's label to this run. There is no way to
    // unpick that afterwards — the log is append-only — so it is cleared here.
    setChosenArtefacts([]);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;

    const code = batchCode.trim();
    if (!product || !code) return;

    // Validated here rather than left to the CHECK constraints, for one reason: a constraint
    // violation arrives after the round trip with no idea which box caused it, and this form
    // knows exactly. The database still refuses all four — this is not the enforcement.
    const parsedUnits = units.trim() === '' ? null : Number(units);
    if (parsedUnits !== null && (!Number.isFinite(parsedUnits) || parsedUnits < 1)) {
      setInvalid('A unit count has to be a whole number of one or more. Leave it empty if you did not count them.');
      return;
    }
    const occurredAt = madeOnToIso(madeOn);
    if (!occurredAt) {
      setInvalid('That is not a date this could have been made on. A batch cannot be made in the future.');
      return;
    }
    setInvalid(null);
    setSaving(true);
    setFailure(null);

    // ACCOUNT OR NOTHING. This used to send `accountId ?? ''`, and the empty string reached
    // Postgres as a uuid parameter and came back 22P02 on an APPEND-ONLY table. The button below
    // is disabled without an account now, which is the real fix; this is the backstop that makes
    // the type honest rather than the guard.
    if (!accountId) {
      setSaving(false);
      setFailure({
        reason: 'no_account',
        message:
        'We have not worked out which workspace this belongs to, so nothing was sent and ' +
        'nothing has been recorded. Reload the page and try again.'
      });
      return;
    }

    const result = await recordBatchProduced({
      accountId,
      productId: product.id,
      productName: product.name,
      batchCode: code,
      occurredAt,
      units: parsedUnits === null ? null : Math.round(parsedUnits),
      lots: lots.
      filter((row) => row.lot.trim() !== '').
      map((row) => ({
        materialRef: row.material.trim() || 'Not named',
        lot: row.lot.trim(),
        quantity: row.quantity.trim() === '' ? null : Number(row.quantity),
        unit: row.unit.trim()
      })),
      artefactIds: chosenArtefacts,
      note
    });

    setSaving(false);
    if (!result.ok) {
      // The dialog stays open holding everything typed into it. On an append-only log that
      // matters more than usual: a maker who has to type a run in twice is a maker who might
      // record it twice, and there is no way to remove the second.
      setFailure({ reason: result.reason, message: result.message });
      return;
    }
    onRecorded();
    onClose();
  };

  if (!product) {
    return (
      <Dialog>
        <h2 className="font-display text-lg font-medium text-ink">Record a batch</h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-secondary">
          A production record belongs to a product, and this account does not have one yet.
          Create a product first and this will have something to record against.
        </p>
        <div className="flex justify-end pt-4">
          <Button type="button" variant="quiet" onClick={onClose}>
            Close
          </Button>
        </div>
      </Dialog>);

  }

  return (
    <Dialog>
      <h2 className="font-display text-lg font-medium text-ink">Record a batch</h2>
      <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-secondary">
        What you made, when you made it, and what went into it. This is what a recall is
        searched by, so the lots and the label version matter more than they look.
      </p>

      <form onSubmit={submit} className="mt-5 space-y-4">
        <Field label="Product">
          <Select value={product.id} onChange={(event) => changeProduct(event.target.value)}>
            {products.map((option) =>
            <option key={option.id} value={option.id}>
                {option.name}
              </option>
            )}
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Batch code"
            hint="The code on the tin. Yours, not one we made up.">

            <Input
              required
              className="tabular"
              value={batchCode}
              placeholder="BF-2026-014"
              onChange={(event) => setBatchCode(event.target.value)} />

          </Field>

          <Field
            label="Made on"
            hint="When the units were made — not when you are writing this up.">

            <Input
              type="date"
              className="tabular"
              value={madeOn}
              max={todayValue()}
              onChange={(event) => setMadeOn(event.target.value)} />

          </Field>
        </div>

        <Field label="Units made" hint="Optional. Leave it empty rather than estimating.">
          <Input
            type="number"
            min={1}
            step={1}
            className="tabular"
            value={units}
            placeholder=""
            onChange={(event) => setUnits(event.target.value)} />

        </Field>

        <LotEditor lots={lots} onChange={setLots} />

        <ArtefactPicker
          product={product}
          accountId={accountId}
          chosen={chosenArtefacts}
          onChange={setChosenArtefacts} />


        <Field label="Note" hint="Anything about this run worth remembering. Optional.">
          <Input
            value={note}
            placeholder="Second pour, wax lot ran warm"
            onChange={(event) => setNote(event.target.value)} />

        </Field>

        <Callout tone="info">
          <p className="max-w-prose leading-relaxed">
            Entries in the log cannot be edited or deleted afterwards, by you or by us. That is
            what makes it a record. A mistake is corrected by adding another entry.
          </p>
        </Callout>

        {!mayWrite && <FormError>{reason('write_data')}</FormError>}
        {invalid && <FormError>{invalid}</FormError>}
        {failure && <FormError>{failure.message}</FormError>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="quiet" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!batchCode.trim() || saving || !accountId || !mayWrite}>
            {saving ? 'Recording…' : 'Record this batch'}
          </Button>
        </div>
      </form>
    </Dialog>);

}

/* ------------------------------------------------------------------ lots */

type LotRow = {material: string;lot: string;quantity: string;unit: string;};

const blankLot = (): LotRow => ({ material: '', lot: '', quantity: '', unit: '' });

/**
 * The input lots, as rows rather than as a text box.
 *
 * A LOT NUMBER TYPED INTO A FREE-TEXT NOTE IS NOT TRACEABILITY. The recall search runs against
 * `record_event_lots.lot` with an exact, case-insensitive match, so the number has to arrive in
 * a column of its own. A row with a lot and no material name is still stored — the database
 * requires one or the other and takes "Not named" — because a lot number with no material is
 * worth more on a recall than nothing at all, and a form that refused it would teach people to
 * put it in the note.
 */
function LotEditor({
  lots,
  onChange


}: {lots: LotRow[];onChange: (next: LotRow[]) => void;}) {
  const update = (index: number, patch: Partial<LotRow>) => {
    onChange(lots.map((row, position) => position === index ? { ...row, ...patch } : row));
  };

  return (
    <fieldset className="rounded-control border border-paper-line px-4 py-4">
      <legend className="px-1 text-[0.8125rem] font-medium text-ink-secondary">
        Input lots
      </legend>
      <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
        Which supplier lot of which material went into this run. This is what "a batch that
        used the drum they have just withdrawn" is found by, so a row with only a lot number
        is still worth adding.
      </p>

      <div className="space-y-3">
        {lots.map((row, index) =>
        <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_84px_72px_auto]">
            <Input
            aria-label={`Material for lot ${index + 1}`}
            value={row.material}
            placeholder="Fragrance oil"
            onChange={(event) => update(index, { material: event.target.value })} />

            <Input
            aria-label={`Lot number ${index + 1}`}
            className="tabular"
            value={row.lot}
            placeholder="Lot number"
            onChange={(event) => update(index, { lot: event.target.value })} />

            <Input
            aria-label={`Quantity for lot ${index + 1}`}
            type="number"
            min={0}
            step="any"
            className="tabular"
            value={row.quantity}
            onChange={(event) => update(index, { quantity: event.target.value })} />

            <Input
            aria-label={`Unit for lot ${index + 1}`}
            value={row.unit}
            placeholder="g"
            onChange={(event) => update(index, { unit: event.target.value })} />

            <Button
            type="button"
            variant="quiet"
            size="sm"
            aria-label={`Remove lot ${index + 1}`}
            disabled={lots.length === 1}
            onClick={() => onChange(lots.filter((_, position) => position !== index))}>

              <XIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-3"
        onClick={() => onChange([...lots, blankLot()])}>

        <PlusIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        Add another lot
      </Button>
    </fieldset>);

}

/* -------------------------------------------------------- label versions */

/**
 * Which version of the maker's label went on these units, and the honest statement of what
 * that row is.
 *
 * BATCHLABEL DOES NOT GENERATE ARTWORK. The generation functions are not written and both
 * export controls in the artefact designer say so. `batchlabel.artefacts.is_placeholder` is
 * true on every row this app writes, and the sentence under the heading here is the screen's
 * half of that: recording a version is recording that the maker applied a version of THEIR
 * label, stamped with a fingerprint of what the composition was at that moment. The
 * fingerprint is real — `artefact_source_fingerprint` reads the composition, the pack, the
 * state of every material it names, and the printed business identity — and it is what later tells this version
 * apart from the one that replaced it.
 *
 * THE ABSENCE OF A VERSION IS SAID PLAINLY AND DOES NOT BLOCK THE SAVE. A batch recorded with
 * no label version is a real thing a maker may want to record; it simply will not be found by
 * a recall that starts from a label, and the note under the list says so in those words rather
 * than the form quietly accepting it.
 */
function ArtefactPicker({
  product,
  accountId,
  chosen,
  onChange




}: {product: Product;accountId: string | null;chosen: string[];onChange: (next: string[]) => void;}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState<ProducedArtefact[]>([]);
  // Every surface this product's regimes require, including the safety data sheet: a sheet
  // reissued for a batch is as much a version applied to it as a label is.
  const surfaces: ArtefactType[] = product.artefacts.map((artefact) => artefact.type);
  const [surface, setSurface] = useState<ArtefactType>(surfaces[0] ?? 'unit-label');
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    const result = await fetchProducedArtefacts(accountId, product.id);
    if (!result.ok) {
      setError(result.message);
      setStatus('error');
      return;
    }
    setVersions(result.artefacts);
    setError(null);
    setStatus('ready');
  }, [accountId, product.id]);

  useEffect(() => {
    let active = true;
    void fetchProducedArtefacts(accountId, product.id).then((result) => {
      // Discarded rather than applied when the product changed while it was in flight: a list
      // of another product's versions rendered under this heading is how a run gets recorded
      // against the wrong label, and the log cannot be corrected afterwards.
      if (!active) return;
      if (!result.ok) {
        setError(result.message);
        setStatus('error');
        return;
      }
      setVersions(result.artefacts);
      setError(null);
      setStatus('ready');
    });
    return () => {
      active = false;
    };
  }, [accountId, product.id]);

  const record = async () => {
    if (recording || !accountId) return;
    setRecording(true);
    setRecordError(null);
    const result = await recordArtefactVersion({
      accountId,
      productId: product.id,
      productName: product.name,
      artefactType: surface,
      artefactLabel: ARTEFACT_LABELS[surface]
    });
    setRecording(false);
    if (!result.ok) {
      setRecordError(result.message);
      // A partial save means the version row EXISTS and only its log line did not. Re-reading
      // is what puts it in the list, so the maker can tick it rather than recording a second.
      if (result.reason === 'partial_save') await load();
      return;
    }
    setVersions((current) => [result.value, ...current]);
    onChange([...chosen, result.value.id]);
  };

  return (
    <fieldset className="rounded-control border border-paper-line px-4 py-4">
      <legend className="px-1 text-[0.8125rem] font-medium text-ink-secondary">
        Label version applied
      </legend>
      <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
        Batchlabel does not produce label artwork yet, so a version here is a record that you
        applied a version of your own label — stamped with what the composition, the pack and
        the printed business details were at that moment. That stamp is what lets you ask,
        later, which batches carry a label you have since found wrong.
      </p>

      {status === 'loading' &&
      <p className="text-2xs text-ink-tertiary">Reading the versions recorded for this product…</p>
      }

      {status === 'error' &&
      <Callout tone="warn" role="alert">
          <p className="max-w-prose leading-relaxed">
            {error} Nothing here is a list of your versions — it is the absence of one, and the
            two are not the same.
          </p>
        </Callout>
      }

      {status === 'ready' && versions.length === 0 &&
      <p className="max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          No label version has been recorded for this product. You can still record the batch —
          it just will not be found by a recall that starts from a label.
        </p>
      }

      {status === 'ready' && versions.length > 0 &&
      <div className="space-y-2">
          {versions.map((version) =>
        <Checkbox
          key={version.id}
          id={`artefact-${version.id}`}
          checked={chosen.includes(version.id)}
          onChange={(next) =>
          onChange(
            next ?
            [...chosen, version.id] :
            chosen.filter((id) => id !== version.id)
          )
          }
          label={`${ARTEFACT_LABELS[version.artefactType]} v${version.version}`}
          description={`Recorded ${formatDate(version.producedAt)}`} />

        )}
        </div>
      }

      <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-paper-line pt-3">
        <Field label="Record a new version of" className="min-w-[180px] flex-1">
          <Select
            value={surface}
            onChange={(event) => setSurface(event.target.value as typeof surface)}>

            {surfaces.map((type) =>
            <option key={type} value={type}>
                {ARTEFACT_LABELS[type]}
              </option>
            )}
          </Select>
        </Field>
        <Button type="button" variant="secondary" onClick={record} disabled={recording || !accountId}>
          {recording ? 'Recording…' : 'Record version'}
        </Button>
      </div>
      {recordError && <FormError>{recordError}</FormError>}
    </fieldset>);

}

/* ----------------------------------------------------------------- dates */

/** Today, in the format an `<input type="date">` speaks, in the maker's own timezone. */
export function todayValue(now: Date = new Date()): string {
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * The chosen day, as the instant to store, or null when it is not a day this could have
 * happened on.
 *
 * TODAY BECOMES NOW, AND AN EARLIER DAY BECOMES MIDDAY. `new Date('2026-08-04')` is midnight
 * UTC, which for a maker an hour ahead is the evening of the 3rd — so a batch made on the 4th
 * would be logged as the 3rd, and a recall dated by day would miss it at the boundary. Midday
 * local is far enough from both ends of the day that no timezone moves it.
 *
 * A FUTURE DATE IS REFUSED RATHER THAN CLAMPED. The `max` on the input covers a person using
 * the picker; this covers a typed one. Silently changing a date somebody entered on a
 * compliance record is worse than telling them it is wrong.
 */
export function madeOnToIso(value: string, now: Date = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  if (value === todayValue(now)) return now.toISOString();
  const [year, month, day] = value.split('-').map(Number);
  const midday = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (Number.isNaN(midday.getTime())) return null;
  if (midday.getTime() > now.getTime()) return null;
  return midday.toISOString();
}

/** The modal chrome. Same shape as NewProductDialog's, and deliberately so. */
function Dialog({ children }: {children: React.ReactNode;}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/20 px-6 py-6"
      role="dialog"
      aria-modal="true"
      aria-label="Record a batch">

      <Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto px-6 py-6">{children}</Card>
    </div>);

}
