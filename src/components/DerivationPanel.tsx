import { useState } from 'react';
import { ChevronRightIcon, TriangleAlertIcon } from 'lucide-react';
import { Derivation, DerivedItem, WhyLine } from '../lib/derive';
import { regimeById } from '../lib/regimes';
import { Card, Pill, SectionTitle } from './ui/Primitives';
import { PICTOGRAM_NAMES, Pictogram } from './artefact/Symbols';

function Why({ line }: {line: WhyLine;}) {
  return (
    <div className="border-l-2 border-teal-selected pl-3">
      <p className="text-[0.8125rem] leading-relaxed text-ink-secondary">{line.lead}</p>
      {line.meta &&
      <p className="tabular mt-1 text-[0.8125rem] leading-relaxed text-ink-secondary">
          {line.meta}
        </p>
      }
      {line.source && <p className="mt-1 text-2xs text-ink-tertiary">Source: {line.source}.</p>}
    </div>);

}

function Expandable({ item }: {item: DerivedItem;}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-paper-line last:border-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 py-3 text-left">
        
        <ChevronRightIcon
          className={`mt-0.5 h-4 w-4 flex-none text-ink-tertiary transition-transform ${
          open ? 'rotate-90' : ''}`
          }
          strokeWidth={1.25}
          aria-hidden="true" />
        
        <span
          className={`min-w-0 flex-1 text-sm ${item.tone === 'warn' ? 'text-clay-dark' : 'text-ink'}`}>
          
          {item.code && <span className="tabular mr-2 font-medium">{item.code}</span>}
          {item.text}
        </span>
        <span className="mt-0.5 flex-none text-2xs text-ink-tertiary">{open ? 'Hide' : 'Why'}</span>
      </button>
      {open &&
      <div className="space-y-3 pb-4 pl-6 pr-2">
          {item.why.map((line, index) =>
        <Why key={index} line={line} />
        )}
        </div>
      }
    </div>);

}

/**
 * One panel for every regime. Whatever produced the output — a concentration
 * threshold, an ordering rule, a certificate — it explains itself the same way.
 */
export function DerivationPanel({
  derivation,
  help



}: {derivation: Derivation;help: string;}) {
  return (
    <div className="space-y-5">
      {/*
        THE CLASSIFICATION HEADLINE. This is the answer the whole screen exists to
        produce, and it was three label-and-value pairs in a plain grid on a plain
        card, at much the same visual weight as the help text underneath it.

        The figures now sit in a ruled band on the sunken surface: values in the
        display face at 20px, small tertiary labels above them, and vertical rules
        between the columns so the three read as one instrument panel rather than
        as three loose facts. The band runs edge to edge inside the card, which is
        what makes it read as a readout rather than as more content.

        THE PICTOGRAMS ARE DELIBERATELY UNTOUCHED. `sizeMm={12}` is a real
        millimetre measurement — CLP Annex I sets a minimum pictogram size and this
        app renders true to it — so the value, the element and the
        `.artefact-surface` rules in index.css that protect it are all exactly as
        they were. Only the box around them moved.
      */}
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-paper-line bg-paper-sunken/60 px-5 py-4">
          <dl className="flex flex-1 flex-wrap divide-x divide-paper-line">
            {derivation.summary.map((entry) =>
            <div key={entry.label} className="min-w-[9rem] flex-1 px-4 first:pl-0 last:pr-0">
                <dt className="text-2xs font-medium uppercase tracking-[0.12em] text-ink-tertiary">
                  {entry.label}
                </dt>
                <dd className="tabular mt-1.5 font-display text-xl font-semibold leading-tight text-ink">
                  {entry.value}
                </dd>
              </div>
            )}
          </dl>
          {derivation.clp && derivation.clp.pictograms.length > 0 &&
          <div className="flex flex-none items-center gap-2">
              {derivation.clp.pictograms.map((code) =>
            <span key={code} title={PICTOGRAM_NAMES[code]}>
                  <Pictogram code={code} sizeMm={12} />
                </span>
            )}
            </div>
          }
        </div>
        <p className="max-w-prose px-5 py-4 text-2xs leading-relaxed text-ink-tertiary">{help}</p>
      </Card>

      {derivation.proximity.length > 0 &&
      <div className="rounded-control border border-l-[3px] border-clay/40 border-l-clay bg-clay-tint px-4 py-3.5">
          <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-clay-dark">
            <TriangleAlertIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            Close to a threshold
          </p>
          <ul className="mt-2 space-y-2">
            {derivation.proximity.map((note, index) =>
          <li
            key={`${note.code}-${index}`}
            className="text-[0.8125rem] leading-relaxed text-clay-dark">
            
                <span className="tabular font-medium">{note.code}</span> — {note.message}
              </li>
          )}
          </ul>
        </div>
      }

      {derivation.groups.map((group) =>
      /* The group heading now sits on its own banded strip rather than floating
         above the first row with only padding separating them — on a group whose
         first item was long, the title and that item ran together. */
      <Card key={group.id} className="overflow-hidden p-0">
          <div className="flex items-center justify-between gap-3 border-b border-paper-line bg-paper-sunken/60 px-5 py-3">
            <SectionTitle>{group.title}</SectionTitle>
            <Pill tone="quiet">{regimeById(group.regimeId).short}</Pill>
          </div>
          <div className="px-5">
          {group.items.length === 0 ?
        <p className="py-4 text-sm text-ink-secondary">
              {group.emptyText ?? 'Nothing required here.'}
            </p> :

        group.items.map((item, index) => <Expandable key={`${item.text}-${index}`} item={item} />)
        }
          </div>
        </Card>
      )}

      {/* "Recalculated on every change" is true and stays. The pill beside it said "Frozen
          into every production record", which is the reassurance that matters most on the
          morning of a recall — that the classification in front of you is the one preserved
          with the batch — and there are no production records: the Records page says "nothing
          is stored here, and no run of yours has been recorded", and the migration says the
          batch log is not in this schema. Two screens in one app cannot answer that
          differently, so this one moves into the tense Records already uses. */}
      <div className="flex flex-wrap gap-2">
        <Pill tone="quiet">Recalculated on every change</Pill>
        <Pill tone="quiet">Will be frozen into a production record when the batch log ships</Pill>
      </div>
    </div>);

}