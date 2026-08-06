import React from 'react';
import { ChevronDown } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  size?: 'sm' | 'md';
};

/**
 * A button that reports what it is doing under the pointer and under a press.
 *
 * The variants used to change one colour on hover and nothing on press, so a
 * click on a slow connection gave no feedback between the press and whatever the
 * screen did next — which on this app is often a database round trip. Each
 * variant now moves on `:active` as well, by a single pixel of translation plus a
 * darker fill, so the control acknowledges the press itself rather than waiting
 * for the result of it.
 *
 * `transition-[background-color,border-color,transform,box-shadow]` rather than
 * `transition-colors`, so the press movement is animated too; the global
 * reduced-motion block in index.css flattens all of it to nothing for anyone who
 * has asked for that.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonProps) {
  const base =
  'inline-flex items-center justify-center gap-2 rounded-control font-medium transition-[background-color,border-color,transform,box-shadow] duration-150 active:translate-y-px disabled:opacity-50 disabled:pointer-events-none disabled:active:translate-y-0';
  const sizes = {
    sm: 'h-9 px-3.5 text-[0.8125rem]',
    md: 'h-11 px-4 text-sm'
  };
  const variants = {
    // The one solid control on the screen, so it carries the only real shadow a
    // button gets. It is the primary action and it should look like the thing
    // your eye lands on last and your hand goes to first.
    primary: 'bg-teal text-white shadow-card hover:bg-teal-hover hover:shadow-raised active:bg-teal-hover active:shadow-card',
    // On the raised card surface rather than the ground, so a secondary button
    // sitting on a card does not look like a hole cut in it.
    secondary:
    'bg-paper-raised border border-paper-line text-ink shadow-card hover:bg-paper-panel hover:border-paper-rule active:bg-paper-panel active:shadow-none',
    quiet: 'text-ink-secondary hover:bg-paper-panel hover:text-ink active:bg-paper-sunken',
    danger: 'bg-paper-raised border border-clay/60 text-clay-dark hover:bg-clay-tint hover:border-clay active:bg-clay-tint'
  };
  return <button className={twMerge(base, sizes[size], variants[variant], className)} {...props} />;
}

/**
 * A sheet of paper on the desk.
 *
 * WAS `bg-paper` ON A `bg-paper` PAGE. The card and the ground behind it were the
 * same colour, so a 1px hairline was the entire difference between "inside this
 * grouping" and "outside it". On the screens that matter most here — a register
 * of ninety materials, a specification, a batch record — that produced one flat
 * wash with lines ruled across it and no way to see at a glance where a grouping
 * started or stopped.
 *
 * It is now the brand's card white with the faintest of warm shadows. Not to make
 * anything float: `shadow-card` is two nearly invisible layers whose only job is
 * to give the eye an edge to catch. See the boxShadow note in tailwind.config.js
 * for why the shade is mixed from ink rather than from black.
 */
export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={twMerge(
        'rounded-card border border-paper-line bg-paper-raised shadow-card',
        className
      )}
      {...props}>

      {children}
    </div>);

}

/**
 * The label over a group of things.
 *
 * It is small, upper case and widely tracked, which makes it quiet — correct for
 * a label, but it left the top of each group floating with nothing anchoring it
 * to the content beneath. `rule` draws a hairline out from the title to the full
 * width of the group, which is what actually makes a section read as a section.
 * It is opt-in because a title that already sits inside a bordered card has an
 * edge of its own and does not need a second one.
 */
export function SectionTitle({
  children,
  rule = false,
  className




}: {children: React.ReactNode;rule?: boolean;className?: string;}) {
  const heading = (
    <h2
      className={twMerge(
        'font-display text-[0.8125rem] font-medium uppercase tracking-[0.14em] text-ink-tertiary',
        className
      )}>

      {children}
    </h2>);


  if (!rule) return heading;
  return (
    <div className="flex items-center gap-4">
      {heading}
      <span aria-hidden="true" className="h-px flex-1 bg-paper-line" />
    </div>);

}

type PillTone = 'neutral' | 'good' | 'warn' | 'quiet';

