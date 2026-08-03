import { PageHeader } from '../components/AppShell';
import { Callout, Card, SectionTitle } from '../components/ui/Primitives';

/**
 * Production records — AND THE HONEST STATEMENT THAT THEY ARE NOT BUILT.
 *
 * WHAT THIS PAGE USED TO BE. Ten production runs of a business that does not exist, made by
 * Nadia, Tom and Priya, against four candles and a wax warmer, with input lot numbers,
 * artefact versions and unit counts. On top of them sat a recall search: type a lot number,
 * get back every run that used it, with an affected-unit total and a date range.
 *
 * A recall search is the most consequential screen in this application. It is what somebody
 * opens on the morning a supplier withdraws a batch, or when Trading Standards telephone. It
 * answered from an array of invented runs, which means it could return "no run used a lot or
 * serial matching that" to a real maker searching a real lot number — a false negative, on a
 * recall, rendered as a confident sentence. It could equally return four affected runs and
 * 186 units that had never been made.
 *
 * The account data schema creates accounts, specifications and products, and says of the
 * rest: "ARTEFACTS AND RECORDS ARE NOT HERE… Both are additive later and neither is metered."
 * So there is nowhere for a run to be stored, nothing to search, and no honest version of
 * that screen. This page says so instead, in the place the navigation already sends people,
 * and makes no claim it cannot support. The fixtures still exist in lib/fixtures.ts, where
 * the derivation tests use them and no customer can reach them.
 *
 * `/records/:recordCode` still resolves here rather than falling through to the catch-all
 * redirect: "this is not built yet" is a better answer to an old link than being silently
 * returned to Studio.
 */
export function Records() {
  return (
    <main className="flex-1 pb-24 xl:pb-0">
      <PageHeader
        eyebrow="Products · records"
        title="Production records"
        description="A record of every run: the composition used, the input lots that went into it, and the output versions printed on the day." />


      <div className="space-y-8 px-6 py-8 lg:px-10">
        <Callout tone="info" title="Not built yet">
          <p className="max-w-prose leading-relaxed">
            Nothing is stored here, and no run of yours has been recorded. Batchlabel holds your
            products and their compositions today; the batch log sits on top of them and is not
            written yet.
          </p>
        </Callout>

        <section aria-labelledby="what-it-will-hold">
          <SectionTitle className="mb-3">
            <span id="what-it-will-hold">What a record will hold</span>
          </SectionTitle>
          <Card className="px-5 py-5">
            <ul className="max-w-prose space-y-3 text-sm leading-relaxed text-ink-secondary">
              <li>
                <span className="font-medium text-ink">The identity of the run.</span> A batch
                code for something you mix, a serial range for something you assemble.
              </li>
              <li>
                <span className="font-medium text-ink">Every input lot.</span> Which fragrance
                lot, which wax lot, which component lot went into it — because that is what a
                recall is searched by.
              </li>
              <li>
                <span className="font-medium text-ink">
                  The composition and the output versions used on the day.
                </span>{' '}
                Frozen with the run, so that a later change to a recipe never rewrites what was
                actually made.
              </li>
            </ul>
            <p className="mt-4 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
              Until it exists, keep your batch records however you keep them now. We would
              rather say that plainly than show you a recall search that answers from nothing: a
              search that reports "no run used this lot" when it has no runs to look in is worse
              than no search at all.
            </p>
          </Card>
        </section>
      </div>
    </main>);

}
