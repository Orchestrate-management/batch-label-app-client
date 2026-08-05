import React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  size?: 'sm' | 'md';
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonProps) {
  const base =
  'inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none';
  const sizes = {
    sm: 'h-9 px-3 text-[0.8125rem]',
    md: 'h-11 px-4 text-sm'
  };
  const variants = {
    primary: 'bg-teal text-paper hover:bg-teal-hover active:bg-teal-hover',
    secondary:
    'bg-paper border border-paper-line text-ink hover:bg-paper-panel active:bg-paper-panel',
    quiet: 'text-ink-secondary hover:bg-paper-panel',
    danger: 'bg-paper border border-clay text-clay-dark hover:bg-clay-tint'
  };
  return <button className={twMerge(base, sizes[size], variants[variant], className)} {...props} />;
}

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={twMerge('rounded-card border border-paper-line bg-paper', className)}
      {...props}>
      
      {children}
    </div>);

}

export function SectionTitle({
  children,
  className



}: {children: React.ReactNode;className?: string;}) {
  return (
    <h2
      className={twMerge(
        'font-display text-[0.8125rem] font-medium uppercase tracking-[0.14em] text-ink-tertiary',
        className
      )}>
      
      {children}
    </h2>);

}

type PillTone = 'neutral' | 'good' | 'warn' | 'quiet';

export function Pill({
  tone = 'neutral',
  children,
  className




}: {tone?: PillTone;children: React.ReactNode;className?: string;}) {
  const tones: Record<PillTone, string> = {
    neutral: 'bg-paper-panel text-ink-secondary border-paper-line',
    good: 'bg-teal-tint text-teal-hover border-teal-selected',
    warn: 'bg-clay-tint text-clay-dark border-clay/30',
    quiet: 'bg-transparent text-ink-tertiary border-paper-line'
  };
  return (
    <span
      className={twMerge(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-2xs font-medium',
        tones[tone],
        className
      )}>
      
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
 */
const inputBase =
'w-full rounded-control border border-paper-line bg-paper px-3 py-2.5 text-sm text-ink placeholder:text-ink-tertiary transition-colors focus:border-teal disabled:cursor-not-allowed disabled:border-paper-line disabled:bg-paper-panel disabled:text-ink-tertiary';

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
 * A dropdown whose OPEN list belongs to this app rather than to the operating system.
 *
 * A native `<select>` has two halves. The closed control is fully styleable and was
 * fixed first: `appearance-none` had stripped the native chevron and `pr-8` reserved
 * room for a replacement nobody drew, so every dropdown rendered as a text-input-shaped
 * box with an unexplained gap and no sign it could be opened. The open list is the other
 * half, and no stylesheet can reach it — it is OS chrome. On macOS that is a grey panel,
 * the system font, a system checkmark and square corners, dropped into the middle of a
 * warm paper-and-ink design system. Nothing about the closed control could fix that,
 * which is why the element itself had to go.
 *
 * SO THERE IS A HEADLESS UI LIBRARY IN THIS REPO NOW — the first one, in a codebase
 * otherwise hand-rolled on Tailwind and lucide-react. That is a deliberate line to
 * cross, not an accident of reaching for a package. The accessible surface of a listbox
 * is large and unforgiving: roving focus, printable-character type-ahead, Home/End,
 * Escape, click-outside, focus return to the trigger, scrolling the selected option into
 * view on open, and the `role="listbox"`/`role="option"` pairing screen readers key off.
 * A native `<select>` gives all of that for free, and the moment you replace it you own
 * every line of it forever. These particular selects choose GHS pictograms, signal words
 * and hazard statements: on a compliance product a half-right listbox is a worse outcome
 * than an ugly correct one. Radix Select implements exactly that surface, is widely
 * deployed, and is the smallest thing that does the job — React Aria brings a whole
 * collections/i18n system for one control, and Headless UI's listbox is the same bet with
 * a smaller maintenance base.
 *
 * THE CALL SITES DID NOT CHANGE, and that is load-bearing. All 23 of them still pass
 * `value`, `onChange` and `<option>` children, so `MaterialSelect` in Specification.tsx
 * still renders its loading, error and empty-register states as options and prose without
 * knowing any of this happened. The children are read into a list below rather than
 * rendered, because Radix needs items it can enumerate.
 */

/**
 * Radix rejects an item whose value is the empty string — it reserves `''` for "nothing
 * is selected", which is how its placeholder works. This app uses `<option value="">` as
 * a real, choosable answer with real copy on it ("Not chosen", "Every product",
 * "Everything"), and "not chosen" is a different statement from "not answered" on a form
 * that feeds a classification. So the empty string is carried across the Radix boundary
 * under a sentinel and turned back at both edges: the parent never sees this string.
 */
const EMPTY_OPTION_VALUE = '__batchlabel_empty_option__';

const toItemValue = (value: string) => value === '' ? EMPTY_OPTION_VALUE : value;
const fromItemValue = (value: string) => value === EMPTY_OPTION_VALUE ? '' : value;

type SelectOption = {
  value: string;
  label: React.ReactNode;
  /** What type-ahead matches on, and what the trigger falls back to. */
  text: string;
  disabled: boolean;
};

/** The text inside a node, for type-ahead. Mirrors what `option.textContent` would be. */
function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement(node)) {
    return textOf((node.props as {children?: React.ReactNode;}).children);
  }
  return '';
}