/**
 * A status chip, and the dot is not decoration.
 *
 * The four tones were carried by fill colour alone, so "Nothing outstanding" and
 * "3 outstanding" differed by a wash of teal against a wash of clay — a
 * distinction that disappears for the eight percent of men with a red-green
 * deficiency, and in every greyscale print of a compliance record. WCAG 1.4.1
 * says colour may not be the only visual means of conveying information, and on
 * a screen whose whole job is to tell a maker whether something is wrong, that is
 * not a technicality.
 *
 * The dot adds a second channel — filled for a verdict, hollow for a state where
 * nothing has been established — and the words were already carrying a third. The
 * dot is `aria-hidden` because the text beside it already says the thing; a
 * screen reader announcing "bullet 3 outstanding" would be worse, not better.
 *
 * `quiet` MUST NOT PICK UP A TEAL FILL. It is the tone for a check that did not
 * run, and painting an unevaluated rule with the same green as a passed one is
 * the exact fault src/pages/absence-on-screen.test.tsx exists to catch — it
 * asserts on this component's class string. Its dot is hollow for the same
 * reason: there is no verdict to report.
 */
export function Pill({
  tone = 'neutral',
  children,
  className




}: {tone?: PillTone;children: React.ReactNode;className?: string;}) {
  const tones: Record<PillTone, string> = {
    neutral: 'bg-paper-panel text-ink-secondary border-paper-line',
    good: 'bg-teal-tint text-teal-hover border-teal-selected',
    warn: 'bg-clay-tint text-clay-dark border-clay/40',
    quiet: 'bg-transparent text-ink-tertiary border-paper-rule border-dashed'
  };
  const dots: Record<PillTone, string> = {
    neutral: 'bg-ink-tertiary',
    good: 'bg-teal',
    warn: 'bg-clay',
    quiet: 'border border-ink-tertiary bg-transparent'
  };
  return (
    <span
      className={twMerge(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-2xs font-medium',
        tones[tone],
        className
      )}>

      <span
        aria-hidden="true"
        className={twMerge('h-1.5 w-1.5 flex-none rounded-full', dots[tone])} />

      {children}
    </span>);

}

export function Field({
  label,
  hint,
  children,
  className





}: {label: string;hint?: string;children: React.ReactNode;className?: string;}) {
  return (
    <label className={twMerge('block', className)}>
      <span className="mb-1.5 block text-[0.8125rem] font-medium text-ink-secondary">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-2xs text-ink-tertiary">{hint}</span>}
    </label>);

}

/**
 * The shared skin for anything a maker types or picks in.
 *
 * NO `focus:outline-none` HERE, AND NOTHING MAY PUT IT BACK. index.css gives every
 * focusable thing in the app a 2px teal ring at a 2px offset; buttons and links get
 * it, and the fields used to opt out of it — leaving a 1px border colour change as
 * the entire focus indicator. That is thinner than the 2px perimeter WCAG 2.2
 * requires of a focus indicator (SC 2.4.11), and it is the only signal a keyboard
 * user gets on a form that decides what goes on a regulated label. The teal border
 * stays as a second signal, and as the only one a mouse user needs.
 *
 * The disabled skin is shared too, so a field that is off looks off whether it is an
 * Input or a Select. It is a panel fill and tertiary ink rather than `opacity-50`,
 * because a half-transparent field is illegible as well as inert, and the text in a
 * disabled field is often the part that explains why it is disabled ("Loading…").
 * At 4.9:1 the disabled text is still readable.
 *
 * THE BORDER IS `paper-edge` RATHER THAN `paper-line`, AND THAT IS THE FIX THIS
 * SKIN MOST NEEDED. `paper-line` is 1.20:1 against the page — not a boundary, a
 * suggestion of one — so an enabled field and the paper around it were very nearly
 * the same rectangle. `paper-edge` is 3.70:1 on a card and 3.39:1 on the ground,
 * which is the 3:1 SC 1.4.11 asks of the visual information that identifies a
 * control. The full argument is on the token in src/index.css.
 *
 * The disabled border drops BACK to `paper-rule` on purpose: an inert field should
 * not advertise itself as strongly as one you can type in, and 1.5:1 there is
 * correct rather than a lapse, because the fill and the ink have already changed
 * and the control is no longer a target.
 */
const inputBase =
'w-full rounded-control border border-paper-edge bg-paper-raised px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-tertiary transition-colors hover:border-ink-tertiary focus:border-teal disabled:cursor-not-allowed disabled:border-paper-rule disabled:bg-paper-panel disabled:text-ink-tertiary disabled:hover:border-paper-rule';

