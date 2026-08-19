// Reguły podglądu maili autoryzacyjnych i aplikacyjnych.
//
// PO CO OSOBNO. Ten panel jest ostatnim miejscem, w którym da się zobaczyć maila
// PRZED wysyłką do prawdziwego adresata. Reguły, których pomyłka jest cicha:
//
//   * ETYKIETA TYPU. `type` przychodzi z serwera jako zwykły napis. Typ bez
//     etykiety nie może zostawić pustej pozycji na liście - operator nie
//     potrafiłby wtedy wybrać szablonu, którego nie widzi.
//   * DOMYŚLNY TYP PO ZMIANIE ZAKRESU. Zakresy „auth" i „app" mają rozłączne
//     zestawy szablonów; zostawienie starego typu pokazuje puste okno podglądu.
//   * WYBÓR AKTYWNEGO SZABLONU schodzi na PIERWSZY z listy, gdy wybranego nie ma
//     w tym zakresie albo języku - puste okno operator czyta jako awarię panelu.
export type PreviewLang = "pl" | "en";
export type PreviewGender = "male" | "female" | "unknown";
export type PreviewDevice = "desktop" | "mobile";
export type PreviewScope = "auth" | "app";

/**
 * `type` przychodzi z serwera jako zwykły napis, więc mapa zostaje mapą - tylko
 * z KLUCZEM tłumaczenia zamiast pary `{ pl, en }`. Klucze wypisane literalnie
 * (nie składane szablonem), żeby bramka pokrycia je widziała, a nieznany typ
 * nadal miał czym się awaryjnie wyrenderować.
 */
export const TYPE_LABEL_KEYS: Record<string, string> = {
  signup: "adminNewsletter.emailPreview.types.signup",
  magiclink: "adminNewsletter.emailPreview.types.magiclink",
  recovery: "adminNewsletter.emailPreview.types.recovery",
  invite: "adminNewsletter.emailPreview.types.invite",
  email_change: "adminNewsletter.emailPreview.types.email_change",
  reauthentication: "adminNewsletter.emailPreview.types.reauthentication",
  subscription_confirmed: "adminNewsletter.emailPreview.types.subscription_confirmed",
  subscription_renewed: "adminNewsletter.emailPreview.types.subscription_renewed",
  subscription_canceled: "adminNewsletter.emailPreview.types.subscription_canceled",
  subscription_upgraded: "adminNewsletter.emailPreview.types.subscription_upgraded",
  subscription_downgraded: "adminNewsletter.emailPreview.types.subscription_downgraded",
  subscription_paused: "adminNewsletter.emailPreview.types.subscription_paused",
  subscription_resumed: "adminNewsletter.emailPreview.types.subscription_resumed",
  team_seat_grace: "adminNewsletter.emailPreview.types.team_seat_grace",
  team_seat_grace_reminder: "adminNewsletter.emailPreview.types.team_seat_grace_reminder",
  team_seat_access_ended: "adminNewsletter.emailPreview.types.team_seat_access_ended",
  event_registered: "adminNewsletter.emailPreview.types.event_registered",
  newsletter_confirmed: "adminNewsletter.emailPreview.types.newsletter_confirmed",
};

/** Klucz etykiety typu; typ nieznany mapie oddaje `null` (podpis schodzi na typ). */
export function previewTypeLabelKey(type: string): string | null {
  return TYPE_LABEL_KEYS[type] ?? null;
}

/**
 * Typ, na który przestawia się panel po zmianie zakresu. Zakresy mają rozłączne
 * zestawy szablonów, więc stary typ pokazywałby puste okno podglądu.
 */
export function defaultTypeForScope(scope: PreviewScope): string {
  return scope === "auth" ? "signup" : "subscription_confirmed";
}

export interface PreviewRow {
  type: string;
  lang: PreviewLang;
  subject: string;
  html: string;
  text: string;
}

/**
 * Aktywny podgląd: wybrany typ, a gdy go w tym zestawie nie ma - PIERWSZY z
 * listy. `undefined` tylko wtedy, gdy lista jest pusta (jeszcze się wczytuje).
 */
export function activePreview<T extends { type: string }>(
  rows: readonly T[] | undefined,
  activeType: string,
): T | undefined {
  return rows?.find((p) => p.type === activeType) ?? rows?.[0];
}

/** Szerokość ramki podglądu: telefon 390 px, monitor 720 px. */
export function frameMaxWidth(device: PreviewDevice): number {
  return device === "mobile" ? 390 : 720;
}

/** Imię do podstawienia; puste i same spacje znaczą „bez imienia". */
export function previewFirstName(raw: string): string | null {
  return raw.trim() ? raw.trim() : null;
}
