import { useSyncExternalStore } from "react";

/** Browser-only, per-device sidebar preference. Expanded unless the user chose collapsed. */
export const SIDEBAR_PREFERENCE_KEY = "wrrcs-sidebar-collapsed";

export function parseSidebarCollapsed(raw: string | null | undefined): boolean {
  return raw === "1";
}

export function serializeSidebarCollapsed(collapsed: boolean): string {
  return collapsed ? "1" : "0";
}

const listeners = new Set<() => void>();
let cached: boolean | null = null;

function read(): boolean {
  if (cached !== null) return cached;
  try {
    cached = parseSidebarCollapsed(window.localStorage.getItem(SIDEBAR_PREFERENCE_KEY));
  } catch {
    cached = false;
  }
  return cached;
}

export function setSidebarCollapsed(collapsed: boolean) {
  cached = collapsed;
  try {
    window.localStorage.setItem(SIDEBAR_PREFERENCE_KEY, serializeSidebarCollapsed(collapsed));
  } catch {
    /* storage unavailable: keep in-memory choice for this visit */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Server/hydration renders expanded; the remembered value applies immediately after, and page changes reuse it. */
export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