/**
 * forwardRef so a form can move focus to the box that is wrong. An error nobody
 * is taken to is an error most people do not find.
 */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={twMerge(inputBase, className)} {...props} />;
  }
);

/**
 * A dropdown that looks like something that opens.
 *
 * IT IS STILL A NATIVE `<select>`, DELIBERATELY. Only the closed control was ever
 * wrong: `appearance-none` stripped the native chevron and `pr-8` reserved the room
 * for a replacement that was never drawn, so every dropdown in the app rendered as a
 * text-input-shaped box with an unexplained gap and no sign it could be opened.
 * That is a painting job, and it is done here. Replacing the element with a
 * button-and-popover listbox would buy control of the open list — which is OS chrome
 * and unstyleable — at the price of re-implementing type-ahead, roving focus, the
 * combobox semantics screen readers already get for free, and, on a phone, the
 * native picker. Makers use this in a workshop, one-handed. The iOS and Android
 * pickers are better than anything we would build, and this app's selects carry
 * hazard classes and pictograms, where a half-right listbox is worse than a plain one.
 *
 * The chevron is `pointer-events-none` so the whole control stays one hit target, and
 * `aria-hidden` because the element already announces itself as a combobox.
 */
export function Select({
  className,
  children,
  disabled,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="group relative block w-full">
      <select
        disabled={disabled}
        className={twMerge(
          inputBase,
          'cursor-pointer appearance-none pr-10',
          className
        )}
        {...props}>

        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className={twMerge(
          'pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 transition-colors',
          disabled ? 'text-ink-tertiary/60' : 'text-ink-secondary group-hover:text-ink'
        )} />

    </span>);

}

export function Callout({
  tone = 'info',
  title,
  children,
  className,
  role






}: {tone?: 'info' | 'warn';title?: string;children: React.ReactNode;className?: string;
  /**
   * Set `status` when this callout is the confirmation that something worked,
   * and `alert` when it is a failure. Without one, a callout that appears in
   * response to an action is announced to nobody — it is only ever seen by
   * someone already looking at that part of the page.
   */
  role?: 'status' | 'alert';}) {
  const tones = {
    info: 'bg-teal-tint border-teal-selected text-ink-secondary',
    warn: 'bg-clay-tint border-clay/40 text-clay-dark'
  };
  /**
   * A 3px bar down the leading edge, in the tone's own colour.
   *
   * A callout is the app interrupting to say something, and a tinted rectangle
   * with a hairline was easy to skim straight past on a busy screen. The bar
   * gives it a spine — enough weight to stop the eye without the shouting a full
   * saturated banner would do to somebody who is already anxious about getting
   * their labelling wrong. It is `border-l-[3px]` rather than a pseudo-element so
   * the padding stays honest and nothing overlaps the text.
   */
  const spines = {
    info: 'border-l-[3px] border-l-teal',
    warn: 'border-l-[3px] border-l-clay'
  };
  return (
    <div
      role={role}
      className={twMerge(
        'rounded-control border px-4 py-3.5 text-[0.8125rem] leading-relaxed',
        tones[tone],
        spines[tone],
        className
      )}>

      {title && <p className="mb-1 font-display font-medium text-ink">{title}</p>}
      {children}
    </div>);

}

/**
 * The screen for something that is legitimately not there yet.
 *
 * The icon used to be a bare glyph sitting on the panel, at the same weight as
 * everything else, so it read as a stray mark above the heading rather than as
 * the illustration of the empty thing. It now sits in a ruled tile, which gives
 * the block a fixed point to start from and lets the heading sit beside real
 * space instead of under clutter.
 *
 * Still left-aligned and still dashed. A dashed edge says "a container that has
 * not been filled" in a way a solid one does not, and centring the block would
 * make it look like an error page — which is the one thing this must never be
 * mistaken for, because on this app an empty state is usually good news arriving
 * at the start of somebody's first session.
 */