/**
 * The `<option>` children, read as data.
 *
 * Fragments and `optgroup` are walked through rather than ignored, so an option can never
 * silently fail to appear — the one failure mode of reading children instead of rendering
 * them. An `optgroup`'s heading is NOT drawn (that would want `Select.Group` and
 * `Select.Label`); nothing in this app uses one today, and its options still show.
 */
function optionsFrom(children: React.ReactNode, into: SelectOption[] = []): SelectOption[] {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
    if (child.type === React.Fragment || child.type === 'optgroup') {
      optionsFrom(props.children, into);
      return;
    }
    if (child.type !== 'option') return;
    const text = textOf(props.children);
    into.push({
      // A native `<option>` with no `value` takes its text as its value. Same here.
      value: props.value === undefined ? text : String(props.value),
      label: props.children,
      text,
      disabled: Boolean(props.disabled)
    });
  });
  return into;
}

/**
 * The shape both renderers take.
 *
 * `onChange` is deliberately not `React.ChangeEventHandler` — there is no longer a
 * `<select>` to raise a change event — but it keeps the `event.target.value` shape every
 * call site already destructures, so a real change event still satisfies it and not one
 * of the 23 handlers had to be rewritten.
 */
type SelectProps = {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (event: {target: {value: string;};}) => void;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  className?: string;
  /** Shown when nothing matches the current value. Rarely needed: most lists carry their own "not chosen" option. */
  placeholder?: string;
  children?: React.ReactNode;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
};

const scrollButtonClass =
'flex h-6 flex-none cursor-default items-center justify-center bg-paper text-ink-tertiary';

const triggerClass =
'group flex cursor-pointer items-center justify-between gap-2 text-left hover:border-ink-tertiary ' +
'disabled:hover:border-paper-line data-[state=open]:border-teal data-[placeholder]:text-ink-tertiary';

/**
 * The native `<select>`, kept whole and kept working.
 *
 * NOT DEAD CODE, AND NOT A SECOND UI TO MAINTAIN. It is one branch, one line away from
 * being switched back on, and it exists because the phone question is still open: Radix
 * renders its own popup on touch too, so a maker on a phone loses the iOS and Android
 * picker wheels, which are better one-handed in a workshop than anything we would build.
 * Rhys has not chosen yet. If the answer is "native on phones", the whole change is the
 * commented line in `Select` below — same props, same children, same `onChange`. A test
 * renders this component directly so the branch cannot rot while it waits.
 */
