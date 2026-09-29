// Shared by the SSR replay and the browser interception. A client-only fixture
// would be hidden by the fresh, disabled newsletter settings hydrated from SSR.
export const popupFixtureSettings = {
  popup_enabled: true,
  popup_trigger: "delay",
  popup_delay_seconds: 4,
  popup_layout: "showcase",
  popup_title_pl: "Załóż konto",
  popup_extended_fields: true,
  popup_showcase_rotate_ms: 30_000,
  popup_showcase_images: [0, 1, 2, 3].map((index) => ({
    url: `https://neweuropeanstrategies.com/media/popup-test/${index}.jpg`,
    title_pl: `Kadr ${index + 1}`,
    caption_pl: "Raporty i analizy",
  })),
};