export function EmptyState({
  icon,
  title,
  body,
  action





}: {icon?: React.ReactNode;title: string;body: string;action?: React.ReactNode;}) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-card border border-dashed border-paper-rule bg-paper-panel/50 px-6 py-9 sm:px-8">
      {icon &&
      <span className="flex h-11 w-11 items-center justify-center rounded-control border border-paper-line bg-paper-raised text-ink-tertiary shadow-card">
          {icon}
        </span>
      }
      <div className="max-w-prose">
        <h3 className="font-display text-lg font-semibold tracking-tight text-ink">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">{body}</p>
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>);

}

/**
 * A checkbox with a label and an optional second line.
 *
 * The description is wired with aria-describedby rather than left as loose text
 * beside the control, so what a sighted maker reads under the label is also what
 * a screen reader announces with it. That matters most where the description is
 * the part carrying the meaning — "unsubscribe any time" is the reassurance the
 * box is asking someone to trust.
 */
export function Checkbox({
  id,
  checked,
  onChange,
  disabled,
  label,
  description,
  className




}: {id: string;checked: boolean;onChange: (checked: boolean) => void;disabled?: boolean;label: React.ReactNode;description?: React.ReactNode;className?: string;}) {
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <div className={twMerge('flex items-start gap-3', className)}>
      {/*
        WAS h-4 w-4 — a 16px hit target, which is under the 24px minimum SC 2.5.8
        sets and a genuinely difficult thing to hit on a phone in a workshop, which
        is where this app is used. It is 18px now, with the label beside it doing
        the rest of the work: `htmlFor` makes the whole label a target too, so the
        real area is the box plus the sentence next to it.

        The border is `paper-edge` for the same reason the inputs are — an
        unchecked box drawn in `paper-line` was a 1.2:1 outline, so on the consent
        rows the only reliable way to tell checked from unchecked was to click it.
       */}
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={descriptionId}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-px h-[18px] w-[18px] flex-none cursor-pointer rounded-[5px] border-paper-edge accent-teal disabled:cursor-not-allowed disabled:opacity-50" />

      <div className="min-w-0">
        <label htmlFor={id} className="block cursor-pointer text-sm font-medium leading-snug text-ink">
          {label}
        </label>
        {description &&
        <p id={descriptionId} className="mt-1 text-2xs leading-relaxed text-ink-tertiary">
            {description}
          </p>
        }
      </div>
    </div>);

}

/**
 * An error that is announced when it appears.
 *
 * `role="alert"` rather than a styled paragraph: a message that only exists
 * visually is invisible to anyone whose focus has already moved past it, which
 * on a form is everyone who just pressed the button.
 */
export function FormError({ id, children }: {id?: string;children: React.ReactNode;}) {
  return (
    <p id={id} role="alert" className="text-[0.8125rem] font-medium text-clay-dark">
      {children}
    </p>);

}

/** Confirmation that something saved. Announced politely, not as an alert. */
export function FormStatus({ children }: {children: React.ReactNode;}) {
  return (
    <p role="status" className="text-[0.8125rem] text-ink-secondary">
      {children}
    </p>);

}

/**
 * The visible key for the required asterisk, matching www's `RequiredKey`.
 *
 * Sighted readers see "Fields marked * are required." A screen reader hears
 * "Fields marked with an asterisk are required.", because the character itself
 * is hidden — read aloud it is just "star", which explains nothing.
 */
export function RequiredKey() {
  return (
    <p className="text-2xs text-ink-tertiary">
      Fields marked{' '}
      <span aria-hidden="true" className="font-medium text-clay-dark">*</span>
      <span className="sr-only">with an asterisk</span> are required.
    </p>);

}

/**
 * The required marker itself. Hidden from assistive tech, because the accessible
 * name carries "(required)" in words and `required` carries it in semantics.
 */
export function RequiredMark() {
  return (
    <>
      <span aria-hidden="true" className="ml-1 font-medium text-clay-dark">*</span>
      <span className="sr-only"> (required)</span>
    </>);

}

export function Skeleton({ className }: {className?: string;}) {
  return (
    <div
      className={twMerge('animate-pulse rounded-control bg-paper-panel', className)}
      // A skeleton is scaffolding, not content. Without this a screen reader walks
      // a loading products table and announces a dozen empty boxes; the loading
      // regions in this app already carry their own aria-busy and aria-label,
      // which is the thing that should be heard.
      aria-hidden="true" />);

}

export function Divider({ className }: {className?: string;}) {
  return <hr className={twMerge('border-0 border-t border-paper-line', className)} />;
}

