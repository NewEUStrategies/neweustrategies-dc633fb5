// Data-driven step arrays for the builder and block-editor first-use tours.
// Pure data referencing i18n keys and `data-tour` anchor names — no React, so
// they are trivial to unit-test and extend.
import type { TourStep } from "./types";

export const BUILDER_TOUR_STEPS: TourStep[] = [
  {
    id: "widgets",
    anchor: "builder-widgets",
    titleKey: "admin.onboarding.builder.widgets.title",
    bodyKey: "admin.onboarding.builder.widgets.body",
    placement: "right",
  },
  {
    id: "toolbar",
    anchor: "builder-toolbar",
    titleKey: "admin.onboarding.builder.toolbar.title",
    bodyKey: "admin.onboarding.builder.toolbar.body",
    placement: "bottom",
  },
  {
    id: "canvas",
    anchor: "builder-canvas",
    titleKey: "admin.onboarding.builder.canvas.title",
    bodyKey: "admin.onboarding.builder.canvas.body",
    placement: "left",
  },
  {
    id: "navigator",
    anchor: "builder-navigator",
    titleKey: "admin.onboarding.builder.navigator.title",
    bodyKey: "admin.onboarding.builder.navigator.body",
    placement: "right",
  },
];

export const BLOCK_TOUR_STEPS: TourStep[] = [
  {
    id: "lang",
    anchor: "blocks-lang",
    titleKey: "admin.onboarding.blocks.lang.title",
    bodyKey: "admin.onboarding.blocks.lang.body",
    placement: "bottom",
  },
  {
    id: "canvas",
    anchor: "blocks-canvas",
    titleKey: "admin.onboarding.blocks.canvas.title",
    bodyKey: "admin.onboarding.blocks.canvas.body",
    placement: "right",
  },
  {
    id: "history",
    anchor: "blocks-history",
    titleKey: "admin.onboarding.blocks.history.title",
    bodyKey: "admin.onboarding.blocks.history.body",
    placement: "bottom",
  },
  {
    id: "sidebar",
    anchor: "blocks-sidebar",
    titleKey: "admin.onboarding.blocks.sidebar.title",
    bodyKey: "admin.onboarding.blocks.sidebar.body",
    placement: "left",
  },
];

// Zakładka „Ścieżki” huba (S8): pasek zdrowia, lista, galeria i ustawienia
// silnika. Galeria i dialog ustawień są w drzewie tylko otwarte - wtedy krok
// bez kotwicy rysuje się jako karta na środku (zachowanie `CoachmarkTour`).
export const JOURNEYS_TOUR_STEPS: TourStep[] = [
  {
    id: "engine",
    anchor: "journeys-engine",
    titleKey: "admin.onboarding.journeys.engine.title",
    bodyKey: "admin.onboarding.journeys.engine.body",
    placement: "bottom",
  },
  {
    id: "list",
    anchor: "journeys-list",
    titleKey: "admin.onboarding.journeys.list.title",
    bodyKey: "admin.onboarding.journeys.list.body",
    placement: "top",
  },
  {
    id: "gallery",
    anchor: "journeys-gallery",
    titleKey: "admin.onboarding.journeys.gallery.title",
    bodyKey: "admin.onboarding.journeys.gallery.body",
    placement: "top",
  },
  {
    id: "settings",
    anchor: "journeys-engine-settings",
    titleKey: "admin.onboarding.journeys.settings.title",
    bodyKey: "admin.onboarding.journeys.settings.body",
    placement: "left",
  },
];

// Edytor ścieżki (S8): kanwa i przycisk publikacji w pasku (ten sam atrybut
// nosi otwarty dialog publikacji).
export const JOURNEY_EDITOR_TOUR_STEPS: TourStep[] = [
  {
    id: "canvas",
    anchor: "journey-canvas",
    titleKey: "admin.onboarding.journeyEditor.canvas.title",
    bodyKey: "admin.onboarding.journeyEditor.canvas.body",
    placement: "top",
  },
  {
    id: "publish",
    anchor: "journey-publish",
    titleKey: "admin.onboarding.journeyEditor.publish.title",
    bodyKey: "admin.onboarding.journeyEditor.publish.body",
    placement: "bottom",
  },
];
