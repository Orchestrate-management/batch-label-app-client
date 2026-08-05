import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronUpIcon,
  CreditCardIcon,
  LayoutGridIcon,
  LogOutIcon,
  PackageIcon,
  SettingsIcon,
  type LucideIcon } from
'lucide-react';
import { Logo } from './Logo';
import { SchemaNotServed } from './SchemaNotServed';
import { useAuth } from '../lib/auth';
import { useEntitlement } from '../lib/entitlement';

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /**
   * Where this item counts as selected, when that is wider than where it links.
   * Settings links to its first tab and has to stay lit on all of them; without
   * this, a maker on Preferences sees nothing selected.
   */
  match?: string;
  children?: Array<{to: string;label: string;match: string;}>;
};

/**
 * Products is the spine. Materials go in and runs come out, and neither means
 * anything without a product, so both sit beneath it rather than beside it.
 * Outputs have no destination of their own: the rail is the only place an
 * output is ever seen.
 */
const NAV: NavItem[] = [
{ to: '/', label: 'Studio', icon: LayoutGridIcon, end: true },
{
  to: '/products',
  label: 'Products',
  icon: PackageIcon,
  children: [
  { to: '/materials/ingredient', label: 'Materials', match: '/materials' },
  { to: '/records', label: 'Records', match: '/records' }]

},
/**
 * Settings belongs here rather than behind the account menu, and `match` is why
 * it takes a bit of care: the link goes to the first tab, but the item has to
 * stay lit on all of them. Without it, a maker on Preferences sees nothing
 * selected and no indication of where they are.
 *
 * Deliberately NOT matching `/billing`. Billing is its own page, not a tab, and
 * lighting Settings while somebody is buying a plan would say otherwise.
 */
{ to: '/settings/identity', label: 'Settings', icon: SettingsIcon, match: '/settings' }];


/**
 * The account menu is desktop only, so on a phone this strip is the whole of the
 * navigation — which is why Billing is on it. Billing is the one destination that
 * is not a Settings tab, so without an entry here a maker on a phone could not
 * reach their plan at all.
 *
 * There is no longer a separate Account entry. It was here because the password
 * lives on a tab called Account and a maker had no reason to know that; the
 * answer is the Settings entry beside it, not a second link to one of its tabs.
 *
 * SIGN OUT IS STILL REACHABLE ON A PHONE, one tap further in: Settings, then the
 * Account tab, which carries its own sign-out button for exactly this reason —
 * see the note above it in components/settings/AccountTab.tsx. This menu is
 * desktop-only, so it was never the mobile answer.
 */
const MOBILE_NAV = [
{ to: '/', label: 'Studio', end: true },
{ to: '/products', label: 'Products' },
{ to: '/materials/ingredient', label: 'Materials', indent: true },
{ to: '/records', label: 'Records', indent: true },
{ to: '/settings/identity', label: 'Settings' },
{ to: '/billing', label: 'Billing' }];


export function AppShell({ children }: {children: React.ReactNode;}) {
  const location = useLocation();
  const path = location.pathname;

  const isBranchActive = (item: NavItem) => {
    if (item.end) return path === '/';
    if (path.startsWith(item.to)) return true;
    return Boolean(item.children?.some((child) => path.startsWith(child.match)));
  };

  const rowClass = (active: boolean) =>
  `flex items-center gap-3 rounded-control px-3 py-2.5 text-sm transition-colors ${
  active ? 'bg-teal text-white' : 'text-white/70 hover:bg-teal/40 hover:text-white'}`;


  return (
    <div className="surface-shift flex min-h-screen w-full bg-paper">
      <nav
        className="sticky top-0 hidden h-screen w-[248px] flex-none flex-col border-r border-teal-dark/40 bg-teal-dark px-4 py-6 md:flex"
        aria-label="Main">
        
        <div className="px-2">
          <Logo variant="reversed" size={30} />
        </div>

        <ul className="mt-8 space-y-1">
          {NAV.map((item) => {
            const Icon = item.icon;
            const branchActive = isBranchActive(item);
            const selfActive = item.match ?
            path.startsWith(item.match) :
            item.end ? path === '/' : path === item.to || path.startsWith(`${item.to}/`);
            return (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} className={rowClass(selfActive)}>
                  <Icon className="h-[18px] w-[18px]" strokeWidth={1.25} aria-hidden="true" />
                  {item.label}
                </NavLink>
                {item.children &&
                <ul
                  className={`ml-[21px] mt-1 space-y-1 border-l pl-3 ${
                  branchActive ? 'border-white/25' : 'border-white/10'}`
                  }>
                  
                    {item.children.map((child) => {
                    const active = path.startsWith(child.match);
                    return (
                      <li key={child.to}>
                          <NavLink
                          to={child.to}
                          className={`flex items-center rounded-control px-3 py-2 text-[0.8125rem] transition-colors ${
                          active ?
                          'bg-teal text-white' :
                          'text-white/60 hover:bg-teal/30 hover:text-white'}`
                          }>
                          
                            {child.label}
                          </NavLink>
                        </li>);

                  })}
                  </ul>
                }
              </li>);

          })}
        </ul>

        <div className="mt-auto">
          <AccountMenu />
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <nav
          className="flex gap-1 overflow-x-auto bg-teal-dark px-3 py-2 md:hidden"
          aria-label="Main">
          
          {MOBILE_NAV.map((item) =>
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
            `flex items-center gap-1.5 whitespace-nowrap rounded-control px-3 py-2 text-[0.8125rem] ${
            isActive ? 'bg-teal text-white' : 'text-white/70'}`

            }>
            
              {item.indent && <span className="opacity-40" aria-hidden="true">·</span>}
              {item.label}
            </NavLink>
          )}
        </nav>
        {/* Above every screen and outside the routed boundary, because the fault it names is
            not one screen's — see components/SchemaNotServed.tsx. Renders nothing unless the
            transport has actually seen PostgREST refuse the schema. */}
        <SchemaNotServed />
        {children}
      </div>
    </div>);

}

