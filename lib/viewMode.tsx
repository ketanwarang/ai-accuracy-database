"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type ViewMode = "raw" | "display";

interface ViewModeContextValue {
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
}

const ViewModeContext = createContext<ViewModeContextValue | null>(null);

const VIEW_MODE_KEY = "accuracy-monitor-view-mode";

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
  // Always defaults to "raw" — matches today's behavior exactly until a
  // user explicitly opts into Display Name view.
  const [viewMode, setViewModeState] = useState<ViewMode>("raw");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    if (stored === "display") setViewModeState("display");
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(VIEW_MODE_KEY, viewMode);
  }, [viewMode, mounted]);

  function setViewMode(m: ViewMode) {
    setViewModeState(m);
  }

  return <ViewModeContext.Provider value={{ viewMode, setViewMode }}>{children}</ViewModeContext.Provider>;
}

export function useViewMode() {
  const ctx = useContext(ViewModeContext);
  if (!ctx) throw new Error("useViewMode must be used within ViewModeProvider");
  return ctx;
}
