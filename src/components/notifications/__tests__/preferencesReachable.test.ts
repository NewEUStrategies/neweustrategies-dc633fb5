// Regresja na LUKE PRODUKTOWA, nie na render: zakladka preferencji powiadomien
// musi byc osiagalna z nawigacji.
//
// Do 12.08 `NotificationsCenter` mial cztery tryby, ale zakladka „Ustawienia"
// pokazuje sie tylko gdy `showSettingsTab` jest prawdziwe - czyli w trybach
// `full` i `preferences`. Jedyne dwa montowania komponentu w calej aplikacji
// (/messages) uzywaly trybow `inbox` i `consents`, dla ktorych ta zakladka jest
// ukryta. Skutek: opt-in Web Push, digest e-mail, grupowanie rozmow i przelacznik
// dzwonka byly zaimplementowane i CALKOWICIE niedostepne dla uzytkownika.
//
// Test celuje w trzy warunki tej osiagalnosci naraz, bo zlamanie ktoregokolwiek
// z nich przywraca luke po cichu: (1) istnieje trasa montujaca tryb z zakladka
// ustawien, (2) nawigacja profilu do niej linkuje, (3) warunek widocznosci
// zakladki nadal przepuszcza ten tryb.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROUTE = readFileSync("src/routes/profile.notifications.tsx", "utf8");
const NAV = readFileSync("src/components/profile/ProfileNav.tsx", "utf8");
const CENTER = readFileSync("src/components/notifications/NotificationsCenter.tsx", "utf8");

describe("osiagalnosc ustawien powiadomien", () => {
  it("trasa /profile/notifications montuje tryb odslaniajacy zakladke ustawien", () => {
    expect(ROUTE).toContain('createFileRoute("/profile/notifications")');
    expect(ROUTE).toMatch(/<NotificationsCenter\s+mode="(preferences|full)"\s*\/>/);
  });

  it("nawigacja profilu linkuje do tej trasy", () => {
    expect(NAV).toContain('to: "/profile/notifications"');
  });

  it("warunek widocznosci zakladki nadal przepuszcza tryb preferences", () => {
    // Gdyby ktos dopisal `mode !== "preferences"` do tego warunku, trasa
    // renderowalaby pusta strone - a poprzednie dwie asercje nadal by przeszly.
    const match = CENTER.match(/const showSettingsTab = (.+);/);
    expect(match, "nie znaleziono definicji showSettingsTab").not.toBeNull();
    expect(match?.[1]).not.toContain('mode !== "preferences"');
  });

  it("etykieta nawigacji ma klucz i18n, nie literal", () => {
    expect(NAV).toContain('key: "notificationSettings"');
  });
});
