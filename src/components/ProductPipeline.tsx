import { Link } from 'react-router-dom';
import { CheckIcon, ChevronRightIcon, CircleIcon, MinusIcon } from 'lucide-react';
import { Stage } from '../lib/pipeline';

/**
 * Where the product has got to. Settled stages state what they settled on;
 * an unsettled stage says what is missing rather than merely blocking.
 *
 * THREE STATES, NOT TWO. A stage with `checked: false` ran no check at all, and it must not
 * borrow either of the other two renderings: a tick would claim work nobody did, and a clay
 * ring with an issue count would claim work the maker owes. It gets a neutral dash, no count,
 * and a line stating plainly what is not built. Today that is Documents, and the reason the
 * distinction is worth a state rather than a special case is that "settled" here is derived
 * from an empty issue list — so any future stage that stops looking would silently inherit a
 * green tick the same way.
 */
export function ProductPipeline({
  stages,
  activeId,
  onSelect




}: {stages: Stage[];activeId: Stage['id'];onSelect: (id: Stage['id']) => void;}) {
  const active = stages.find((stage) => stage.id === activeId) ?? stages[0];

  return (
    /*
      THE PIPELINE IS THE PRODUCT'S PROGRESS BAR, so it is now drawn like one.

      Each stage's state was a bare 16px glyph — a tick, a ring or a dash — floating
      beside its label at whatever colour the state implied. Three different shapes
      at three different optical weights, on three different backgrounds, meant the
      states were not comparable at a glance: the eye could find the clay ring but
      could not tell settled from not-checked without stopping on each one.

      Each marker is now the same 22px disc in the same position, and only its FILL
      and its glyph change. That makes the row scannable as a strip — which is what
      a pipeline is for — and it keeps the three states genuinely distinct by shape
      (tick / dot / dash) as well as by colour, so none of them is carried by
      colour alone.

      The strip also scrolls rather than wraps. Five stages wrapped to two rows
      below about 700px and the chevrons then pointed off the end of the first row
      into nothing, which read as a broken flow rather than a wrapped one.
    */
    <div className="border-b border-paper-rule bg-paper-sunken/50 px-5 sm:px-6 lg:px-10">
      <div className="page-shell">
      <ol className="flex items-stretch overflow-x-auto whitespace-nowrap">
        {stages.map((stage, index) => {
          const selected = stage.id === active.id;
          return (
            <li key={stage.id} className="flex flex-none items-stretch">
              {index > 0 &&
              <ChevronRightIcon
                className="my-auto h-4 w-4 flex-none text-ink-tertiary/50"
                strokeWidth={1.25}
                aria-hidden="true" />

              }
              <button
                type="button"
                onClick={() => onSelect(stage.id)}
                aria-current={selected ? 'step' : undefined}
                className={`flex items-center gap-2 border-b-2 px-3 py-3.5 text-left transition-colors ${
                selected ?
                'border-teal text-ink' :
                'border-transparent text-ink-secondary hover:border-paper-rule hover:text-ink'}`
                }>

                <span
                  aria-hidden="true"
                  className={`flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border ${
                  !stage.checked ?
                  'border-paper-rule bg-paper-panel text-ink-tertiary' :
                  stage.settled ?
                  'border-teal bg-teal text-white' :
                  'border-clay bg-clay-tint text-clay-dark'}`
                  }>

                  {!stage.checked ?
                  <MinusIcon className="h-3 w-3" strokeWidth={2} /> :
                  stage.settled ?
                  <CheckIcon className="h-3 w-3" strokeWidth={2.5} /> :
                  <CircleIcon className="h-2 w-2 fill-current" strokeWidth={0} />}
                </span>
                <span className={`text-[0.8125rem] ${selected ? 'font-semibold' : 'font-medium'}`}>
                  {stage.label}
                </span>
                {stage.checked && !stage.settled &&
                <span className="tabular rounded-full bg-clay-tint px-1.5 py-px text-2xs font-semibold text-clay-dark">
                    {stage.issues.length}
                  </span>
                }
              </button>
            </li>);

        })}
      </ol>

      <div className="pb-5 pt-1">
        {!active.checked ?
        <p className="text-[0.8125rem] text-ink-secondary">
            <span className="font-medium text-ink">{active.label} not checked.</span>{' '}
            {active.summary}.
          </p> :

        active.settled ?
        <p className="text-[0.8125rem] text-ink-secondary">
            <span className="font-medium text-ink">{active.label} settled.</span> {active.summary}.
          </p> :

        <ul className="space-y-2">
            {active.issues.map((issue) =>
          <li
            key={`${issue.label}-${issue.to}`}
            className="flex flex-wrap items-start justify-between gap-3 rounded-control border border-l-[3px] border-clay/40 border-l-clay bg-clay-tint px-4 py-3">

                <div className="min-w-0">
                  <p className="text-[0.8125rem] font-medium text-clay-dark">{issue.label}</p>
                  <p className="mt-0.5 max-w-prose text-2xs leading-relaxed text-ink-secondary">
                    {issue.detail}
                  </p>
                </div>
                <Link
              to={issue.to}
              className="mt-0.5 flex-none text-[0.8125rem] font-semibold text-clay-dark underline underline-offset-2 hover:text-clay">

                  Resolve
                </Link>
              </li>
          )}
          </ul>
        }
      </div>
      </div>
    </div>);

}