import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Boxes,
  ChevronsLeft,
  ChevronsRight,
  Database,
  FlaskConical,
  LayoutDashboard,
  Menu,
  Moon,
  Orbit,
  Shapes,
  Sun,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";

import { api } from "../api/client";
import { cx } from "../lib/cx";
import { ProxyDisclaimer } from "./ProxyDisclaimer";
import { useTheme } from "./ThemeContext";
import { useToken } from "./TokenContext";
import { TokenSettings } from "./TokenSettings";
import { Tooltip } from "./ui/Tooltip";

const NAV: { to: string; label: string; icon: ReactNode; end?: boolean }[] = [
  { to: "/", label: "Overview", icon: <LayoutDashboard className="size-4.5" />, end: true },
  { to: "/datasets", label: "Datasets", icon: <Database className="size-4.5" /> },
  { to: "/batches", label: "Batch Optimization", icon: <FlaskConical className="size-4.5" /> },
  { to: "/structures", label: "Structures", icon: <Shapes className="size-4.5" /> },
  { to: "/viewer", label: "3D Viewer", icon: <Orbit className="size-4.5" /> },
  { to: "/status", label: "System status", icon: <Activity className="size-4.5" /> },
];

/** Section and detail crumbs for the top bar, derived from the URL. */
function crumbs(pathname: string): { label: string; to?: string }[] {
  const [, section, id] = pathname.split("/");
  const DETAIL: Record<string, [string, string, string]> = {
    datasets: ["Datasets", "/datasets", "Dataset"],
    batches: ["Batch Optimization", "/batches", "Batch"],
    designs: ["Datasets", "/datasets", "Design"],
  };
  if (!section) return [{ label: "Overview" }];
  const item = NAV.find((n) => n.to === `/${section}`);
  if (id && DETAIL[section]) {
    const [label, to, detail] = DETAIL[section];
    return [{ label, to }, { label: detail }];
  }
  return [{ label: item?.label ?? "Not found" }];
}

const COLLAPSE_KEY = "origami.sidebarCollapsed";
function initialCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

/** API reachability from the existing readiness check (only polled once a token is set). */
function ConnectionIndicator({ collapsed }: { collapsed: boolean }) {
  const { token } = useToken();
  const ready = useQuery({
    queryKey: ["readiness"],
    queryFn: api.readiness,
    enabled: Boolean(token),
    refetchInterval: 30_000,
  });
  const state = !token
    ? { label: "API not checked (no token)", dot: "bg-subtle" }
    : ready.isPending
      ? { label: "Checking API…", dot: "bg-subtle motion-safe:animate-pulse" }
      : ready.error
        ? { label: "API not reachable", dot: "bg-danger" }
        : ready.data?.status === "ok"
          ? { label: "API connected", dot: "bg-success" }
          : { label: "API degraded", dot: "bg-accent" };
  const content = (
    <Link
      to="/status"
      className={cx(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted transition-colors duration-150 hover:bg-surface-raised hover:text-fg",
        collapsed && "justify-center",
      )}
    >
      <span aria-hidden className={cx("size-2 shrink-0 rounded-full", state.dot)} />
      <span className={collapsed ? "sr-only" : undefined}>{state.label}</span>
    </Link>
  );
  return collapsed ? <Tooltip content={state.label}>{content}</Tooltip> : content;
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <Tooltip content={`Switch to ${next} theme`} side="bottom" align="end">
      <button
        type="button"
        onClick={toggle}
        aria-label={`Switch to ${next} theme`}
        aria-pressed={theme === "light"}
        className="grid size-9 place-items-center rounded-md border border-border bg-surface text-muted transition duration-150 hover:border-border-strong hover:text-fg"
      >
        {theme === "dark" ? <Sun aria-hidden className="size-4" /> : <Moon aria-hidden className="size-4" />}
      </button>
    </Tooltip>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const trail = crumbs(pathname);

  function toggleCollapsed() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !c;
    });
  }

  return (
    <div className="flex min-h-screen overflow-x-clip bg-bg text-fg">
      {drawerOpen && (
        <div aria-hidden className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setDrawerOpen(false)} />
      )}
      {/* Column wrapper: on md+ it spans the full page height so the sidebar background never stops short. */}
      <div className="contents md:block md:shrink-0 md:border-r md:border-border md:bg-surface">
      <aside
        aria-label="Sidebar"
        className={cx(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-surface transition-[transform,width] duration-200",
          "md:sticky md:top-0 md:h-screen md:translate-x-0 md:border-r-0",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
          collapsed ? "md:w-[4.25rem]" : "md:w-64",
        )}
      >
        <div className={cx("flex h-14 items-center gap-2.5 border-b border-border px-4", collapsed && "md:justify-center md:px-0")}>
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary ring-1 ring-primary/30">
            <Boxes className="size-4.5" />
          </span>
          <span className={cx("text-[15px] font-semibold tracking-tight", collapsed && "md:sr-only")}>
            Origami<span className="text-primary">Evolve</span>
          </span>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="ml-auto rounded-md p-1.5 text-muted hover:bg-surface-raised hover:text-fg md:hidden"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {NAV.map((item) => {
            const link = (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setDrawerOpen(false)}
                className={({ isActive }) =>
                  cx(
                    "group flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors duration-150",
                    collapsed && "md:justify-center md:px-0",
                    isActive
                      ? "bg-primary-soft text-primary ring-1 ring-primary/25"
                      : "text-muted hover:bg-surface-raised hover:text-fg",
                  )
                }
              >
                <span aria-hidden className="shrink-0">
                  {item.icon}
                </span>
                <span className={cx(collapsed && "md:sr-only")}>{item.label}</span>
              </NavLink>
            );
            // Collapsing only applies from md up (md: classes); the small-screen drawer always shows labels.
            return collapsed ? (
              <div key={item.to} className="[&>span]:flex">
                <Tooltip content={item.label}>{link}</Tooltip>
              </div>
            ) : (
              link
            );
          })}
        </nav>

        <div className="space-y-3 border-t border-border p-3">
          <ConnectionIndicator collapsed={collapsed} />
          <div className={cx(collapsed && "md:hidden")}>
            <TokenSettings />
          </div>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className="hidden w-full items-center justify-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted transition-colors hover:bg-surface-raised hover:text-fg md:flex"
          >
            {collapsed ? <ChevronsRight aria-hidden className="size-4" /> : <ChevronsLeft aria-hidden className="size-4" />}
            <span className={cx(collapsed && "sr-only")}>Collapse</span>
          </button>
        </div>
      </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => setDrawerOpen(true)}
            className="grid size-9 place-items-center rounded-md border border-border text-muted hover:text-fg md:hidden"
          >
            <Menu aria-hidden className="size-4" />
          </button>
          <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
            <ol className="flex min-w-0 items-center gap-1.5 text-sm">
              {trail.map((c, i) => (
                <li key={i} className="flex min-w-0 items-center gap-1.5">
                  {i > 0 && <span aria-hidden className="text-subtle">/</span>}
                  {c.to ? (
                    <Link to={c.to} className="truncate text-muted transition-colors hover:text-fg">
                      {c.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="truncate font-medium text-fg">
                      {c.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
          <ThemeToggle />
        </header>
        <main className="mx-auto w-full max-w-7xl min-w-0 flex-1 space-y-6 px-4 py-6 sm:px-6">
          <ProxyDisclaimer />
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
  );
}
