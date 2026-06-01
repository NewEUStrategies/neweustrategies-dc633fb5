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
    id: "header",
    label: "Header — Icons & Menu",
    slots: [
      {
        key: "header-icon",
        label: "Header Icons & Menu Color",
        description: "Kolor ikon (search, theme, social, account) oraz linków menu w nagłówku.",
        hasDark: true,
        defaultLight: "#374151",
        defaultDark: "#e5e7eb",
      },
      {
        key: "header-icon-hover",
        label: "Header Icons & Menu — Hover",
        description: "Kolor ikon i linków menu po najechaniu.",
        hasDark: true,
        defaultLight: "#111827",
        defaultDark: "#ffffff",
      },
    ],
  },
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
        overrides: ["--ring", "--brand"],
      },
    ],
  },
  {
    id: "icons",
    label: "Icons (SVG)",
    slots: [
      {
        key: "icon",
        label: "Global Icon Color",
        description: "Domyślny kolor ikon SVG w treści strony (poza nagłówkiem i przyciskami).",
        hasDark: true,
        defaultLight: "#374151",
        defaultDark: "#e5e7eb",
      },
      {
        key: "icon-hover",
        label: "Icon Hover Color",
        description: "Kolor ikon SVG po najechaniu (linki, przyciski ikon).",
        hasDark: true,
        defaultLight: "#111827",
        defaultDark: "#ffffff",
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
      // Always emit defaults if defined (so :where() fallbacks have a value).
      const light = v?.light || slot.defaultLight;
      const dark = (slot.hasDark ? v?.dark : undefined) || slot.defaultDark;
      if (light) {
        rootLines.push(`--gc-${slot.key}: ${light};`);
        for (const o of slot.overrides ?? []) rootLines.push(`${o}: ${light};`);
      }
      if (dark) {
        darkLines.push(`--gc-${slot.key}: ${dark};`);
        for (const o of slot.overrides ?? []) darkLines.push(`${o}: ${dark};`);
      }
    }
  }

  const parts: string[] = [];
  if (rootLines.length) parts.push(`:root{${rootLines.join("")}}`);
  if (darkLines.length) parts.push(`.dark{${darkLines.join("")}}`);

  // Widget bridge: map global colors to widget elements with specificity 0
  // (via :where()), so any explicit per-widget color always wins.
  parts.push(`
    :where(.rl-wrap .rl-num){color:var(--gc-highlight, currentColor);}
    :where(.rl-wrap .rl-cat){color:var(--gc-highlight, currentColor);}
    :where(.rl-wrap .rl-title:hover){color:var(--gc-highlight, currentColor);}
    :where(.rl-wrap .rl-format){color:var(--gc-highlight, currentColor);}
    :where(.rl-wrap .rl-bookmark){color:var(--gc-bookmark-hover, currentColor);}
    :where(.rl-wrap .rl-read-more){color:var(--gc-highlight, currentColor);}
    :where(a, .link){color:var(--gc-highlight, inherit);}
    :where(.review-star-bg){background:var(--gc-review-bg, transparent);}
    :where(.review-star-icon){color:var(--gc-review-icon, currentColor);}
    :where(.sponsor-label){color:var(--gc-sponsor-label, currentColor);}
    :where(.popular-counter){color:var(--gc-popular-counter, currentColor);}
    :where(.live-blog-dot){color:var(--gc-live-blog, currentColor);background:var(--gc-live-blog, transparent);}
    :where(.toc-wrap, .share-bar){background:var(--gc-toc-bg, transparent);}
    :where(.verified-tick){color:var(--gc-verified-tick, currentColor);}
    :where(.mode-switcher-light){color:var(--gc-switcher-light-icon, currentColor);background:var(--gc-switcher-light-bg, transparent);}
    :where(.mode-switcher-dark){color:var(--gc-switcher-dark-icon, currentColor);background:var(--gc-switcher-dark-bg, transparent);}
    :where(button.btn-primary, .btn-primary){background:var(--gc-btn-bg, var(--primary));color:var(--gc-btn-text, var(--primary-foreground));}
    :where(button.btn-primary:hover, .btn-primary:hover){background:var(--gc-btn-hover-bg, var(--gc-btn-bg, var(--primary)));color:var(--gc-btn-hover-text, var(--gc-btn-text, var(--primary-foreground)));}
    :where(header svg){color:var(--gc-header-icon, currentColor);}
    :where(header a, header button){color:var(--gc-header-icon, inherit);}
    :where(header a:hover, header button:hover, header a:hover svg, header button:hover svg){color:var(--gc-header-icon-hover, var(--gc-header-icon, inherit));}
  `.replace(/\s+/g, " ").trim());


  return parts.join("");
}