/**
 * Who you are signed in as, and the two things that are not configuration:
 * billing, and signing out.
 *
 * It used to hold Settings and Account as well, which made it a second route to
 * screens the Settings tab strip already owned — two paths to one place, and no
 * rule about which was real. Settings is on the main navigation now and its tabs
 * are its own business. What is left here is what does not belong on that strip:
 * a purchase, which has its own page because Stripe returns a customer to it,
 * and a sign-out, which is not a setting.
 */
function AccountMenu() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut, signOutFailure } = useAuth();
  const entitlement = useEntitlement();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // The business name on the membership is what the maker typed when they signed
  // up on www, so it is the true one. The fallback is deliberately generic rather
  // than a plausible business name: this strip is the first thing on screen, and a
  // name here that belongs to somebody else is the fixture that reads most like a
  // setting. It covers the beat before the read resolves, and the case where the
  // field was never filled in.
  const businessName = entitlement.businessName ?? 'Your business';
  const email = user?.email ?? null;
  const initials = businessName.
  split(/\s+/).
  filter(Boolean).
  slice(0, 2).
  map((part: string) => part[0]).
  join('').
  toUpperCase();

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const itemClass =
  'flex w-full items-center gap-2.5 rounded-control px-3 py-2 text-left text-[0.8125rem] text-white/75 transition-colors hover:bg-teal/40 hover:text-white';

  return (
    <div ref={ref} className="relative">
      {open &&
      <div
        className="absolute bottom-full left-0 right-0 mb-2 rounded-control border border-white/15 bg-teal-dark p-1.5 shadow-lg"
        role="menu"
        aria-label="Account">
        
          {/*
            SETTINGS IS NOT IN HERE ANY MORE, AND NEITHER IS ACCOUNT AND PASSWORD.
            Both were entries in this menu AND destinations on the Settings page's
            own tab strip, so the app had two routes to one screen and no rule
            about which was the real one. Settings is now on the main navigation
            beside Studio and Products — a page reached from the nav, whose tabs
            are its own business.

            The password argument that put "Account and password" here was sound
            and is now answered differently: this menu is the wrong place to solve
            it, because it is desktop-only, so it never solved it on a phone at
            all. What actually makes a password findable is Settings being visible
            without opening anything.

            BILLING STAYS. It is the one thing here that is not a Settings tab: it
            has its own route because it is where a purchase happens and where
            Stripe returns a customer afterwards, and a checkout landing inside a
            settings tab would be a strange place to be told a payment worked.
           */}
          <button
          type="button"
          role="menuitem"
          className={itemClass}
          onClick={() => navigate('/billing')}>

            <CreditCardIcon className="h-4 w-4" strokeWidth={1.25} aria-hidden="true" />
            Billing
          </button>
          <div className="my-1.5 border-t border-white/10" />
          <button
          type="button"
          role="menuitem"
          className={itemClass}
          onClick={() => {
            setOpen(false);
            // Clears the shared cookie, so this signs the maker out of the
            // marketing site too, then leaves for it — and if it could not, says so
            // below rather than leaving this menu's owner on a splash screen.
            // Dropped on purpose: the outcome is held by the provider as
            // `signOutFailure`, because this menu does not survive the attempt.
            void signOut();
          }}>

            <LogOutIcon className="h-4 w-4" strokeWidth={1.25} aria-hidden="true" />
            Sign out
          </button>
        </div>
      }

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex w-full items-center gap-3 rounded-control border px-3 py-3 text-left transition-colors ${
        open ? 'border-white/30 bg-teal/40' : 'border-white/15 hover:bg-teal/30'}`
        }>
        
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-white/15 font-display text-2xs font-medium text-white">
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-sm text-white">{businessName}</span>
          <span className="mt-0.5 block truncate text-2xs text-white/60">
            {email ?? 'Signed in'}
          </span>
        </span>
        <ChevronUpIcon
          className={`h-4 w-4 flex-none text-white/60 transition-transform ${
          open ? '' : 'rotate-180'}`
          }
          strokeWidth={1.25}
          aria-hidden="true" />
        
      </button>

      {/*
        A sign-out that did not take, said where the button that failed is.

        Below the trigger rather than inside the menu, because the menu is closed by the click
        and by every click after it, and a message you have to reopen a menu to find is one
        nobody reads. Clay-reversed is the accent for sitting on teal; the same sentence is on
        Settings > Account, which is the only route to signing out on a phone.

        The alternative was to say nothing, which is what this did before: the app went to
        "Checking your session…" and stayed there, still signed in, for as long as the tab
        was open.
       */}
      {signOutFailure &&
      <p
        role="alert"
        className="mt-2 rounded-control border border-clay-reversed/40 bg-clay-dark/25 px-3 py-2 text-2xs leading-relaxed text-clay-reversed">

          {signOutFailure}
        </p>
      }
    </div>);

}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta






}: {eyebrow?: React.ReactNode;title: string;description?: string;actions?: React.ReactNode;meta?: React.ReactNode;}) {
  return (
    <header className="border-b border-paper-line px-6 py-6 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-prose">
          {eyebrow &&
          <div className="mb-1 font-display text-[0.8125rem] font-medium uppercase tracking-[0.14em] text-ink-tertiary">
              {eyebrow}
            </div>
          }
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink lg:text-[1.75rem]">
            {title}
          </h1>
          {description &&
          <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{description}</p>
          }
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {meta && <div className="mt-4 flex flex-wrap items-center gap-2">{meta}</div>}
    </header>);

}