export function NativeSelect({
  className,
  children,
  disabled,
  onChange,
  placeholder,
  ...props
}: SelectProps) {
  // Pulled out of the spread rather than passed on: `placeholder` belongs to the listbox,
  // and a native `<select>` shows its first option instead. Leaving it in would put a
  // `placeholder` attribute on an element that has no use for one.
  void placeholder;
  return (
    <span className="group relative block w-full">
      <select
        disabled={disabled}
        onChange={(event) => onChange?.({ target: { value: event.target.value } })}
        className={twMerge(
          inputBase,
          'cursor-pointer appearance-none pr-10 hover:border-ink-tertiary disabled:hover:border-paper-line',
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

/** The styled listbox. Same surface, border, radius and shadow as the account menu in AppShell. */
function ListboxSelect({
  className,
  children,
  disabled,
  value,
  defaultValue,
  onChange,
  placeholder,
  ...props
}: SelectProps) {
  const options = optionsFrom(children);
  const [open, setOpen] = React.useState(false);

  return (
    <SelectPrimitive.Root
      open={open}
      onOpenChange={setOpen}
      value={value === undefined ? undefined : toItemValue(String(value))}
      defaultValue={defaultValue === undefined ? undefined : toItemValue(String(defaultValue))}
      disabled={disabled}
      onValueChange={(next) => {
        /**
         * A CHOICE IS ONLY A CHOICE IF IT IS ONE OF THE OPTIONS ON SCREEN.
         *
         * Radix mirrors the value onto a hidden `<select>` so the control still participates
         * in a form, and it bubbles a real `change` event off that element whenever the value
         * moves. Two of this app's dropdowns get their options and their value in the same
         * tick — the recall version picker, and every `MaterialSelect` while the register is
         * still loading — and on that tick the mirror has no matching `<option>` yet, so the
         * browser quietly resets it to the empty string and the bubbled event tells us the
         * maker chose nothing. They chose nothing. Passing that on wiped the selection: the
         * version picker came back blank and its Search button stayed disabled.
         *
         * So a value that names no option we rendered is not forwarded. Nothing is lost —
         * a maker can only click an option that exists — and the parent is never told about
         * a selection it did not make.
         */
        if (!options.some((option) => toItemValue(option.value) === next)) return;
        onChange?.({ target: { value: fromItemValue(next) } });
      }}>

      <SelectPrimitive.Trigger
        className={twMerge(inputBase, triggerClass, className)}
        onClick={(event) => {
          /**
           * `Field` wraps its children in a `<label>`, and a label forwards a click on its
           * own text to the control it labels. A native `<select>` opened on that forwarded
           * click. A button does not, because Radix opens on `pointerdown` and a forwarded
           * click has no pointerdown before it — so without this, clicking the word "Market"
           * would focus the control and leave the list shut. `detail === 0` is exactly the
           * synthetic click; a real pointer click carries `detail >= 1` and is left alone.
           * `open` is controlled here only so this line has something to call.
           */
          if (event.detail === 0 && !disabled) setOpen(true);
        }}
        {...props}>

        <span className="block min-h-[1.25rem] truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown
            aria-hidden="true"
            className={twMerge(
              'h-4 w-4 flex-none transition group-data-[state=open]:rotate-180',
              disabled ? 'text-ink-tertiary/60' : 'text-ink-secondary group-hover:text-ink'
            )} />

        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      {/*
        Portalled to the body on purpose. Two of these live inside NewProductDialog and
        RecordBatchDialog, whose panel is `max-h-[90vh] overflow-y-auto` — an in-place
        popup would be clipped by that scroll box. Neither dialog closes on outside-click
        or Escape, so nothing outside the popup reacts to a click landing in it, and the
        overlay is `z-40` to this `z-50`.
       */}
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          onKeyDown={(event) => {
            /**
             * TAB GETS YOU OUT. Radix traps focus inside an open popup, so Tab cycles
             * between the options and a maker who pressed it expecting to move on stays
             * where they were, with no sign why. A native `<select>` closed on Tab, so
             * this one does too — Radix hands focus back to the control on close, and the
             * next Tab leaves the field the way every other Tab in the app does.
             */
            if (event.key === 'Tab') setOpen(false);
          }}
          className={
          'listbox-popup z-50 flex max-h-[min(20rem,var(--radix-select-content-available-height))] ' +
          'w-[var(--radix-select-trigger-width)] min-w-[10rem] flex-col overflow-hidden ' +
          'rounded-control border border-paper-line bg-paper p-1.5 ' +
          /*
            The marketing site's raised-surface shadow, to the value. Tailwind's `shadow-lg`
            is a neutral black and goes grey over warm paper; www lifts its label preview and
            its cookie banner off the same ground with an INK-tinted one, and a maker crossing
            between the two surfaces should not be able to tell they were drawn by different
            people. `bg-paper` rather than a lighter fill for the same reason the Card uses
            it: in this app the popup is the same material as the control it came out of, and
            the border plus this shadow are what separate them.
          */
          'shadow-[0_1px_0_rgba(27,37,35,0.04),0_18px_40px_-28px_rgba(27,37,35,0.55)]'
          }>

          {/*
            Opaque, not just an icon. These only appear when the list is taller than the popup,
            and they sit over the ends of the scrolling area — without a fill of their own the
            row underneath shows through them half-cut, which reads as a rendering fault rather
            than as "there is more above".
           */}
          <SelectPrimitive.ScrollUpButton className={scrollButtonClass}>
            <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" />
          </SelectPrimitive.ScrollUpButton>

          <SelectPrimitive.Viewport>
            {options.map((option) =>
            <SelectPrimitive.Item
              key={option.value}
              value={toItemValue(option.value)}
              textValue={option.text}
              disabled={option.disabled}
              className={
              'relative flex cursor-pointer select-none items-center rounded-control py-2 pl-3 pr-9 ' +
              'text-sm text-ink outline-none transition-colors data-[highlighted]:bg-paper-panel ' +
              'data-[state=checked]:bg-teal-tint data-[state=checked]:font-medium ' +
              'data-[disabled]:cursor-not-allowed data-[disabled]:text-ink-tertiary ' +
              'data-[disabled]:data-[highlighted]:bg-transparent'
              }>

                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-3 flex items-center">
                  <Check aria-hidden="true" className="h-4 w-4 text-teal" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            )}
          </SelectPrimitive.Viewport>

          <SelectPrimitive.ScrollDownButton className={scrollButtonClass}>
            <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>);

}

/**
 * THE ONE PLACE THE PHONE DECISION GETS MADE.
 *
 * Everything is the styled listbox today. To hand touch devices their native picker back,
 * uncomment the line below — that is the entire change, because `NativeSelect` takes the
 * same props and the same `<option>` children. `(pointer: coarse)` rather than a width
 * breakpoint: what decides this is whether there is a picker wheel to hand back, not how
 * wide the screen is, and a touchscreen laptop at 1400px wants the wheel while a phone in
 * a desktop-width iframe does not.
 *
 *   const coarse = useMediaQuery('(pointer: coarse)');
 *   if (coarse) return <NativeSelect {...props} />;
 */
export function Select(props: SelectProps) {
  return <ListboxSelect {...props} />;
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
    warn: 'bg-clay-tint border-clay/30 text-clay-dark'
  };
  return (
    <div
      role={role}
      className={twMerge('rounded-control border px-4 py-3 text-[0.8125rem]', tones[tone], className)}>

      {title && <p className="mb-1 font-medium text-ink">{title}</p>}
      {children}
    </div>);

}

export function EmptyState({
  icon,
  title,
  body,
  action





}: {icon?: React.ReactNode;title: string;body: string;action?: React.ReactNode;}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-card border border-dashed border-paper-line bg-paper-panel/60 px-6 py-8">
      {icon && <span className="text-ink-tertiary">{icon}</span>}
      <div className="max-w-prose">
        <h3 className="font-display text-base font-medium text-ink">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{body}</p>
      </div>
      {action}
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
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={descriptionId}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 flex-none accent-teal disabled:opacity-50" />

      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          {label}
        </label>
        {description &&
        <p id={descriptionId} className="mt-0.5 text-2xs leading-relaxed text-ink-tertiary">
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
  return <div className={twMerge('animate-pulse rounded-control bg-paper-panel', className)} />;
}

export function Divider({ className }: {className?: string;}) {
  return <hr className={twMerge('border-0 border-t border-paper-line', className)} />;
}