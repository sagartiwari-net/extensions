'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  CookieIcon,
  PuzzleIcon,
  FileCodeIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  PackageIcon,
  PlayIcon,
  ServerIcon,
  ScrollTextIcon,
  ShieldIcon,
  StoreIcon,
  UserRoundIcon,
  WrenchIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const nav = [
  {
    label: 'Operations',
    items: [
      { href: '/dashboard', label: 'Overview', icon: LayoutDashboardIcon, roles: ['master', 'reseller'] },
      { href: '/tools', label: 'Tools', icon: WrenchIcon, roles: ['master', 'reseller'] },
      { href: '/pools', label: 'Tool groups', icon: CookieIcon, roles: ['master'] },
      { href: '/access', label: 'Access', icon: PlayIcon, roles: ['master', 'reseller'] },
    ],
  },
  {
    label: 'Rules & security',
    items: [
      { href: '/rules', label: 'Rules', icon: FileCodeIcon, roles: ['master', 'reseller'] },
      { href: '/security', label: 'Security', icon: ShieldIcon, roles: ['master', 'reseller'] },
      { href: '/extensions', label: 'Extensions', icon: PuzzleIcon, roles: ['master', 'reseller'] },
      { href: '/my-extension', label: 'My extension', icon: PackageIcon, roles: ['master', 'reseller'] },
      { href: '/reports', label: 'Launch reports', icon: ScrollTextIcon, roles: ['master', 'reseller'] },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { href: '/resellers', label: 'Resellers', icon: StoreIcon, roles: ['master'] },
      { href: '/profiles', label: 'Proxy / UA', icon: ServerIcon, roles: ['master', 'reseller'] },
      { href: '/account', label: 'Account', icon: UserRoundIcon, roles: ['master', 'reseller'] },
    ],
  },
];

function isActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard' || pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarNav({
  role,
  pathname,
  onNavigate,
}: {
  role: string;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 overflow-y-auto px-2 pb-4">
      {nav.map((group) => {
        const items = group.items.filter((item) => item.roles.includes(role));
        if (!items.length) return null;
        return (
          <div key={group.label} className="mb-4">
            <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">{group.label}</div>
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => {
                const Icon = item.icon;
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors',
                        active
                          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                          : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground',
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function SidebarBrand() {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-4">
      <span className="text-sm font-medium">1Clk Access</span>
      <span className="text-sm text-muted-foreground">Admin v2</span>
    </div>
  );
}

function SidebarUser({
  username,
  role,
  onLogout,
}: {
  username: string;
  role: string;
  onLogout: () => void;
}) {
  const initial = username.slice(0, 1).toUpperCase();
  return (
    <div className="border-t border-sidebar-border p-3">
      <div className="mb-2 flex items-center gap-2 px-1">
        <div className="flex size-7 items-center justify-center rounded-full bg-foreground text-xs font-medium text-background">
          {initial}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{username}</div>
          <div className="text-xs text-muted-foreground">{role}</div>
        </div>
      </div>
      <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={onLogout}>
        <LogOutIcon />
        Log out
      </Button>
    </div>
  );
}

export function Shell({
  children,
  user,
}: {
  children: ReactNode;
  user: { username: string; role: string };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    router.replace('/');
  }

  return (
    <div className="flex min-h-svh bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <SidebarBrand />
        <SidebarNav role={user.role} pathname={pathname} />
        <SidebarUser username={user.username} role={user.role} onLogout={() => void logout()} />
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          showCloseButton
          className="w-72 gap-0 bg-sidebar p-0 text-sidebar-foreground sm:max-w-72"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>Admin menu</SheetDescription>
          </SheetHeader>
          <div className="flex h-full flex-col">
            <SidebarBrand />
            <SidebarNav
              role={user.role}
              pathname={pathname}
              onNavigate={() => setMobileOpen(false)}
            />
            <SidebarUser
              username={user.username}
              role={user.role}
              onLogout={() => {
                setMobileOpen(false);
                void logout();
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b bg-background px-3 md:px-4">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="shrink-0 md:hidden"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
          >
            <MenuIcon />
          </Button>
          <span className="truncate text-sm text-muted-foreground">
            {user.username} · {user.role}
          </span>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

export function PanelCard({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border bg-card text-card-foreground', className)}>
      {title ? (
        <>
          <div className="px-4 py-3 text-sm font-medium">{title}</div>
          <Separator />
        </>
      ) : null}
      <div className="p-4">{children}</div>
    </div>
  );
}
