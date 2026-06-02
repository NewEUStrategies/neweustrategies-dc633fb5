// Global Colors — strukturyzowana paleta odwzorowująca sekcje z motywu Foxiz.
// Każdy slot ma wartość dla trybu jasnego (`light`) i ciemnego (`dark`).
// Jest renderowana do CSS jako zmienne `--gc-<slug>` na :root oraz .dark,
// a wybrane sloty nadpisują semantyczne tokeny shadcn (`--primary`, `--background`,
// `--ring`, `--card`, itd.) — dzięki temu kolor zmieniony w admin panelu
// natychmiast wpływa na wygląd całej strony produkcyjnej (przyciski, linki,
// tło, ramki, itd.).

export interface GlobalColorSlot {
  /** Stabilny identyfikator. */
  key: string;
  label: string;
  description: string;
  hasDark?: boolean;
  hoverable?: boolean;
  /** Czy slot reprezentuje element tekstowy z edytowalnym fontem i rozmiarem. */
  typography?: boolean;
  defaultFontFamily?: string;
  defaultFontSize?: string;
  defaultLight?: string;
  defaultDark?: string;
  defaultHoverLight?: string;
  defaultHoverDark?: string;
  overrides?: string[];
}

export interface GlobalColorGroup {
  id: string;
  label: string;
  /** Kategoria nadrzędna grupująca powiązane sekcje w panelu. */
  category?: string;
  slots: GlobalColorSlot[];
}

/** Kolejność kategorii w panelu Global Colors. */
export const GLOBAL_COLOR_CATEGORIES: { id: string; label: string }[] = [
  { id: "globals", label: "Globalne" },
  { id: "typography", label: "Typografia" },
  { id: "header-nav", label: "Nagłówek i nawigacja" },
  { id: "forms", label: "Formularze i przyciski" },
  { id: "widgets", label: "Widgety treści" },
];

