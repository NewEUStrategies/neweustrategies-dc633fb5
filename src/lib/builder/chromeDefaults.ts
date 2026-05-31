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

export const defaultHeaderDoc = (): BuilderDocument => ({
  version: 1,
  sections: [
    // Utility bar: newsletter + social + auth + language
    section(
      [
        col(6, [
          widget("newsletter", { title_pl: "Newsletter", title_en: "Newsletter" }),
          widget("social-icons", {
            facebook: "#", twitter: "#", youtube: "#", instagram: "#", linkedin: "#",
            email: "", size: 16,
          }),
        ]),
        col(6, [
          widget("account-link", {
            signin_pl: "Zaloguj", signin_en: "Sign in",
            signup_pl: "Zarejestruj", signup_en: "Sign up",
            panel_pl: "Panel", panel_en: "Dashboard",
          }),
          widget("lang-switcher", { showLabel: true, label_pl: "Zmień język", label_en: "Switch language" }),
        ]),
      ],
      { layout: { contentWidth: "boxed", width: 1400, htmlTag: "div" } },
    ),
    // Centered logo
    section(
      [col(12, [widget("site-logo", {
        src: "", href: "/", showText: true,
        line1_pl: "New", line1_en: "New",
        line2_pl: "European", line2_en: "European",
        line3_pl: "Strategies", line3_en: "Strategies",
      })])],
      { layout: { contentWidth: "boxed", width: 1400, htmlTag: "div" }, style: { align: { desktop: "center" } } },
    ),
    // Nav bar: search + menu + theme toggle
    section(
      [
        col(3, [widget("search-button", { label_pl: "Szukaj", label_en: "Search" })]),
        col(7, [
          widget("nav-link", { label_pl: "Analizy",       label_en: "Analyses",      href: "#", variant: "text" }),
          widget("nav-link", { label_pl: "Wywiady",       label_en: "Interviews",    href: "#", variant: "text" }),
          widget("nav-link", { label_pl: "Policy Papers", label_en: "Policy Papers", href: "#", variant: "text" }),
          widget("nav-link", { label_pl: "Raporty",       label_en: "Reports",       href: "#", variant: "text" }),
          widget("nav-link", { label_pl: "Wydarzenia",    label_en: "Events",        href: "#", variant: "text" }),
          widget("nav-link", { label_pl: "O nas",         label_en: "About",         href: "#", variant: "text" }),
        ]),
        col(2, [widget("theme-toggle", {})]),
      ],
      { layout: { contentWidth: "boxed", width: 1400, htmlTag: "nav" } },
    ),
  ],
});

export const defaultFooterDoc = (): BuilderDocument => ({
  version: 1,
  sections: [
    section(
      [
        col(6, [
          widget("site-logo", {
            src: "", href: "/", showText: true,
            line1_pl: "New", line1_en: "New",
            line2_pl: "European", line2_en: "European",
            line3_pl: "Strategies", line3_en: "Strategies",
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
});

export const defaultMenuDoc = (): BuilderDocument => ({
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
});

export const defaultDocFor = (scope: "header" | "footer" | "menu"): BuilderDocument =>
  scope === "header" ? defaultHeaderDoc()
  : scope === "footer" ? defaultFooterDoc()
  : defaultMenuDoc();
