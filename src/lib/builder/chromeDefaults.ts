// Default builder documents for the Header / Footer / Menu editors.
// On first open of /admin/appearance/{header,footer,menu}, if the stored
// builder_data is empty we seed it with these so every part of the live
// chrome appears as editable widgets/sections.
import type { BuilderDocument, SectionNode, ColumnNode, WidgetNode } from "./types";
import { newId } from "./types";

const widget = (type: WidgetNode["type"], content: WidgetNode["content"]): WidgetNode => ({
  id: newId(), kind: "widget", type, content,
});

const col = (span: number, children: WidgetNode[]): ColumnNode => ({
  id: newId(), kind: "column", span: { desktop: span }, children,
});

const section = (children: ColumnNode[], opts: Partial<SectionNode> = {}): SectionNode => ({
  id: newId(), kind: "section", children, ...opts,
});

/**
 * Rewrite every node id to a stable, position-derived value. These documents
 * are rendered as the LIVE fallback whenever the corresponding chrome setting
 * is missing, so they are built independently on the server and in the
 * browser. With random `newId()` ids the two renders disagree on every
 * `data-*-id` attribute, React 19 declares a hydration mismatch and rebuilds
 * the entire tree client-side (blank flash + every query refetching).
 * Position-based ids make both sides agree; per-scope prefixes keep them
 * unique when several fallback docs render on one page.
 */
function withStableIds(doc: BuilderDocument, prefix: string): BuilderDocument {
  return {
    ...doc,
    sections: doc.sections.map((s, si) => ({
      ...s,
      id: `${prefix}-s${si}`,
      children: (s.children ?? []).map((child, ci) => {
        if (child.kind === "inner-section") {
          return {
            ...child,
            id: `${prefix}-s${si}-i${ci}`,
            columns: (child.columns ?? []).map((c, cci) => ({
              ...c,
              id: `${prefix}-s${si}-i${ci}-c${cci}`,
              children: (c.children ?? []).map((w, wi) => ({
                ...w,
                id: `${prefix}-s${si}-i${ci}-c${cci}-w${wi}`,
              })),
            })),
          };
        }
        return {
          ...child,
          id: `${prefix}-s${si}-c${ci}`,
          children: (child.children ?? []).map((w, wi) => ({
            ...w,
            id: `${prefix}-s${si}-c${ci}-w${wi}`,
          })),
        };
      }),
    })),
  };
}

export const defaultHeaderDoc = (): BuilderDocument => withStableIds({
  version: 1,
  sections: [
    // Row 1 - utility bar: newsletter + socials | logo (center) | language switcher
    section(
      [
        col(4, [
          widget("newsletter", { title_pl: "Newsletter", title_en: "Newsletter", variant: "link" }),
          widget("social-icons", {
            facebook: "#", twitter: "#", youtube: "#", instagram: "#",
            linkedin: "#", spotify: "#", email: "", size: 16,
          }),
        ]),
        col(4, [
          widget("image", {
            src: "", alt_pl: "Logo", alt_en: "Logo", href: "/", maxWidth: "200px",
          }),
        ]),
        col(4, [
          widget("lang-switcher", {
            showLabel: true,
            label_pl: "Zmień język",
            label_en: "Switch language",
          }),
        ]),
      ],
      {
        layout: { contentWidth: "boxed", width: 1400, htmlTag: "div", verticalAlign: "middle" },
        style: { padding: { desktop: "16px 24px" }, align: { desktop: "center" } },
      },
    ),
    // Row 2 - nav bar: search | menu (center) | account + theme toggle
    section(
      [
        col(3, [widget("search-button", { label_pl: "Szukaj", label_en: "Search", variant: "input" })]),
        col(6, [
          widget("nav-link", { label_pl: "Analizy",       label_en: "Analyses",      href: "#", variant: "text" }),
          widget("nav-link", { label_pl: "Wywiady",       label_en: "Interviews",    href: "#", variant: "text" }),
          widget("mega-menu", {
            trigger_pl: "Tematy", trigger_en: "Topics",
            triggerOn: "hover", width: "container", widthPx: 1140,
            columns: [
              {
                title_pl: "Analizy", title_en: "Analyses",
                links: [
                  { label_pl: "Bezpieczeństwo", label_en: "Security", href: "#" },
                  { label_pl: "Gospodarka",     label_en: "Economy",  href: "#" },
                  { label_pl: "Polityka",       label_en: "Politics", href: "#" },
                ],
                featured: null,
              },
              {
                title_pl: "Formaty", title_en: "Formats",
                links: [
                  { label_pl: "Policy Papers", label_en: "Policy Papers", href: "#" },
                  { label_pl: "Wywiady",       label_en: "Interviews",    href: "#" },
                  { label_pl: "Raporty",       label_en: "Reports",       href: "#" },
                ],
                featured: null,
              },
              {
                title_pl: "Wyróżnione", title_en: "Featured",
                links: [],
                featured: {
                  image: "",
                  title_pl: "Najnowszy raport",
                  title_en: "Latest report",
                  excerpt_pl: "Przegląd kluczowych trendów geopolitycznych.",
                  excerpt_en: "Key geopolitical trends overview.",
                  href: "#", cta_pl: "Czytaj", cta_en: "Read",
                },
              },
            ],
          }),
          widget("nav-link", { label_pl: "Wydarzenia",    label_en: "Events",        href: "#", variant: "text" }),
          widget("nav-link", { label_pl: "O nas",         label_en: "About",         href: "#", variant: "text" }),
        ]),
        col(3, [
          widget("account-link", {
            signin_pl: "Zaloguj", signin_en: "Sign in",
            signup_pl: "Zarejestruj", signup_en: "Sign up",
            panel_pl: "Witaj", panel_en: "Welcome",
          }),
          widget("theme-toggle", {}),
        ]),
      ],
      {
        layout: { contentWidth: "boxed", width: 1400, htmlTag: "nav", verticalAlign: "middle" },
        style: { padding: { desktop: "12px 24px" } },
        border: {
          style: "solid",
          width: { top: 1, bottom: 1 },
          color: "color-mix(in oklab, currentColor 10%, transparent)",
        },
      },
    ),
  ],
}, "hdr-default");

