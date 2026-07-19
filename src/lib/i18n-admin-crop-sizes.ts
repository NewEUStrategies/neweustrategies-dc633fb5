// Zasoby i18n dla /admin/crop-sizes - edytor globalnych presetów kadrowania.
import i18n from "@/lib/i18n";

const pl = {
  adminCropSizes: {
    pageTitle: "Custom crop sizes",
    intro:
      "Globalne presety kadrów obrazków (ratio + rozmiar w px). Generują wariantowe URL-e przez Supabase Storage image transforms.",
    sectionEdit: "Edycja",
    sectionNew: "Nowy preset",
    name: "Nazwa",
    namePlaceholder: "np. card-4-3",
    ratioW: "Ratio W",
    ratioH: "Ratio H",
    width: "Width (px)",
    height: "Height (px)",
    order: "Kolejność",
    presets: "Presety ({{count}})",
    regenerate: "Regeneruj miniatury",
    regenStatus: "Media: {{media}} | rozmiary: {{sizes}} | OK: {{ok}} | błędy: {{failed}}",
    edit: "Edytuj",
    remove: "Usuń",
    empty: "Brak presetów.",
    removeConfirmTitle: "Usunąć preset?",
    removeConfirmLabel: "Usuń",
  },
};

const en = {
  adminCropSizes: {
    pageTitle: "Custom crop sizes",
    intro:
      "Global image crop presets (ratio + size in px). They generate variant URLs via Supabase Storage image transforms.",
    sectionEdit: "Edit",
    sectionNew: "New preset",
    name: "Name",
    namePlaceholder: "e.g. card-4-3",
    ratioW: "Ratio W",
    ratioH: "Ratio H",
    width: "Width (px)",
    height: "Height (px)",
    order: "Order",
    presets: "Presets ({{count}})",
    regenerate: "Regenerate thumbnails",
    regenStatus: "Media: {{media}} | sizes: {{sizes}} | OK: {{ok}} | errors: {{failed}}",
    edit: "Edit",
    remove: "Delete",
    empty: "No presets yet.",
    removeConfirmTitle: "Delete preset?",
    removeConfirmLabel: "Delete",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);
