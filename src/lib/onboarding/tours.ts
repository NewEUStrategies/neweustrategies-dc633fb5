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
