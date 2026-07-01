"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Mode = "light" | "dark" | "system";
type Accent = "orange" | "red" | "green" | "blue" | "cyan" | "purple" | "pink";

interface ThemeContextValue {
  mode: Mode;
  accent: Accent;
  setMode: (m: Mode) => void;
  setAccent: (a: Accent) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const MODE_KEY = "accuracy-monitor-mode";
const ACCENT_KEY = "accuracy-monitor-accent";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<Mode>("system");
  const [accent, setAccentState] = useState<Accent>("orange");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const storedMode = (localStorage.getItem(MODE_KEY) as Mode) || "system";
    const storedAccent = (localStorage.getItem(ACCENT_KEY) as Accent) || "orange";
    setModeState(storedMode);
    setAccentState(storedAccent);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const html = document.documentElement;
    if (mode === "system") {
      html.removeAttribute("data-mode");
    } else {
      html.setAttribute("data-mode", mode);
    }
    html.setAttribute("data-accent", accent);
    localStorage.setItem(MODE_KEY, mode);
    localStorage.setItem(ACCENT_KEY, accent);
  }, [mode, accent, mounted]);

  function setMode(m: Mode) {
    setModeState(m);
  }
  function setAccent(a: Accent) {
    setAccentState(a);
  }

  return <ThemeContext.Provider value={{ mode, accent, setMode, setAccent }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

export const ACCENT_OPTIONS: { value: Accent; label: string; swatch: string }[] = [
  { value: "orange", label: "Orange", swatch: "#e8772c" },
  { value: "red", label: "Red", swatch: "#e0413f" },
  { value: "green", label: "Green", swatch: "#5a9c2f" },
  { value: "blue", label: "Blue", swatch: "#2a78d6" },
  { value: "cyan", label: "Cyan", swatch: "#17a4a8" },
  { value: "purple", label: "Purple", swatch: "#6d63cf" },
  { value: "pink", label: "Pink", swatch: "#d4537e" },
];
