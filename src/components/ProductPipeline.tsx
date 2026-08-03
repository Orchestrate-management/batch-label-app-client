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
    <div className="border-b border-paper-line bg-paper-panel/40 px-6 lg:px-10">
      <ol className="flex flex-wrap items-stretch">
        {stages.map((stage, index) => {
          const selected = stage.id === active.id;
          return (
            <li key={stage.id} className="flex items-stretch">
              {index > 0 &&
              <ChevronRightIcon
                className="my-auto h-4 w-4 flex-none text-ink-tertiary/60"
                strokeWidth={1.25}
                aria-hidden="true" />

              }
              <button
                type="button"
                onClick={() => onSelect(stage.id)}
                aria-current={selected ? 'step' : undefined}
                className={`flex items-center gap-2 border-b-2 px-3 py-3 text-left transition-colors ${
                selected ?
                'border-teal text-ink' :
                'border-transparent text-ink-secondary hover:text-ink'}`
                }>
                
                {!stage.checked ?
                <MinusIcon
                  className="h-4 w-4 flex-none text-ink-tertiary"
                  strokeWidth={1.5}
                  aria-hidden="true" /> :

                stage.settled ?
                <CheckIcon
                  className="h-4 w-4 flex-none text-teal"
                  strokeWidth={1.75}
                  aria-hidden="true" /> :


                <CircleIcon
                  className="h-4 w-4 flex-none text-clay"
                  strokeWidth={1.5}
                  aria-hidden="true" />

                }
                <span className="text-[0.8125rem] font-medium">{stage.label}</span>
                {stage.checked && !stage.settled &&
                <span className="tabular rounded-full bg-clay-tint px-1.5 py-px text-2xs font-medium text-clay-dark">
                    {stage.issues.length}
                  </span>
                }
              </button>
            </li>);

        })}
      </ol>

      <div className="pb-4">
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
            className="flex flex-wrap items-start justify-between gap-3 rounded-control border border-clay/30 bg-clay-tint px-4 py-2.5">
            
                <div className="min-w-0">
                  <p className="text-[0.8125rem] font-medium text-clay-dark">{issue.label}</p>
                  <p className="mt-0.5 max-w-prose text-2xs leading-relaxed text-ink-secondary">
                    {issue.detail}
                  </p>
                </div>
                <Link
              to={issue.to}
              className="mt-0.5 flex-none text-[0.8125rem] font-medium text-clay-dark underline underline-offset-2 hover:text-clay">
              
                  Resolve
                </Link>
              </li>
          )}
          </ul>
        }
      </div>
    </div>);

}