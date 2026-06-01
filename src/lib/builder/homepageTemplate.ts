// Builds a BuilderDocument that mirrors the index.tsx homepage layout
// using existing widgets — used by the page builder "Load homepage layout" action.
import type {
  BuilderDocument, SectionNode, ColumnNode, WidgetNode, WidgetType, WidgetContent,
} from "./types";
import { newId } from "./types";
import { WIDGET_MAP } from "./registry";

// --- helpers -----------------------------------------------------------------

const widget = (type: WidgetType, overrides: WidgetContent = {}): WidgetNode => {
  const def = WIDGET_MAP[type];
  const defaults = (def?.defaults?.() ?? {}) as WidgetContent;
  return {
    id: newId(),
    kind: "widget",
    type,
    content: { ...defaults, ...overrides },
  };
};

const column = (span: number, children: WidgetNode[] = []): ColumnNode => ({
  id: newId(), kind: "column", span: { desktop: span }, children,
});

const section = (cols: ColumnNode[], opts: Partial<SectionNode> = {}): SectionNode => ({
  id: newId(), kind: "section", children: cols, ...opts,
});

const boxedFull = { layout: { contentWidth: "boxed" as const, width: 1400 } };

// --- the document ------------------------------------------------------------

export function buildHomepageDocument(): BuilderDocument {
  return {
    version: 1,
    sections: [
      // 1) Hot topic bar
      section([
        column(12, [
          widget("hot-topic-bar", {
            badge_pl: "Hot topic", badge_en: "Hot topic",
            title_pl: "Najważniejszy temat dnia — kliknij, aby przeczytać.",
            title_en: "Today's top story — click to read.",
            iconName: "Flame",
          }),
        ]),
      ], boxedFull),

      // 2) Hero 3-col [3 | 6 | 3]
      section([
        column(3, [
          widget("section-label", {
            label_pl: "Najnowszy raport", label_en: "Latest report",
            color: "military", variant: "rect-bg",
            action_pl: "Więcej", action_en: "More",
          }),
          widget("post-list", { limit: 1, columns: 1, variant: "card" }),
          widget("section-label", {
            label_pl: "Nadchodzące wydarzenia", label_en: "Upcoming events",
            color: "brand", variant: "rect-bg",
            action_pl: "Więcej", action_en: "More",
          }),
          widget("post-list", { limit: 2, columns: 1, variant: "list" }),
        ]),
        column(6, [
          widget("heading", {
            text_pl: "Geopolityczna gra mocarstw",
            text_en: "The geopolitical game of powers",
            tag: "h1", variant: "default", sizePreset: "display",
          }),
          widget("text", {
            html_pl: "<p>Krótka zajawka centralnego artykułu, która zachęca do lektury i nadaje ton wydaniu.</p>",
            html_en: "<p>A short hero excerpt that sets the tone of the issue and invites the reader in.</p>",
          }),
          widget("image", { src: "", alt_pl: "", alt_en: "", ratio: "16/9", variant: "rounded" }),
        ]),
        column(3, [
          widget("section-label", {
            label_pl: "Zdaniem ekspertów", label_en: "Expert opinions",
            color: "#0a0a0a", variant: "rect-bg",
            action_pl: "Więcej", action_en: "More",
          }),
          widget("rated-list", {
            numberPosition: "right",
            showRating: true,
            showExcerpt: true,
            showAuthor: true,
            items: [
              { title_pl: "Między wielkością a zanikiem. Rzecz o Polsce w XXI wieku", title_en: "Between greatness and decline. On Poland in the 21st century", excerpt_pl: "Książka Bartłomieja Radziejewskiego, założyciela think-tanku Nowa Konfederacja, wzbudza we mnie wielki entuzjazm.", excerpt_en: "A brief expert review.", author: "Igor Miasnikow", rating: 8.3 },
              { title_pl: "Minister Radosław Sikorski: Polska może być lepsza w rywalizacji międzynarodowej", title_en: "Minister Sikorski: Poland can be better in international competition", excerpt_pl: "", excerpt_en: "", author: "Igor Miasnikow", rating: 0 },
              { title_pl: "Generał Skrzypczak: Wyzwania militarne dla strategii Polski w kontekście globalnej Gry Mocarstw", title_en: "General Skrzypczak on Poland's military challenges", excerpt_pl: "", excerpt_en: "", author: "Igor Miasnikow", rating: 0 },
              { title_pl: "Droga obalenia hegemonii funta i ustanowienie Imperium Dolara", title_en: "Toppling the pound, establishing the dollar empire", excerpt_pl: "", excerpt_en: "", author: "Igor Miasnikow", rating: 0 },
            ],
          }),
        ]),
      ], boxedFull),

      // 3) Interviews + Reports two-col
      section([
        column(6, [
          widget("section-label", {
            label_pl: "Wywiady i podcasty", text_en: "Interviews & podcasts",
            label_en: "Interviews & podcasts",
            color: "brand", variant: "rect-bg",
            action_pl: "Zobacz więcej", action_en: "See more",
          }),
          widget("dark-featured-card", {
            badge_pl: "GEOPOLITYCZNA GRA MOCARSTW",
            badge_en: "GEOPOLITICAL GAME OF POWERS",
            title_pl: "Wywiad miesiąca — rozmowa z generałem.",
            title_en: "Interview of the month — a conversation with the general.",
            excerpt_pl: "", excerpt_en: "",
            image: "",
          }),
        ]),
        column(6, [
          widget("section-label", {
            label_pl: "Nasze raporty", label_en: "Our reports",
            color: "military", variant: "rect-bg",
            action_pl: "Zobacz więcej", action_en: "See more",
          }),
          widget("post-list", { limit: 2, columns: 1, variant: "list" }),
        ]),
      ], boxedFull),

      // 4) Military & Geopolitics carousel (3-col)
      section([
        column(12, [
          widget("section-label", {
            label_pl: "Militaria i geopolityka", label_en: "Military & geopolitics",
            color: "military",
            action_pl: "zobacz więcej", action_en: "see more",
          }),
          widget("post-list", { limit: 3, columns: 3, variant: "card" }),
        ]),
      ], boxedFull),

      // 5) Finance + Book reviews [8 | 4]
      section([
        column(8, [
          widget("section-label", {
            label_pl: "Finanse i gospodarka", label_en: "Finance & economy",
            color: "finance",
            action_pl: "zobacz więcej", action_en: "see more",
          }),
          widget("post-list", { limit: 3, columns: 3, variant: "card" }),
        ]),
        column(4, [
          widget("heading", {
            text_pl: "Recenzje książek", text_en: "Book reviews",
            tag: "h2", sizePreset: "lg", variant: "highlight",
          }),
          widget("post-list", { limit: 1, columns: 1, variant: "card" }),
        ]),
      ], boxedFull),

      // 6) Empty category sections (3-col)
      section([
        column(4, [
          widget("section-label", {
            label_pl: "Transport i energetyka", label_en: "Transport & energy",
            color: "transport",
            action_pl: "zobacz więcej", action_en: "see more",
          }),
          widget("post-list", { limit: 2, columns: 1, variant: "minimal" }),
        ]),
        column(4, [
          widget("section-label", {
            label_pl: "Dyplomacja", label_en: "Diplomacy",
            color: "diplomacy",
            action_pl: "zobacz więcej", action_en: "see more",
          }),
          widget("post-list", { limit: 2, columns: 1, variant: "minimal" }),
        ]),
        column(4, [
          widget("section-label", {
            label_pl: "Cyberbezpieczeństwo", label_en: "Cybersecurity",
            color: "cyber",
            action_pl: "zobacz więcej", action_en: "see more",
          }),
          widget("post-list", { limit: 2, columns: 1, variant: "minimal" }),
        ]),
      ], boxedFull),

      // 7) Newsletter
      section([
        column(12, [
          widget("newsletter", {
            title_pl: "Zapisz się do newslettera",
            title_en: "Subscribe to the newsletter",
            variant: "card",
            placeholder_pl: "Twój email", placeholder_en: "Your email",
            cta_pl: "Zapisz się", cta_en: "Subscribe",
            iconName: "Mail",
          }),
        ]),
      ], boxedFull),

      // 8) Partner content (3-col)
      section([
        column(12, [
          widget("heading", {
            text_pl: "Treści partnerskie", text_en: "Partner content",
            tag: "h2", sizePreset: "lg", variant: "default",
          }),
          widget("post-list", { limit: 3, columns: 3, variant: "card" }),
        ]),
      ], boxedFull),
    ],
  };
}