/** Pełna definicja paneli — odpowiada zakładce "Global Colors" w Foxiz. */
export const GLOBAL_COLOR_GROUPS: GlobalColorGroup[] = [
  {
    id: "header",
    category: "header-nav",
    label: "Header — Icons & Menu",
    slots: [
      {
        key: "header-icon",
        label: "Header Icons & Menu Color",
        description: "Kolor ikon (search, theme, social, account) oraz linków menu w nagłówku.",
        hasDark: true,
        defaultLight: "#374151",
        defaultDark: "#e5e7eb",
        typography: true,
        defaultFontFamily: '"Red Hat Display", Georgia, serif',
        defaultFontSize: "16px"
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
    category: "globals",
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
      {
        key: "highlight-hover",
        label: "Highlight — Hover",
        description: "Kolor highlight po najechaniu kursorem.",
        hasDark: true,
        defaultLight: "#d97706",
        defaultDark: "#fcd34d",
      },
    ],
  },
  {
    id: "icons",
    category: "globals",
    label: "Icons (SVG)",
    slots: [
      {
        key: "icon",
        label: "Global Icon Color",
        description: "Domyślny kolor ikon SVG w treści strony (poza nagłówkiem i przyciskami). Domyślnie używa Global Highlight Color.",
        hasDark: true,
        defaultLight: "#fa9346",
        defaultDark: "#fbbf24",
      },
      {
        key: "icon-hover",
        label: "Icon Hover Color",
        description: "Kolor ikon SVG po najechaniu.",
        hasDark: true,
        defaultLight: "#d97706",
        defaultDark: "#fcd34d",
      },
    ],
  },

  {
    id: "dark-accent",
    category: "globals",
    label: "Dark Accent",
    slots: [
      {
        key: "dark-accent",
        label: "Dark Accent Color",
        description: "Wiodący ciemny kolor — tła sekcji nagłówkowych, gradienty, ORAZ kolor tekstu (nagłówki, akapity, tytuły kart) w trybie jasnym.",
        hasDark: true,
        defaultLight: "#01112F",
        defaultDark: "#01112F",
        overrides: ["--accent"],
      },
    ],
  },
  {
    id: "body",
    category: "globals",
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
    category: "forms",
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
        typography: true,
        defaultFontFamily: '"Red Hat Display", Georgia, serif',
        defaultFontSize: "16px"
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
    category: "header-nav",
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
    category: "widgets",
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
    category: "widgets",
    label: "Review Stars",
    slots: [
      { key: "review-bg", label: "Background Color", description: "Tło dla gwiazdek recenzji.", hasDark: true, defaultLight: "#ffc300" },
      { key: "review-icon", label: "Icon Color", description: "Kolor ikony gwiazdki.", hasDark: true, defaultLight: "#ffffff" },
    ],
  },
  {
    id: "sponsor",
    category: "widgets",
    label: "Sponsor Label",
    slots: [
      { key: "sponsor-label", label: "Sponsor Label Color", description: "Kolor etykiety „sponsored”.", hasDark: true, typography: true, defaultFontFamily: '"Red Hat Display", Georgia, serif', defaultFontSize: "12px" },
    ],
  },
  {
    id: "popular",
    category: "widgets",
    label: "Popular Counter",
    slots: [
      { key: "popular-counter", label: "Popular Counter Color", description: "Kolor licznika popularnych wpisów.", hasDark: true, typography: true, defaultFontFamily: '"Red Hat Display", Georgia, serif', defaultFontSize: "14px" },
    ],
  },
  {
    id: "live",
    category: "widgets",
    label: "Live Blogging",
    slots: [
      { key: "live-blog", label: "Color", description: "Kolor ikon live-blogging.", hasDark: true },
    ],
  },
  {
    id: "toc",
    category: "widgets",
    label: "TOC, Left Shares & Inline Related",
    slots: [
      { key: "toc-bg", label: "Background", description: "Tło table-of-contents i share-bara.", hasDark: true, overrides: ["--muted"] },
    ],
  },
  {
    id: "verified",
    category: "widgets",
    label: "Verified Tick",
    slots: [
      { key: "verified-tick", label: "Color", description: "Kolor odznaki „zweryfikowany autor”.", hasDark: true, defaultLight: "#f59e0b" },
    ],
  },
  {
    id: "sidebar",
    category: "header-nav",
    label: "Sidebar",
    slots: [
      {
        key: "sidebar-bg",
        label: "Sidebar Background",
        description: "Tło sidebaru (panel boczny).",
        hasDark: true,
        defaultLight: "#f8f6f4",
        defaultDark: "#01112f",
        overrides: ["--sidebar-background", "--sidebar"],
      },
      {
        key: "sidebar-text",
        label: "Sidebar Text",
        description: "Kolor tekstu/linków w sidebarze.",
        hasDark: true,
        defaultLight: "#1f2937",
        defaultDark: "#e5e7eb",
        overrides: ["--sidebar-foreground"],
        typography: true,
        defaultFontFamily: '"Red Hat Display", Georgia, serif',
        defaultFontSize: "16px"
      },
      {
        key: "sidebar-btn-bg",
        label: "Sidebar Button — Background",
        description: "Tło przycisków / aktywnych elementów w sidebarze.",
        hasDark: true,
        defaultLight: "#fa9346",
        defaultDark: "#fa9346",
        overrides: ["--sidebar-primary", "--sidebar-accent"],
      },
      {
        key: "sidebar-btn-text",
        label: "Sidebar Button — Text",
        description: "Kolor tekstu przycisków / aktywnych elementów w sidebarze.",
        hasDark: true,
        defaultLight: "#ffffff",
        defaultDark: "#ffffff",
        overrides: ["--sidebar-primary-foreground", "--sidebar-accent-foreground"],
        typography: true,
        defaultFontFamily: '"Red Hat Display", Georgia, serif',
        defaultFontSize: "16px"
      },
      {
        key: "sidebar-btn-hover-bg",
        label: "Sidebar Button — Hover BG",
        description: "Tło przycisków sidebaru po najechaniu.",
        hasDark: true,
        defaultLight: "#fdb078",
        defaultDark: "#fdb078",
      },
      {
        key: "sidebar-btn-hover-text",
        label: "Sidebar Button — Hover Text",
        description: "Tekst przycisków sidebaru po najechaniu.",
        hasDark: true,
        defaultLight: "#ffffff",
        defaultDark: "#ffffff",
      },
      {
        key: "sidebar-border",
        label: "Sidebar Border",
        description: "Kolor obramowania sidebaru i separatorów.",
        hasDark: true,
        defaultLight: "#e5e7eb",
        defaultDark: "#1f2a44",
        overrides: ["--sidebar-border"],
      },
    ],
  },
  {
    id: "input",
    category: "forms",
    label: "Inputs / Text Fields",
    slots: [
      { key: "input-bg", label: "Input Background", description: "Tło pól tekstowych.", hasDark: true, defaultLight: "#ffffff", defaultDark: "#0f172a", overrides: ["--input-background"] },
      { key: "input-text", label: "Input Text", description: "Kolor wpisywanego tekstu.", hasDark: true, defaultLight: "#0f172a", defaultDark: "#f1f5f9" },
      { key: "input-placeholder", label: "Placeholder Text", description: "Kolor placeholdera.", hasDark: true, defaultLight: "#94a3b8", defaultDark: "#64748b" },
      { key: "input-border", label: "Input Border", description: "Kolor obramowania.", hasDark: true, defaultLight: "#e2e8f0", defaultDark: "#1e293b", overrides: ["--input"] },
      { key: "input-hover-bg", label: "Hover — Background", description: "Tło pola po najechaniu.", hasDark: true, defaultLight: "#f8fafc", defaultDark: "#1e293b" },
      { key: "input-hover-border", label: "Hover — Border", description: "Obramowanie pola po najechaniu.", hasDark: true, defaultLight: "#cbd5e1", defaultDark: "#334155" },
      { key: "input-focus-border", label: "Focus — Border / Ring", description: "Obramowanie i ring po fokusie.", hasDark: true, defaultLight: "#fa9346", defaultDark: "#fbbf24" },
    ],
  },
  {
    id: "headings",
    category: "typography",
    label: "Headings (H1–H6)",
    slots: [
      { key: "h1", label: "H1 Color", description: "Kolor nagłówków H1.", hasDark: true, defaultLight: "#01112F", defaultDark: "#ffffff", typography: true, defaultFontFamily: '"Red Hat Display", Georgia, serif', defaultFontSize: "36px" },
      { key: "h2", label: "H2 Color", description: "Kolor nagłówków H2.", hasDark: true, defaultLight: "#01112F", defaultDark: "#ffffff", typography: true, defaultFontFamily: '"Red Hat Display", Georgia, serif', defaultFontSize: "30px" },
      { key: "h3", label: "H3 Color", description: "Kolor nagłówków H3.", hasDark: true, defaultLight: "#01112F", defaultDark: "#f3f4f6", typography: true, defaultFontFamily: '"Red Hat Display", Georgia, serif', defaultFontSize: "24px" },
      { key: "h4", label: "H4 Color", description: "Kolor nagłówków H4.", hasDark: true, defaultLight: "#01112F", defaultDark: "#f3f4f6", typography: true, defaultFontFamily: '"Red Hat Display", Georgia, serif', defaultFontSize: "20px" },
      { key: "h5", label: "H5 Color", description: "Kolor nagłówków H5.", hasDark: true, defaultLight: "#01112F", defaultDark: "#e5e7eb", typography: true, defaultFontFamily: '"Red Hat Display", Georgia, serif', defaultFontSize: "18px" },
      { key: "h6", label: "H6 Color", description: "Kolor nagłówków H6.", hasDark: true, defaultLight: "#01112F", defaultDark: "#e5e7eb", typography: true, defaultFontFamily: '"Red Hat Display", Georgia, serif', defaultFontSize: "16px" },
    ],
  },
  {
    id: "body-text",
    category: "typography",
    label: "Body Text",
    slots: [
      {
        key: "body-text",
        label: "Body Text Color",
        description: "Kolor podstawowego tekstu (akapity, listy).",
        hasDark: true,
        defaultLight: "#374151",
        defaultDark: "#d1d5db",
        overrides: ["--foreground"],
        typography: true,
        defaultFontFamily: '"Red Hat Display", Georgia, serif',
        defaultFontSize: "16px",
      },
      {
        key: "body-text-muted",
        label: "Muted Text Color",
        description: "Kolor tekstu drugorzędnego (podpisy, meta).",
        hasDark: true,
        defaultLight: "#6b7280",
        defaultDark: "#9ca3af",
        overrides: ["--muted-foreground"],
        typography: true,
        defaultFontFamily: '"Red Hat Display", Georgia, serif',
        defaultFontSize: "14px",
      },
    ],
  },
  {
    id: "links",
    category: "typography",
    label: "Links",
    slots: [
      {
        key: "link",
        label: "Link Color",
        description: "Kolor linków w treści.",
        hasDark: true,
        defaultLight: "#fa9346",
        defaultDark: "#fbbf24",
        typography: true,
        defaultFontFamily: '"Red Hat Display", Georgia, serif',
        defaultFontSize: "16px",
      },
      {
        key: "link-hover",
        label: "Link Hover Color",
        description: "Kolor linków po najechaniu.",
        hasDark: true,
        defaultLight: "#01112F",
        defaultDark: "#ffffff",
      },
    ],
  },
];

export type GlobalColorsValue = Record<
  string,
  {
    light?: string;
    dark?: string;
    hoverLight?: string;
    hoverDark?: string;
    fontFamily?: string;
    fontSize?: string;
    /** "normal" | "500" | "600" | "700" */
    fontWeight?: string;
    /** "normal" | "italic" */
    fontStyle?: string;
    /** "none" | "underline" */
    textDecoration?: string;
  }
>;

export const EMPTY_GLOBAL_COLORS: GlobalColorsValue = {};

/**
 * Czy dany slot powinien mieć dodatkową parę pickerów Hover (light + dark).
 * Domyślnie TAK — pomijamy tylko sloty, które same są wariantem hover
 * (klucz kończy się na `-hover`) lub mają już siostrzany slot `<key>-hover`
 * w tej samej grupie, albo zostały jawnie wyłączone (`hoverable: false`).
 */
export function isSlotHoverable(slot: GlobalColorSlot, group: GlobalColorGroup): boolean {
  if (slot.hoverable === false) return false;
  if (slot.hoverable === true) return true;
  if (slot.key.endsWith("-hover")) return false;
  const keys = new Set(group.slots.map((s) => s.key));
  if (keys.has(`${slot.key}-hover`)) return false;
  // Sloty z dedykowanymi parami hover w obrębie grupy (button / input / sidebar btn).
  const exempt = new Set([
    "btn-bg", "btn-text",
    "input-bg", "input-text", "input-placeholder", "input-border",
    "sidebar-btn-bg", "sidebar-btn-text",
  ]);
  return !exempt.has(slot.key);
}

/**
 * Buduje CSS dla globalnych kolorów — emituje:
 *  1) `--gc-<key>` na :root (light) i .dark (dark),
 *  2) `--gc-<key>-hover` dla slotów hoverable,
 *  3) nadpisania semantycznych tokenów shadcn (np. --primary, --background).
 */
export function globalColorsToCss(value: GlobalColorsValue): string {
  const rootLines: string[] = [];
  const darkLines: string[] = [];

  for (const group of GLOBAL_COLOR_GROUPS) {
    for (const slot of group.slots) {
      const v = value[slot.key];
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
      if (isSlotHoverable(slot, group)) {
        const hLight = v?.hoverLight || slot.defaultHoverLight || light;
        const hDark = v?.hoverDark || slot.defaultHoverDark || dark || hLight;
        if (hLight) rootLines.push(`--gc-${slot.key}-hover: ${hLight};`);
        if (hDark) darkLines.push(`--gc-${slot.key}-hover: ${hDark};`);
      }
      if (slot.typography) {
        const ff = v?.fontFamily || slot.defaultFontFamily;
        const fs = v?.fontSize || slot.defaultFontSize;
        const fw = v?.fontWeight;
        const fst = v?.fontStyle;
        const ftd = v?.textDecoration;
        if (ff) rootLines.push(`--gc-${slot.key}-font: ${ff};`);
        if (fs) rootLines.push(`--gc-${slot.key}-size: ${fs};`);
        if (fw) rootLines.push(`--gc-${slot.key}-weight: ${fw};`);
        if (fst) rootLines.push(`--gc-${slot.key}-style: ${fst};`);
        if (ftd) rootLines.push(`--gc-${slot.key}-decoration: ${ftd};`);
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
    :where(button.btn-primary, .btn-primary, button.bg-primary, .bg-primary){background:var(--gc-btn-bg, var(--primary));color:var(--gc-btn-text, var(--primary-foreground));}
    :where(button.btn-primary:hover, .btn-primary:hover, button.bg-primary:hover, .bg-primary:hover){background:var(--gc-btn-hover-bg, var(--gc-btn-bg, var(--primary)));color:var(--gc-btn-hover-text, var(--gc-btn-text, var(--primary-foreground)));}
    :where(main svg, article svg, section svg, .content svg, .card svg, [class*="card"] svg, [data-card] svg){color:var(--gc-icon, var(--gc-highlight, currentColor));}
    :where(main a:hover svg, article a:hover svg, section a:hover svg, .content a:hover svg, main button:hover svg, article button:hover svg, .card a:hover svg, [class*="card"] a:hover svg){color:var(--gc-icon-hover, var(--gc-icon, var(--gc-highlight, currentColor)));}
    :where(header svg){color:var(--gc-header-icon, currentColor);}
    :where(header a, header button){color:var(--gc-header-icon, inherit);}
    :where(header a:hover, header button:hover, header a:hover svg, header button:hover svg){color:var(--gc-header-icon-hover, var(--gc-header-icon, inherit));}
    aside[data-sidebar="sidebar"], [data-sidebar="sidebar"]{background:var(--gc-sidebar-bg, var(--sidebar-background)) !important;color:var(--gc-sidebar-text, var(--sidebar-foreground)) !important;border-color:var(--gc-sidebar-border, var(--sidebar-border)) !important;}
    [data-sidebar="sidebar"] a, [data-sidebar="sidebar"] button, [data-sidebar="menu-button"]{color:var(--gc-sidebar-text, inherit);}
    [data-sidebar="sidebar"] svg{color:var(--gc-sidebar-text, currentColor);}
    [data-sidebar="menu-button"]:hover, [data-sidebar="sidebar"] a:hover:not([data-active="true"]):not([data-sidebar-brand]), [data-sidebar="sidebar"] button:hover:not([data-sidebar-brand]):not([data-sidebar-toggle]){background:var(--gc-sidebar-btn-hover-bg) !important;color:var(--gc-sidebar-btn-hover-text, var(--gc-sidebar-text)) !important;}
    [data-sidebar="sidebar"] a[data-sidebar-brand], [data-sidebar="sidebar"] a[data-sidebar-brand]:hover, [data-sidebar="sidebar"] button[data-sidebar-toggle], [data-sidebar="sidebar"] button[data-sidebar-toggle]:hover{background:transparent !important;}
    [data-sidebar="menu-button"][data-active="true"], [data-sidebar="menu-button"].active, [data-sidebar="sidebar"] .active{background:var(--gc-sidebar-btn-bg) !important;color:var(--gc-sidebar-btn-text, var(--gc-sidebar-text)) !important;}
    [data-sidebar="menu-button"][data-active="true"] svg, [data-sidebar="sidebar"] .active svg{color:var(--gc-sidebar-btn-text, currentColor) !important;}
    [data-sidebar="separator"]{background:var(--gc-sidebar-border, var(--sidebar-border, transparent));}
    :where(html:not(.dark) main h1, html:not(.dark) main h2, html:not(.dark) main h3, html:not(.dark) main h4, html:not(.dark) main h5, html:not(.dark) main h6, html:not(.dark) main p, html:not(.dark) article h1, html:not(.dark) article h2, html:not(.dark) article h3, html:not(.dark) article h4, html:not(.dark) article p, html:not(.dark) section h1, html:not(.dark) section h2, html:not(.dark) section h3, html:not(.dark) section h4, html:not(.dark) section p){color:var(--gc-dark-accent, inherit);}
    :where(main h1, article h1, section h1){color:var(--gc-h1, inherit);font-family:var(--gc-h1-font, inherit);font-size:var(--gc-h1-size, inherit);font-weight:var(--gc-h1-weight, inherit);font-style:var(--gc-h1-style, inherit);text-decoration:var(--gc-h1-decoration, inherit);}
    :where(main h2, article h2, section h2){color:var(--gc-h2, inherit);font-family:var(--gc-h2-font, inherit);font-size:var(--gc-h2-size, inherit);font-weight:var(--gc-h2-weight, inherit);font-style:var(--gc-h2-style, inherit);text-decoration:var(--gc-h2-decoration, inherit);}
    :where(main h3, article h3, section h3){color:var(--gc-h3, inherit);font-family:var(--gc-h3-font, inherit);font-size:var(--gc-h3-size, inherit);font-weight:var(--gc-h3-weight, inherit);font-style:var(--gc-h3-style, inherit);text-decoration:var(--gc-h3-decoration, inherit);}
    :where(main h4, article h4, section h4){color:var(--gc-h4, inherit);font-family:var(--gc-h4-font, inherit);font-size:var(--gc-h4-size, inherit);font-weight:var(--gc-h4-weight, inherit);font-style:var(--gc-h4-style, inherit);text-decoration:var(--gc-h4-decoration, inherit);}
    :where(main h5, article h5, section h5){color:var(--gc-h5, inherit);font-family:var(--gc-h5-font, inherit);font-size:var(--gc-h5-size, inherit);font-weight:var(--gc-h5-weight, inherit);font-style:var(--gc-h5-style, inherit);text-decoration:var(--gc-h5-decoration, inherit);}
    :where(main h6, article h6, section h6){color:var(--gc-h6, inherit);font-family:var(--gc-h6-font, inherit);font-size:var(--gc-h6-size, inherit);font-weight:var(--gc-h6-weight, inherit);font-style:var(--gc-h6-style, inherit);text-decoration:var(--gc-h6-decoration, inherit);}
    :where(main p, article p, section p, main li, article li, section li){color:var(--gc-body-text, inherit);font-family:var(--gc-body-text-font, inherit);font-size:var(--gc-body-text-size, inherit);font-weight:var(--gc-body-text-weight, inherit);font-style:var(--gc-body-text-style, inherit);text-decoration:var(--gc-body-text-decoration, inherit);}
    :where(main small, article small, section small, .text-muted, .muted){color:var(--gc-body-text-muted, inherit);font-family:var(--gc-body-text-muted-font, inherit);font-size:var(--gc-body-text-muted-size, inherit);font-weight:var(--gc-body-text-muted-weight, inherit);font-style:var(--gc-body-text-muted-style, inherit);text-decoration:var(--gc-body-text-muted-decoration, inherit);}
    :where(main a:not(.btn):not([class*="button"]), article a:not(.btn):not([class*="button"]), section a:not(.btn):not([class*="button"])){color:var(--gc-link, var(--gc-highlight, inherit));font-family:var(--gc-link-font, inherit);font-size:var(--gc-link-size, inherit);font-weight:var(--gc-link-weight, inherit);font-style:var(--gc-link-style, inherit);text-decoration:var(--gc-link-decoration, inherit);}
    :where(main a:not(.btn):not([class*="button"]):hover, article a:not(.btn):not([class*="button"]):hover, section a:not(.btn):not([class*="button"]):hover){color:var(--gc-link-hover, var(--gc-link, inherit));}
    :where(.highlight, .text-brand, [data-highlight]){color:var(--gc-highlight, inherit);}
    :where(.highlight:hover, .text-brand:hover, [data-highlight]:hover){color:var(--gc-highlight-hover, var(--gc-highlight, inherit));}
    :where(input:not([type="color"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, select){background:var(--gc-input-bg, transparent);color:var(--gc-input-text, inherit);border-color:var(--gc-input-border, currentColor);}
    :where(input:not([type="color"]):not([type="checkbox"]):not([type="radio"]):not([type="range"])::placeholder, textarea::placeholder){color:var(--gc-input-placeholder, currentColor);}
    :where(input:not([type="color"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):hover, textarea:hover, select:hover){background:var(--gc-input-hover-bg, var(--gc-input-bg, transparent));border-color:var(--gc-input-hover-border, var(--gc-input-border, currentColor));}
    :where(input:not([type="color"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):focus, input:not([type="color"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):focus-visible, textarea:focus, textarea:focus-visible, select:focus, select:focus-visible){border-color:var(--gc-input-focus-border, var(--gc-highlight, currentColor));outline-color:var(--gc-input-focus-border, var(--gc-highlight, currentColor));}

    /* Per-element hover (auto z isSlotHoverable). */
    :where(main h1:hover, article h1:hover, section h1:hover){color:var(--gc-h1-hover, var(--gc-h1, inherit));}
    :where(main h2:hover, article h2:hover, section h2:hover){color:var(--gc-h2-hover, var(--gc-h2, inherit));}
    :where(main h3:hover, article h3:hover, section h3:hover){color:var(--gc-h3-hover, var(--gc-h3, inherit));}
    :where(main h4:hover, article h4:hover, section h4:hover){color:var(--gc-h4-hover, var(--gc-h4, inherit));}
    :where(main h5:hover, article h5:hover, section h5:hover){color:var(--gc-h5-hover, var(--gc-h5, inherit));}
    :where(main h6:hover, article h6:hover, section h6:hover){color:var(--gc-h6-hover, var(--gc-h6, inherit));}
    :where(main p:hover, article p:hover, section p:hover, main li:hover, article li:hover, section li:hover){color:var(--gc-body-text-hover, var(--gc-body-text, inherit));}
    :where(main small:hover, article small:hover, section small:hover, .text-muted:hover, .muted:hover){color:var(--gc-body-text-muted-hover, var(--gc-body-text-muted, inherit));}
    :where(.sponsor-label:hover){color:var(--gc-sponsor-label-hover, var(--gc-sponsor-label, currentColor));}
    :where(.popular-counter:hover){color:var(--gc-popular-counter-hover, var(--gc-popular-counter, currentColor));}
    :where(.live-blog-dot:hover){color:var(--gc-live-blog-hover, var(--gc-live-blog, currentColor));background:var(--gc-live-blog-hover, var(--gc-live-blog, transparent));}
    :where(.verified-tick:hover){color:var(--gc-verified-tick-hover, var(--gc-verified-tick, currentColor));}
    :where(.toc-wrap:hover, .share-bar:hover){background:var(--gc-toc-bg-hover, var(--gc-toc-bg, transparent));}
    :where(.review-star-bg:hover){background:var(--gc-review-bg-hover, var(--gc-review-bg, transparent));}
    :where(.review-star-icon:hover){color:var(--gc-review-icon-hover, var(--gc-review-icon, currentColor));}
    :where(.mode-switcher-light:hover){color:var(--gc-switcher-light-icon-hover, var(--gc-switcher-light-icon, currentColor));background:var(--gc-switcher-light-bg-hover, var(--gc-switcher-light-bg, transparent));}
    :where(.mode-switcher-dark:hover){color:var(--gc-switcher-dark-icon-hover, var(--gc-switcher-dark-icon, currentColor));background:var(--gc-switcher-dark-bg-hover, var(--gc-switcher-dark-bg, transparent));}
    :where(body:hover){background:var(--gc-body-bg-hover, var(--gc-body-bg, transparent));}
    :where([data-single-post]:hover){background:var(--gc-body-bg-single-hover, var(--gc-body-bg-single, var(--gc-body-bg, transparent)));}
    :where([data-dark-accent]:hover){background:var(--gc-dark-accent-hover, var(--gc-dark-accent, transparent));}
    :where([data-sidebar="sidebar"]:hover){background:var(--gc-sidebar-bg-hover, var(--gc-sidebar-bg, var(--sidebar-background))) !important;border-color:var(--gc-sidebar-border-hover, var(--gc-sidebar-border, var(--sidebar-border))) !important;}
    :where([data-sidebar="sidebar"]:hover){color:var(--gc-sidebar-text-hover, var(--gc-sidebar-text, var(--sidebar-foreground))) !important;}
    :where(.bookmark-icon:hover){color:var(--gc-bookmark-hover-hover, var(--gc-bookmark-hover, currentColor));}
  `.replace(/\s+/g, " ").trim());


  return parts.join("");
}
