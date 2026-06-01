// Global Colors — strukturyzowana paleta odwzorowująca sekcje z motywu Foxiz.
// Każdy slot ma wartość dla trybu jasnego (`light`) i ciemnego (`dark`).
// Jest renderowana do CSS jako zmienne `--gc-<slug>` na :root oraz .dark,
// a wybrane sloty nadpisują semantyczne tokeny shadcn (`--primary`, `--background`,
// `--ring`, `--card`, itd.) — dzięki temu kolor zmieniony w admin panelu
// natychmiast wpływa na wygląd całej strony produkcyjnej (przyciski, linki,
// tło, ramki, itd.).

export interface GlobalColorSlot {
  /** Stabilny identyfikator (klucz w obiekcie i nazwa zmiennej `--gc-<key>`). */
  key: string;
  /** Etykieta wyświetlana w admin panelu. */
  label: string;
  /** Krótki opis — gdzie kolor będzie użyty. */
  description: string;
  /** Czy slot ma osobną wartość dla dark mode. */
  hasDark?: boolean;
  /** Sugerowana wartość domyślna (light). */
  defaultLight?: string;
  /** Sugerowana wartość domyślna (dark). */
  defaultDark?: string;
  /** Lista semantycznych tokenów shadcn, które ten slot ma nadpisać. */
  overrides?: string[];
}

export interface GlobalColorGroup {
  id: string;
  label: string;
  slots: GlobalColorSlot[];
}

/** Pełna definicja paneli — odpowiada zakładce "Global Colors" w Foxiz. */
export const GLOBAL_COLOR_GROUPS: GlobalColorGroup[] = [
  {
    id: "highlight",
    label: "Highlight Elements",
    slots: [
      {
        key: "highlight",
        label: "Global Highlight Color",
        description: "Linki, menu, akcenty kategorii, główne elementy interaktywne.",
        hasDark: true,
        defaultLight: "#f59e0b",
        defaultDark: "#fbbf24",
        overrides: ["--primary", "--ring", "--brand"],
      },
    ],
  },
  {
    id: "dark-accent",
    label: "Dark Accent",
    slots: [
      {
        key: "dark-accent",
        label: "Dark Accent Color",
        description: "Tło sekcji nagłówkowych pojedynczego wpisu, gradienty.",
        hasDark: true,
        defaultLight: "#0f172a",
        defaultDark: "#020617",
        overrides: ["--accent"],
      },
    ],
  },
  {
    id: "body",
    label: "Body Background",
    slots: [
      {
        key: "body-bg",
        label: "Body Background",
        description: "Główne tło strony.",
        hasDark: true,
        overrides: ["--background"],
      },
      {
        key: "body-bg-single",
        label: "Body Background (Single Post)",
        description: "Tło dla pojedynczych wpisów. Pusto = używa Body Background.",
      },
    ],
  },
  {
    id: "button",
    label: "Button",
    slots: [
      {
        key: "btn-bg",
        label: "Primary Color (Background)",
        description: "Tło przycisków.",
        overrides: ["--primary"],
      },
      {
        key: "btn-text",
        label: "Accent Color (Text)",
        description: "Kolor tekstu przycisków.",
        overrides: ["--primary-foreground"],
      },
      {
        key: "btn-hover-bg",
        label: "Hover — Primary Color",
        description: "Tło przycisków po najechaniu.",
      },
      {
        key: "btn-hover-text",
        label: "Hover — Accent Color",
        description: "Tekst przycisków po najechaniu.",
      },
    ],
  },
  {
    id: "switcher",
    label: "Mode Switcher",
    slots: [
      { key: "switcher-light-icon", label: "Light Switcher — Icon", description: "Kolor ikony słońca." },
      { key: "switcher-light-bg", label: "Light Switcher — Icon BG", description: "Tło ikony słońca." },
      { key: "switcher-dark-icon", label: "Dark Switcher — Icon", description: "Kolor ikony księżyca." },
      { key: "switcher-dark-bg", label: "Dark Switcher — Icon BG", description: "Tło ikony księżyca." },
    ],
  },
  {
    id: "bookmark",
    label: "Bookmark Hovering",
    slots: [
      {
        key: "bookmark-hover",
        label: "Bookmark Hover Color",
        description: "Kolor zakładki po najechaniu.",
        hasDark: true,
      },
    ],
  },
  {
    id: "review",
    label: "Review Stars",
    slots: [
      { key: "review-bg", label: "Background Color", description: "Tło dla gwiazdek recenzji.", hasDark: true, defaultLight: "#ffc300" },
      { key: "review-icon", label: "Icon Color", description: "Kolor ikony gwiazdki.", hasDark: true, defaultLight: "#ffffff" },
    ],
  },
  {
    id: "sponsor",
    label: "Sponsor Label",
    slots: [
      { key: "sponsor-label", label: "Sponsor Label Color", description: "Kolor etykiety „sponsored”.", hasDark: true },
    ],
  },
  {
    id: "popular",
    label: "Popular Counter",
    slots: [
      { key: "popular-counter", label: "Popular Counter Color", description: "Kolor licznika popularnych wpisów.", hasDark: true },
    ],
  },
  {
    id: "live",
    label: "Live Blogging",
    slots: [
      { key: "live-blog", label: "Color", description: "Kolor ikon live-blogging.", hasDark: true },
    ],
  },
  {
    id: "toc",
    label: "TOC, Left Shares & Inline Related",
    slots: [
      { key: "toc-bg", label: "Background", description: "Tło table-of-contents i share-bara.", hasDark: true, overrides: ["--muted"] },
    ],
  },
  {
    id: "verified",
    label: "Verified Tick",
    slots: [
      { key: "verified-tick", label: "Color", description: "Kolor odznaki „zweryfikowany autor”.", hasDark: true, defaultLight: "#f59e0b" },
    ],
  },
];

export type GlobalColorsValue = Record<string, { light?: string; dark?: string }>;

export const EMPTY_GLOBAL_COLORS: GlobalColorsValue = {};

/**
 * Buduje CSS dla globalnych kolorów — emituje:
 *  1) `--gc-<key>` na :root (light) i .dark (dark),
 *  2) nadpisania semantycznych tokenów shadcn (np. --primary, --background).
 */
export function globalColorsToCss(value: GlobalColorsValue): string {
  const rootLines: string[] = [];
  const darkLines: string[] = [];

  for (const group of GLOBAL_COLOR_GROUPS) {
    for (const slot of group.slots) {
      const v = value[slot.key];
      if (!v) continue;
      if (v.light) {
        rootLines.push(`--gc-${slot.key}: ${v.light};`);
        for (const o of slot.overrides ?? []) rootLines.push(`${o}: ${v.light};`);
      }
      if (slot.hasDark && v.dark) {
        darkLines.push(`--gc-${slot.key}: ${v.dark};`);
        for (const o of slot.overrides ?? []) darkLines.push(`${o}: ${v.dark};`);
      }
    }
  }

  const parts: string[] = [];
  if (rootLines.length) parts.push(`:root{${rootLines.join("")}}`);
  if (darkLines.length) parts.push(`.dark{${darkLines.join("")}}`);
  return parts.join("");
}
