// Branding jednego wydarzenia - wersja robocza i kontrakt zapisu.
//
// KLUCZ NIEOBECNY = DZIEDZICZENIE. Pusty slot nie znaczy „bialy", tylko „wez
// z motywu globalnego". Dlatego „Przywroc branding spolecznosci" USUWA klucze,
// a nie zapisuje wartosci domyslnych: wydarzenie z zapisana kopia dzisiejszych
// kolorow przestaloby reagowac na zmiane motywu serwisu i po pol roku wygladalo
// by jak stara wersja marki.
//
// ZBIOR SLOTOW JEST WASKI I ZAMKNIETY. Branding wydarzenia to nie drugi edytor
// motywu: piec kolorow i obraz tla pokrywaja to, co widzi uczestnik, a kazdy
// dodatkowy slot to kolejny sposob na zlozenie strony nieczytelnej.
//
// GRANICA WARSTW: zero Reacta, zero i18next, zero klienta bazy.

export const EVENT_BRANDING_APPEARANCES = ["light", "dark"] as const;
export type EventBrandingAppearance = (typeof EVENT_BRANDING_APPEARANCES)[number];

/** Sloty kolorow. Kolejnosc jest kolejnoscia na ekranie. */
export const EVENT_BRANDING_COLOR_SLOTS = [
  "navigation",
  "main_action",
  "text",
  "blocks_background",
  "page_background",
] as const;
export type EventBrandingColorSlot = (typeof EVENT_BRANDING_COLOR_SLOTS)[number];

export const EVENT_BRANDING_SLOT_LABEL_KEYS: Record<EventBrandingColorSlot, string> = {
  navigation: "adminEvents.branding.slots.navigation",
  main_action: "adminEvents.branding.slots.mainAction",
  text: "adminEvents.branding.slots.text",
  blocks_background: "adminEvents.branding.slots.blocksBackground",
  page_background: "adminEvents.branding.slots.pageBackground",
};

export const EVENT_BRANDING_SLOT_HINT_KEYS: Record<EventBrandingColorSlot, string> = {
  navigation: "adminEvents.branding.hints.navigation",
  main_action: "adminEvents.branding.hints.mainAction",
  text: "adminEvents.branding.hints.text",
  blocks_background: "adminEvents.branding.hints.blocksBackground",
  page_background: "adminEvents.branding.hints.pageBackground",
};

export interface EventBrandingDraft {
  appearance: EventBrandingAppearance;
  /** Pusty napis = slot dziedziczony z motywu globalnego. */
  colors: Record<EventBrandingColorSlot, string>;
  backgroundImage: string;
}

export const EMPTY_EVENT_BRANDING: EventBrandingDraft = {
  appearance: "light",
  colors: {
    navigation: "",
    main_action: "",
    text: "",
    blocks_background: "",
    page_background: "",
  },
  backgroundImage: "",
};

const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

export function eventBrandingFromJson(value: unknown): EventBrandingDraft {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY_EVENT_BRANDING, colors: { ...EMPTY_EVENT_BRANDING.colors } };
  }
  const source = value as Record<string, unknown>;
  const appearance = readString(source, "appearance");
  const colors = { ...EMPTY_EVENT_BRANDING.colors };
  for (const slot of EVENT_BRANDING_COLOR_SLOTS) {
    const raw = readString(source, slot).trim().toUpperCase();
    colors[slot] = HEX_PATTERN.test(raw) ? raw : "";
  }
  return {
    appearance: (EVENT_BRANDING_APPEARANCES as readonly string[]).includes(appearance)
      ? (appearance as EventBrandingAppearance)
      : "light",
    colors,
    backgroundImage: readString(source, "background_image").trim(),
  };
}

export interface EventBrandingError {
  slot: EventBrandingColorSlot | "backgroundImage";
  messageKey: string;
}

export function validateEventBranding(draft: EventBrandingDraft): readonly EventBrandingError[] {
  const errors: EventBrandingError[] = [];
  for (const slot of EVENT_BRANDING_COLOR_SLOTS) {
    const value = draft.colors[slot].trim();
    if (value !== "" && !HEX_PATTERN.test(value)) {
      errors.push({ slot, messageKey: "adminEvents.branding.errors.colorInvalid" });
    }
  }
  const image = draft.backgroundImage.trim();
  if (image !== "" && !/^https:\/\/\S+$/.test(image)) {
    errors.push({
      slot: "backgroundImage",
      messageKey: "adminEvents.branding.errors.imageInvalid",
    });
  }
  return errors;
}

/** Payload dla `admin_event_branding_save`. Slot pusty NIE wchodzi do obiektu. */
export function eventBrandingPayload(draft: EventBrandingDraft): Record<string, string> {
  const payload: Record<string, string> = { appearance: draft.appearance };
  for (const slot of EVENT_BRANDING_COLOR_SLOTS) {
    const value = draft.colors[slot].trim().toUpperCase();
    if (value !== "") payload[slot] = value;
  }
  const image = draft.backgroundImage.trim();
  if (image !== "") payload["background_image"] = image;
  return payload;
}

export function eventBrandingDirty(a: EventBrandingDraft, b: EventBrandingDraft): boolean {
  return JSON.stringify(eventBrandingPayload(a)) !== JSON.stringify(eventBrandingPayload(b));
}
