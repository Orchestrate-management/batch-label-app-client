import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronUpIcon,
  CreditCardIcon,
  LayoutGridIcon,
  LogOutIcon,
  PackageIcon,
  SettingsIcon } from
'lucide-react';
import { Logo } from './Logo';
import { BUSINESS, TEAM } from '../lib/products';

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{className?: string;strokeWidth?: number;}>;
  end?: boolean;
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

}];


const MOBILE_NAV = [
{ to: '/', label: 'Studio', end: true },
{ to: '/products', label: 'Products' },
{ to: '/materials/ingredient', label: 'Materials', indent: true },
{ to: '/records', label: 'Records', indent: true },
{ to: '/settings/identity', label: 'Settings' }];


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
            const selfActive = item.end ? path === '/' : path === item.to || path.startsWith(`${item.to}/`);
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
        {children}
      </div>
    </div>);

}

/**
 * The conventional home for configuration: under your own name, bottom left.
 * Settings is set once during onboarding and rarely revisited, and the pipeline
 * links into it directly whenever a field it needs is missing.
 */
function AccountMenu() {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const owner = TEAM.find((member) => member.role === 'Owner') ?? TEAM[0];

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
        
          <button
          type="button"
          role="menuitem"
          className={itemClass}
          onClick={() => navigate('/settings/identity')}>
          
            <SettingsIcon className="h-4 w-4" strokeWidth={1.25} aria-hidden="true" />
            Settings
          </button>
          <button
          type="button"
          role="menuitem"
          className={itemClass}
          onClick={() => navigate('/settings/billing')}>
          
            <CreditCardIcon className="h-4 w-4" strokeWidth={1.25} aria-hidden="true" />
            Billing
          </button>
          <div className="my-1.5 border-t border-white/10" />
          <button type="button" role="menuitem" className={itemClass} onClick={() => setOpen(false)}>
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
          {owner.name.
          split(' ').
          map((part) => part[0]).
          join('')}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-sm text-white">
            {BUSINESS.tradingName}
          </span>
          <span className="mt-0.5 block truncate text-2xs text-white/60">
            {owner.name}, {owner.role.toLowerCase()}
          </span>
        </span>
        <ChevronUpIcon
          className={`h-4 w-4 flex-none text-white/60 transition-transform ${
          open ? '' : 'rotate-180'}`
          }
          strokeWidth={1.25}
          aria-hidden="true" />
        
      </button>
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