export const defaultFooterDoc = (): BuilderDocument => withStableIds({
  version: 1,
  sections: [
    section(
      [
        col(6, [
          widget("image", {
            src: "", alt_pl: "Logo", alt_en: "Logo", href: "/", maxWidth: "180px",
          }),
          widget("text", {
            html_pl: "<p>Naszym celem jest zdefiniowanie przyszłości europejskiego bezpieczeństwa.</p>",
            html_en: "<p>Our mission is to shape the future of European security.</p>",
          }),
        ]),
        col(3, [
          widget("heading", { text_pl: "Poznaj nas lepiej", text_en: "Know us better", tag: "h4" }),
          widget("nav-link", { label_pl: "O nas",       label_en: "About",      href: "#", variant: "text" }),
          widget("nav-link", { label_pl: "Kontakt",     label_en: "Contact",    href: "#", variant: "text" }),
          widget("nav-link", { label_pl: "Newsletter",  label_en: "Newsletter", href: "#", variant: "text" }),
        ]),
        col(3, [
          widget("heading", { text_pl: "Współpraca", text_en: "Work with us", tag: "h4" }),
          widget("nav-link", { label_pl: "Reklamuj się u nas", label_en: "Advertise", href: "#", variant: "text" }),
          widget("nav-link", { label_pl: "Wydarzenia",          label_en: "Events",    href: "#", variant: "text" }),
          widget("nav-link", { label_pl: "Projekty",            label_en: "Projects",  href: "#", variant: "text" }),
        ]),
      ],
      { layout: { contentWidth: "boxed", width: 1400, htmlTag: "div" } },
    ),
    section(
      [col(12, [widget("copyright", {
        text_pl: "Wszelkie prawa zastrzeżone",
        text_en: "All rights reserved",
        showYear: true,
        brand: "New European Strategies",
      })])],
      { layout: { contentWidth: "full", htmlTag: "div" } },
    ),
  ],
}, "ftr-default");

export const defaultMenuDoc = (): BuilderDocument => withStableIds({
  version: 1,
  sections: [
    section(
      [col(12, [
        widget("nav-link", { label_pl: "Analizy",       label_en: "Analyses",      href: "#", variant: "text" }),
        widget("nav-link", { label_pl: "Wywiady",       label_en: "Interviews",    href: "#", variant: "text" }),
        widget("nav-link", { label_pl: "Policy Papers", label_en: "Policy Papers", href: "#", variant: "text" }),
        widget("nav-link", { label_pl: "Raporty",       label_en: "Reports",       href: "#", variant: "text" }),
        widget("nav-link", { label_pl: "Wydarzenia",    label_en: "Events",        href: "#", variant: "text" }),
        widget("nav-link", { label_pl: "O nas",         label_en: "About",         href: "#", variant: "text" }),
      ])],
      { layout: { contentWidth: "boxed", width: 1400, htmlTag: "nav" } },
    ),
  ],
}, "menu-default");

export const defaultDocFor = (scope: "header" | "footer" | "menu"): BuilderDocument =>
  scope === "header" ? defaultHeaderDoc()
  : scope === "footer" ? defaultFooterDoc()
  : defaultMenuDoc();