/* ------------------------------------------------------------------ tables */

/**
 * ONE TABLE LANGUAGE, SHARED BY EVERY DENSE SCREEN IN THE APP.
 *
 * Products, the materials register, the specification's component list and the
 * batch records are the four screens a maker actually spends time in, and each
 * had hand-rolled its own table out of the same handful of utility classes —
 * `px-5 py-3`, a `bg-paper-panel/60` header, a `border-b border-paper-line` row.
 * They were near enough to look like a system and different enough that column
 * padding, header weight, hover colour and numeric alignment all drifted between
 * them. Comparing a figure on one screen with a figure on another meant
 * re-learning the furniture each time.
 *
 * What the shared version fixes that a copied utility string could not:
 *
 *   HEADERS STAY PUT. `.sticky-head` pins the header cells, so scrolling a
 *   register of ninety materials no longer leaves columns of numbers with
 *   nothing naming them.
 *
 *   NUMBERS LINE UP. `align="right"` on a numeric column, and tabular figures
 *   set globally in index.css, so a column of percentages or net weights can be
 *   compared down the page instead of read one at a time.
 *
 *   HEADER INK GOT DARKER. It was `text-ink-tertiary` on the panel fill, 4.87:1
 *   at 11px upper case. Passing, and thin. `text-ink-secondary` on the sunken
 *   band is 7.61:1 for the same eleven pixels.
 *
 *   THE HOVER IS WARM, NOT TEAL. Rows used to wash `teal-tint` on hover, which is
 *   the same green this app uses to mean "nothing outstanding" — so running the
 *   pointer down a table lit up each row in the colour of a verdict. The hover is
 *   now a neutral warm band that carries no meaning at all.
 *
 * The scroll container is a `<div role="region">` with a `tabIndex` supplied by
 * the caller's `label`, because a horizontally scrollable area that cannot be
 * reached from the keyboard is unreachable content for anyone not using a mouse.
 */
export function TableFrame({
  label,
  children,
  className




}: {label: string;children: React.ReactNode;className?: string;}) {
  return (
    <Card className={twMerge('overflow-hidden', className)}>
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        className="max-h-[70vh] overflow-auto">

        {children}
      </div>
    </Card>);

}

export function Table({
  children,
  minWidth = 760,
  className




}: {children: React.ReactNode;minWidth?: number;className?: string;}) {
  return (
    <table
      style={{ minWidth: `${minWidth}px` }}
      className={twMerge('w-full border-collapse text-left text-sm', className)}>

      {children}
    </table>);

}

export function THead({ children }: {children: React.ReactNode;}) {
  return <thead className="sticky-head">{children}</thead>;
}

export function TR({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={twMerge(
        'border-b border-paper-line transition-colors last:border-0',
        className
      )}
      {...props}>

      {children}
    </tr>);

}

type CellAlign = 'left' | 'right';

const alignClass: Record<CellAlign, string> = {
  left: 'text-left',
  right: 'text-right'
};

export function TH({
  children,
  align = 'left',
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & {align?: CellAlign;}) {
  return (
    <th
      scope="col"
      className={twMerge(
        'whitespace-nowrap border-b border-paper-rule bg-paper-sunken px-4 py-2.5 text-2xs font-medium uppercase tracking-[0.1em] text-ink-secondary',
        alignClass[align],
        className
      )}
      {...props}>

      {children}
    </th>);

}

export function TD({
  children,
  align = 'left',
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & {align?: CellAlign;}) {
  return (
    <td
      className={twMerge('px-4 py-3 align-top text-ink-secondary', alignClass[align], className)}
      {...props}>

      {children}
    </td>);

}

/**
 * The warm hover for a row that leads somewhere.
 *
 * Exported as a string rather than baked into `TR`, because not every row in the
 * app is a link — the specification's component rows are edited in place, and
 * lighting them under the pointer would promise a navigation that never happens.
 *
 * `focus-within` is the half that was missing everywhere. Several of these tables
 * navigate on a row click, with a real link in the first cell doing the keyboard
 * work; without this, tabbing through the table moved a focus ring down the page
 * with no indication of which ROW it was in, which on a five column table is the
 * information you actually need.
 */
export const rowLinkClass =
'cursor-pointer hover:bg-paper-panel focus-within:bg-paper-panel';