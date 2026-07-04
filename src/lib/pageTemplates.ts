// Page template presets. Used by:
//   - admin.pages.$slug to pick a template
//   - routes/$.tsx to render the right shell
//   - queries/public.ts to project the field on PageData
export type PageTemplateType = "default" | "full_width" | "landing" | "archive_listing" | "contact";

export interface PageTemplateSpec {
  id: PageTemplateType;
  label_pl: string;
  label_en: string;
  description_pl: string;
  description_en: string;
  /** Czy template ukrywa standardowy Header + Footer (np. landing). */
  bare: boolean;
  /** Czy template usuwa max-width kontenera (full-width). */
  fullWidth: boolean;
}

export const PAGE_TEMPLATES: readonly PageTemplateSpec[] = [
  {
    id: "default",
    label_pl: "Standardowa",
    label_en: "Default",
    description_pl: "Header, treść w kontenerze, Footer.",
    description_en: "Header, contained content, Footer.",
    bare: false,
    fullWidth: false,
  },
  {
    id: "full_width",
    label_pl: "Pełna szerokość",
    label_en: "Full-width",
    description_pl: "Header/Footer + treść bez ograniczenia max-width.",
    description_en: "Header/Footer + content without max-width limit.",
    bare: false,
    fullWidth: true,
  },
  {
    id: "landing",
    label_pl: "Landing (bez header/footer)",
    label_en: "Landing (no header/footer)",
    description_pl: "Czyste płótno - tylko treść strony.",
    description_en: "Clean canvas - content only.",
    bare: true,
    fullWidth: true,
  },
  {
    id: "archive_listing",
    label_pl: "Lista artykułów (archiwum)",
    label_en: "Archive listing",
    description_pl: "Strona renderuje listę opublikowanych wpisów dzieci.",
    description_en: "Page renders the list of child published posts.",
    bare: false,
    fullWidth: false,
  },
  {
    id: "contact",
    label_pl: "Kontakt",
    label_en: "Contact",
    description_pl: "Dodatkowy formularz kontaktowy pod treścią.",
    description_en: "Adds a contact form below content.",
    bare: false,
    fullWidth: false,
  },
] as const;

export function findPageTemplate(id: string | null | undefined): PageTemplateSpec {
  return PAGE_TEMPLATES.find((t) => t.id === id) ?? PAGE_TEMPLATES[0];
}
