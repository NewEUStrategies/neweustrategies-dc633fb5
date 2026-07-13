// Startowe layouty strony eksperta - budowane z istniejących widgetów
// (heading/text/section-label/post-author-card/post-list/cta/newsletter/divider).
// Trafiają do builder_templates ze scope='expert_profile' - admin przypisuje je
// per-ekspert w ExpertLayoutSettingsDialog albo używa jako punkt startowy dla
// globalnego layoutu (site_settings.expert_profile_layout).
import type {
  BuilderDocument,
  ColumnNode,
  SectionNode,
  WidgetContent,
  WidgetNode,
  WidgetType,
} from "@/lib/builder/types";
import { newId } from "@/lib/builder/types";
import { WIDGET_MAP } from "@/lib/builder/registry";

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
  id: newId(),
  kind: "column",
  span: { desktop: span },
  children,
});

const section = (cols: ColumnNode[], opts: Partial<SectionNode> = {}): SectionNode => ({
  id: newId(),
  kind: "section",
  children: cols,
  ...opts,
});

const boxed = { layout: { contentWidth: "boxed" as const, width: 1200 } };

// --- Szablon 1: CSIS Classic ------------------------------------------------
// Hero z portretem, biogramem i CTA + lista publikacji + newsletter.
function buildCsisClassic(): BuilderDocument {
  return {
    version: 1,
    sections: [
      section(
        [
          column(4, [widget("post-author-card", { variant: "card", showSocial: true })]),
          column(8, [
            widget("heading", {
              level: 1,
              text_pl: "Ekspert",
              text_en: "Expert",
            }),
            widget("text", {
              text_pl:
                "Wprowadzenie - kilka zdań o obszarach eksperckich, doświadczeniu i doradztwie.",
              text_en:
                "A short intro - areas of expertise, background and advisory experience.",
            }),
            widget("cta", {
              title_pl: "Umów rozmowę",
              title_en: "Book a call",
            }),
          ]),
        ],
        boxed,
      ),
      section(
        [
          column(12, [
            widget("section-label", {
              label_pl: "Najnowsze publikacje",
              label_en: "Latest publications",
            }),
            widget("post-list", { limit: 6, layout: "grid", columns: 3 }),
          ]),
        ],
        boxed,
      ),
      section(
        [column(12, [widget("newsletter", {})])],
        boxed,
      ),
    ],
  };
}

// --- Szablon 2: Minimal -----------------------------------------------------
// Prosta karta + jedno-kolumnowa lista treści.
function buildMinimal(): BuilderDocument {
  return {
    version: 1,
    sections: [
      section(
        [column(12, [widget("post-author-card", { variant: "row", showSocial: true })])],
        boxed,
      ),
      section(
        [
          column(12, [
            widget("section-label", {
              label_pl: "Materiały",
              label_en: "Materials",
            }),
            widget("post-list", { limit: 8, layout: "list" }),
          ]),
        ],
        boxed,
      ),
    ],
  };
}

// --- Szablon 3: Rozszerzony -------------------------------------------------
// Hero + biogram + zakładki + newsletter + CTA kontakt.
function buildExtended(): BuilderDocument {
  return {
    version: 1,
    sections: [
      section(
        [
          column(4, [widget("post-author-card", { variant: "card", showSocial: true })]),
          column(8, [
            widget("heading", {
              level: 1,
              text_pl: "O ekspercie",
              text_en: "About the expert",
            }),
            widget("text", {
              text_pl:
                "Pełen biogram - wykształcenie, doświadczenie, obszary badawcze i publikacje kluczowe.",
              text_en:
                "Full bio - education, experience, research areas and key publications.",
            }),
          ]),
        ],
        boxed,
      ),
      section(
        [
          column(8, [
            widget("section-label", {
              label_pl: "Ostatnie publikacje",
              label_en: "Latest publications",
            }),
            widget("post-list", { limit: 6, layout: "grid", columns: 2 }),
          ]),
          column(4, [
            widget("section-label", {
              label_pl: "Kontakt",
              label_en: "Contact",
            }),
            widget("cta", {
              title_pl: "Napisz do eksperta",
              title_en: "Contact the expert",
            }),
            widget("divider", {}),
            widget("newsletter", {}),
          ]),
        ],
        boxed,
      ),
    ],
  };
}

export interface ExpertStarterTemplate {
  name: string;
  description_pl: string;
  description_en: string;
  build: () => BuilderDocument;
}

export const EXPERT_STARTER_TEMPLATES: ExpertStarterTemplate[] = [
  {
    name: "Strona eksperta - CSIS Classic",
    description_pl:
      "Hero z portretem, biogramem i CTA, sekcja publikacji i newsletter. Bezpieczny wybór dla większości ekspertów.",
    description_en:
      "Hero with portrait, bio and CTA, publications section and newsletter. A safe default for most experts.",
    build: buildCsisClassic,
  },
  {
    name: "Strona eksperta - Minimal",
    description_pl: "Karta autora + jedna kolumna materiałów. Dla ekspertów bez rozbudowanej treści.",
    description_en: "Author card + single column of materials. For experts with lean content.",
    build: buildMinimal,
  },
  {
    name: "Strona eksperta - Rozszerzony",
    description_pl:
      "Dwukolumnowy układ: publikacje po lewej, sidebar kontaktowy i newsletter po prawej.",
    description_en:
      "Two-column layout: publications on the left, contact sidebar and newsletter on the right.",
    build: buildExtended,
  },
];
