import React from 'react';
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

const inputBase =
'w-full rounded-control border border-paper-line bg-paper px-3 py-2.5 text-sm text-ink placeholder:text-ink-tertiary focus:border-teal focus:outline-none focus-visible:outline-none';

/**
 * forwardRef so a form can move focus to the box that is wrong. An error nobody
 * is taken to is an error most people do not find.
 */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={twMerge(inputBase, className)} {...props} />;
  }
);

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={twMerge(inputBase, 'appearance-none pr-8', className)} {...props}>
      {children}
    </select>);

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