// PIĘĆ CIENKICH TRAS PANELU KONTA, które nie mają własnej logiki, tylko
// SKŁADAJĄ powierzchnię z organizmów: `/profile/billing`, `/profile/interests`,
// `/profile/notifications`, `/profile/payments`, `/profile/privacy`.
// Wszystkie stały na okrągłym zerze.
//
// CO TEN PLIK DOWODZI - I DLACZEGO SKŁAD STRONY JEST TU RZECZĄ WARTĄ DOWODU.
//
// W tych trasach nie ma warunków ani zapytań; cała ich treść to ODPOWIEDŹ NA
// PYTANIE „co stoi na tej stronie i w jakiej kolejności". Dokładnie to zostało
// przebudowane w audycie IA (§10 prywatność, §11 finanse) i dokładnie to potrafi
// się cicho rozjechać: usunięty organizm nie wywala buildu, nie rzuca błędem
// i nie psuje żadnego innego testu - po prostu jednego dnia użytkownik nie
// znajduje faktury tam, gdzie mu ją obiecano.
//
//   1. `/profile/payments` JEST JEDNYM MIEJSCEM NA PIENIĄDZE. Zamówienia
//      i dokumenty rozliczeniowe przeniesiono tu z `/profile/orders`, a stary
//      adres jest przekierowaniem. Jeśli którakolwiek z tych kart zniknie
//      z tej strony, przekierowanie prowadzi w miejsce, gdzie danych NIE MA -
//      i wtedy konsolidacja zamienia się w utratę powierzchni.
//   2. `/profile/privacy` MA KOLEJNOŚĆ ROSNĄCEJ NIEODWRACALNOŚCI: widoczność
//      i kontakt (zmieniane codziennie), zgody (rzadko, audytowane), prawa do
//      danych - eksport i USUNIĘCIE KONTA (raz w życiu). Wywrócenie tej
//      kolejności stawia „usuń konto" nad codziennym przełącznikiem.
//   3. ŹRÓDŁO DECYZJI O ZGODZIE JEDZIE DO REJESTRU RODO. `ConsentsPanel`
//      dostaje `source="profile_privacy"`; ta wartość ląduje w audytowanym
//      wpisie. Zła etykieta przypisuje decyzję niewłaściwej powierzchni,
//      czyli psuje dowód zgody, a nie tylko statystykę.
//   4. PRZYCISK BANERA COOKIE DZIAŁA PRZED ZAMONTOWANIEM BANERA. Baner jest
//      leniwym chunkiem; żądanie otwarcia preferencji odkłada się w stanie
//      modułu i baner konsumuje je przy montażu. Test woła PRAWDZIWY
//      `consumeOpenPrefsRequest`, bo dowodem jest to, że klik nie przepada.
//   5. `/profile/notifications` MONTUJE CENTRUM W TRYBIE `preferences`.
//      Zakładka ustawień istnieje wyłącznie w trybach `full` i `preferences`;
//      w trybie `inbox` albo `consents` cała ta strona byłaby pusta - i przez
//      wiele wersji dokładnie tak było (patrz nagłówek trasy).
//   6. SŁOWNIK JEST REJESTROWANY W CHUNKU TRASY, ZANIM COKOLWIEK SIĘ
//      WYRENDERUJE. Wywołanie `ensureI18n()` nie jest ozdobą: bez nazwanego
//      wiązania splitter SSR wycinał import słownika, serwer renderował surowe
//      klucze, a klient podmieniał je po hydracji - React #418.
//   7. ŻADNA PODSTRONA KONTA NIE TRAFIA DO WYSZUKIWARKI. Dwie mają własny
//      `head()` z `noindex`, trzy dziedziczą go z powłoki `/profile` - i tu
//      liczy się EFEKT, nie to, która warstwa go daje.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - ORGANIZMÓW: `BillingProfileForm`, `PaymentHistoryCard`, `OrdersTableCard`,
//   `BillingDocumentsCard`, `InvoiceLookupCard`, `HowPaymentsWorkCard`,
//   `NotificationsCenter`, `ConsentsPanel`, `VisibilityAndContactSection`,
//   `DataRightsSection`, `InterestsCustomizer` - każdy ma (albo ma mieć) własny
//   plik testowy. Tutaj są atrapami-markerami, bo przedmiotem dowodu jest to,
//   KTÓRE z nich trasa montuje, z czym i w jakiej kolejności.
// - POWŁOKI `/profile` (bramka sesji, szuflada, `noindex` layoutu):
//   `src/routes/__tests__/profileShellRoutes.test.tsx`. Stąd czytamy wyłącznie
//   `head()` layoutu, żeby policzyć EFEKTYWNE `robots` podstron.
// - PRZEKIEROWAŃ ZE STARYCH ADRESÓW (`/profile/orders`, `/profile/social`,
//   `/profile/subscription`): `profileRedirectRoutes.test.tsx`.
// - MECHANIKI ZGÓD (CMP, GPC, `registryBridge`): `src/lib/consent/__tests__/*`
//   oraz `src/lib/ads/__tests__/*`. Tutaj biegnie PRAWDZIWY dyspozytor żądania
//   preferencji, bo to on jest przedmiotem dowodu nr 4.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Propsy zapisane przez atrapy organizmów. */
  organism: {} as Record<string, Record<string, unknown>>,
  /** Kolejność zdarzeń: rejestracja słownika kontra pierwszy render. */
  sequence: [] as string[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
// `ensureI18n` jest tu SPY-em, nie zaślepką: dowód nr 6 dotyczy tego, że trasa
// woła je PRZED renderem swojej treści.
vi.mock("@/lib/i18n-interests", () => ({
  ensureI18n: () => h.sequence.push("i18n:interests"),
}));
vi.mock("@/lib/i18n-notifications", () => ({
  ensureI18n: () => h.sequence.push("i18n:notifications"),
}));
vi.mock("@/lib/i18n-network", () => ({
  ensureI18n: () => h.sequence.push("i18n:network"),
}));
vi.mock("@/lib/i18n-profile", () => ({ ensureI18n: () => undefined }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: {},
    loading: false,
    user: { id: "user-1", email: "osoba@example.com", user_metadata: {} },
    roles: [],
    tenantId: "tenant-1",
    isAdmin: false,
  }),
}));
vi.mock("@/lib/profile/useHeaderProfile", () => ({ useHeaderProfile: () => ({ data: null }) }));
vi.mock("@/lib/profile/guestPreviewStore", () => ({ useGuestPreview: () => false }));
vi.mock("@/components/profile/ProfileNav", () => ({ ProfileNav: () => <nav /> }));

/**
 * Atrapa organizmu: marker w DOM, zapis propsów i wpis do dziennika kolejności.
 * `data-surface-block` niesie nazwę, żeby test mógł policzyć KOLEJNOŚĆ bloków
 * jednym zapytaniem, bez zgadywania struktury opakowań.
 */
function organismStub(name: string) {
  return (props: Record<string, unknown>) => {
    h.organism[name] = props;
    h.sequence.push(`render:${name}`);
    return <div data-testid={name} data-surface-block={name} />;
  };
}

vi.mock("@/components/billing/molecules/BillingProfileForm", () => ({
  BillingProfileForm: organismStub("BillingProfileForm"),
}));
vi.mock("@/components/interests/InterestsCustomizer", () => ({
  InterestsCustomizer: organismStub("InterestsCustomizer"),
}));
vi.mock("@/components/notifications/NotificationsCenter", () => ({
  NotificationsCenter: organismStub("NotificationsCenter"),
}));
vi.mock("@/components/billing/organisms/PaymentHistoryCard", () => ({
  PaymentHistoryCard: organismStub("PaymentHistoryCard"),
}));
vi.mock("@/components/billing/organisms/OrdersTableCard", () => ({
  OrdersTableCard: organismStub("OrdersTableCard"),
}));
vi.mock("@/components/billing/organisms/BillingDocumentsCard", () => ({
  BillingDocumentsCard: organismStub("BillingDocumentsCard"),
}));
vi.mock("@/components/billing/molecules/InvoiceLookupCard", () => ({
  InvoiceLookupCard: organismStub("InvoiceLookupCard"),
}));
vi.mock("@/components/billing/molecules/HowPaymentsWorkCard", () => ({
  HowPaymentsWorkCard: organismStub("HowPaymentsWorkCard"),
}));
vi.mock("@/components/notifications/ConsentsPanel", () => ({
  ConsentsPanel: organismStub("ConsentsPanel"),
}));
vi.mock("@/components/consent/GpcSurfaceSlots", () => ({
  GpcDeclarationSlot: organismStub("GpcDeclarationSlot"),
}));
vi.mock("@/components/profile/privacy/VisibilityAndContactSection", () => ({
  VisibilityAndContactSection: organismStub("VisibilityAndContactSection"),
}));
vi.mock("@/components/profile/privacy/DataRightsSection", () => ({
  DataRightsSection: organismStub("DataRightsSection"),
}));

import { renderRoute, routeMeta, type RouteMetaEntry } from "@/test/routeHarness";
import type { AnyRoute } from "@tanstack/react-router";
import { Route as ProfileLayoutRoute } from "@/routes/profile";
import { Route as BillingRoute } from "@/routes/profile.billing";
import { Route as InterestsRoute } from "@/routes/profile.interests";
import { Route as NotificationsRoute } from "@/routes/profile.notifications";
import { Route as PaymentsRoute } from "@/routes/profile.payments";
import { Route as PrivacyRoute } from "@/routes/profile.privacy";
import { consumeOpenPrefsRequest, OPEN_PREFS_EVENT } from "@/lib/ads/consent";

beforeEach(() => {
  vi.clearAllMocks();
  h.organism = {};
  h.sequence = [];
  // Dyspozytor preferencji zgód trzyma stan w module - czyścimy odłożone
  // żądanie, żeby test nie dziedziczył kliknięcia z poprzedniego.
  consumeOpenPrefsRequest();
});

afterEach(() => cleanup());

/** Kolejność bloków w DOM - dowód o układzie strony, nie o istnieniu bloków. */
function kolejnoscBlokow(): string[] {
  return [...document.querySelectorAll("[data-surface-block]")].map(
    (node) => node.getAttribute("data-surface-block") ?? "",
  );
}

/** Wpis `robots` z listy meta, jeśli jest. */
function robotsZ(meta: RouteMetaEntry[]): string | undefined {
  const entry = meta.find((item) => item.name === "robots");
  return entry === undefined ? undefined : String(entry.content);
}

/**
 * EFEKTYWNE `robots` podstrony: własne, a gdy trasa nie ma `head()` - z powłoki
 * `/profile`. Liczy się skutek dla wyszukiwarki, nie warstwa, która go daje.
 */
async function efektywneRobots(route: AnyRoute): Promise<string> {
  const wlasne = robotsZ(await routeMeta(route));
  if (wlasne !== undefined) return wlasne;
  const zPowloki = robotsZ(await routeMeta(ProfileLayoutRoute));
  if (zPowloki === undefined) {
    throw new Error("test: ani podstrona, ani powłoka `/profile` nie ustawia `robots`");
  }
  return zPowloki;
}

describe("/profile/billing - dane do faktury", () => {
  async function zamontuj() {
    return renderRoute({
      route: BillingRoute,
      path: "/profile/billing",
      initialEntry: "/profile/billing",
    });
  }

  it("montuje FORMULARZ danych rozliczeniowych, nie tylko nagłówek karty", async () => {
    // To jedyne miejsce, w którym firma wpisuje NIP i adres na fakturę. Bez
    // formularza strona wygląda kompletnie (tytuł, podtytuł), a kupujący nie ma
    // gdzie podać danych - i dostaje paragon zamiast faktury.
    await zamontuj();
    expect(screen.getByTestId("BillingProfileForm")).toBeTruthy();
    expect(screen.getByText("profile.billing.title")).toBeTruthy();
    expect(screen.getByText("profile.billing.subtitle")).toBeTruthy();
  });

  it("nie dokłada własnych parametrów adresu - strona nie ma wariantów", async () => {
    // Walidator search na tej trasie oznaczałby, że strona ma stany zależne od
    // adresu; nie ma i nie ma mieć - inaczej „ta sama" strona zaczyna wyglądać
    // różnie z dwóch odnośników.
    expect(BillingRoute.options.validateSearch).toBeUndefined();
  });
});

describe("/profile/interests - personalizacja kanałów tematycznych", () => {
  async function zamontuj() {
    return renderRoute({
      route: InterestsRoute,
      path: "/profile/interests",
      initialEntry: "/profile/interests",
    });
  }

  it("montuje konfigurator zainteresowań", async () => {
    await zamontuj();
    expect(screen.getByTestId("InterestsCustomizer")).toBeTruthy();
  });

  it("REJESTRUJE SŁOWNIK PRZED renderem konfiguratora", async () => {
    // Kolejność jest tu całą treścią testu. Rejestracja po pierwszym renderze
    // znaczy, że pierwsza klatka pokazuje surowe klucze `interests.*`, a klient
    // podmienia je po hydracji - to jest React #418, opisany wprost
    // w `src/lib/i18n-interests.ts`.
    await zamontuj();
    expect(h.sequence.indexOf("i18n:interests")).toBeGreaterThanOrEqual(0);
    expect(h.sequence.indexOf("i18n:interests")).toBeLessThan(
      h.sequence.indexOf("render:InterestsCustomizer"),
    );
  });

  it("ma tytuł zakładki i zakaz indeksacji we WŁASNYM nagłówku", async () => {
    const meta = await routeMeta(InterestsRoute);
    expect(meta.find((entry) => "title" in entry)?.title).toBeTruthy();
    expect(robotsZ(meta)).toContain("noindex");
    expect(robotsZ(meta)).toContain("nofollow");
  });
});

describe("/profile/notifications - ustawienia powiadomień", () => {
  async function zamontuj() {
    return renderRoute({
      route: NotificationsRoute,
      path: "/profile/notifications",
      initialEntry: "/profile/notifications",
    });
  }

  it("montuje centrum powiadomień W TRYBIE `preferences` - i to jest sedno", async () => {
    // Zakładka ustawień pokazuje się tylko w trybach `full` i `preferences`
    // (NotificationsCenter.tsx). W trybie `inbox` albo `consents` ta strona
    // byłaby PUSTA - i przez wiele wersji dokładnie tak było: opt-in Web Push,
    // digest e-mail i grupowanie rozmów były zaimplementowane i całkowicie
    // niedostępne, bo nikt ich nigdzie nie montował w tym trybie.
    await zamontuj();
    expect(h.organism.NotificationsCenter?.mode).toBe("preferences");
  });

  it("NIE dokłada drugiego nagłówka nad nagłówkiem centrum", async () => {
    // Tryb `preferences` renderuje własny tytuł z kluczy
    // `notifications.settings.*`. Drugi nagłówek na stronie znaczy, że czytnik
    // ekranu ogłasza ten sam tytuł dwa razy.
    await zamontuj();
    expect(document.querySelectorAll("h1, h2")).toHaveLength(0);
  });

  it("linkuje DO SKRZYNKI z gotowym widokiem powiadomień", async () => {
    // Granica „preferencje kanałów" / „lista powiadomień" nie jest oczywista;
    // bez parametru widoku odnośnik wysypuje użytkownika na wątki rozmów.
    await zamontuj();
    const href = screen
      .getByText("notifications.page.inboxLinkTitle")
      .closest("a")
      ?.getAttribute("href");
    expect(href).toContain("/messages");
    expect(href).toContain("view=notifications");
  });

  it("linkuje DO CENTRUM PRYWATNOŚCI po zgody na komunikację", async () => {
    // Użytkownik szukający „czy mogę wyłączyć te maile" trafia tu, a zgody
    // marketingowe mieszkają na `/profile/privacy`. Bez tego odnośnika szuka
    // ich w ustawieniach kanałów i nie znajduje.
    await zamontuj();
    expect(
      screen.getByText("notifications.page.consentsLinkTitle").closest("a")?.getAttribute("href"),
    ).toBe("/profile/privacy");
  });

  it("REJESTRUJE SŁOWNIK PRZED renderem centrum", async () => {
    await zamontuj();
    expect(h.sequence.indexOf("i18n:notifications")).toBeGreaterThanOrEqual(0);
    expect(h.sequence.indexOf("i18n:notifications")).toBeLessThan(
      h.sequence.indexOf("render:NotificationsCenter"),
    );
  });

  it("ma tytuł zakładki i zakaz indeksacji we WŁASNYM nagłówku", async () => {
    const meta = await routeMeta(NotificationsRoute);
    expect(meta.find((entry) => "title" in entry)?.title).toBeTruthy();
    expect(robotsZ(meta)).toContain("noindex");
  });
});

describe("/profile/payments - jedno miejsce na całą historię pieniędzy", () => {
  async function zamontuj() {
    return renderRoute({
      route: PaymentsRoute,
      path: "/profile/payments",
      initialEntry: "/profile/payments",
    });
  }

  it("niesie WSZYSTKIE karty przeniesione ze `/profile/orders`", async () => {
    // Stary adres jest dziś przekierowaniem (patrz profileRedirectRoutes).
    // Gdyby zniknęła tabela zamówień albo rejestr dokumentów, przekierowanie
    // prowadziłoby w miejsce BEZ tych danych - a wtedy konsolidacja przestaje
    // być konsolidacją i staje się utratą powierzchni.
    await zamontuj();
    expect(screen.getByTestId("OrdersTableCard")).toBeTruthy();
    expect(screen.getByTestId("BillingDocumentsCard")).toBeTruthy();
  });

  it("układa karty od najczęstszego pytania do wyjaśnienia zasad", async () => {
    // Kolejność jest celowa i opisana w nagłówku trasy: ile i kiedy
    // zapłaciłem -> dowody (zamówienia, dokumenty) -> odzyskanie faktury ->
    // zasady. Postawienie „jak działają płatności" na górze każe przewijać
    // regulamin każdemu, kto przyszedł po jedną kwotę.
    await zamontuj();
    expect(kolejnoscBlokow()).toEqual([
      "PaymentHistoryCard",
      "OrdersTableCard",
      "BillingDocumentsCard",
      "InvoiceLookupCard",
      "HowPaymentsWorkCard",
    ]);
  });

  it("historia płatności ma włączony EKSPORT", async () => {
    // Eksport historii to obowiązek dostępu do własnych danych (art. 15/20) -
    // ta sama karta bez `showExport` stoi też w innych miejscach panelu, więc
    // pominięcie flagi nie rzuca żadnym błędem, tylko cicho zabiera przycisk.
    await zamontuj();
    expect(h.organism.PaymentHistoryCard?.showExport).toBe(true);
  });

  it("ma nagłówek strony mówiący, co to za lista", async () => {
    await zamontuj();
    expect(screen.getByText("profile.planPage.history.pageTitle")).toBeTruthy();
    expect(screen.getByText("profile.planPage.history.pageHint")).toBeTruthy();
  });
});

describe("/profile/privacy - hub prywatności", () => {
  async function zamontuj() {
    return renderRoute({
      route: PrivacyRoute,
      path: "/profile/privacy",
      initialEntry: "/profile/privacy",
    });
  }

  it("układa bloki w kolejności ROSNĄCEJ NIEODWRACALNOŚCI", async () => {
    // 1. widoczność i kontakt - zmieniane codziennie,
    // 2. zgody - rzadko, audytowane,
    // 3. prawa do danych - eksport i USUNIĘCIE KONTA, raz w życiu.
    // Wywrócenie kolejności stawia „usuń konto" nad codziennym przełącznikiem
    // widoczności w katalogu osób.
    await zamontuj();
    expect(kolejnoscBlokow()).toEqual([
      "VisibilityAndContactSection",
      "GpcDeclarationSlot",
      "ConsentsPanel",
      "DataRightsSection",
    ]);
  });

  it("panel zgód dostaje ŹRÓDŁO DECYZJI do rejestru RODO", async () => {
    // `source` ląduje w audytowanym wpisie zgody. Zła etykieta przypisuje
    // decyzję niewłaściwej powierzchni, czyli psuje DOWÓD zgody - a to jest
    // dokument, nie statystyka.
    await zamontuj();
    expect(h.organism.ConsentsPanel?.source).toBe("profile_privacy");
  });

  it("przycisk banera cookie ODKŁADA żądanie, którego baner jeszcze nie słucha", async () => {
    // Baner zgód jest leniwym chunkiem: klik pada, zanim listener się
    // zarejestruje. Bez odłożenia żądania w stanie modułu jednorazowe
    // zdarzenie okienne przepadałoby bez śladu, a użytkownik klikałby
    // „Otwórz ustawienia cookie" i nic by się nie działo.
    // Tu biegnie PRAWDZIWY dyspozytor - to on jest przedmiotem dowodu.
    await zamontuj();
    expect(consumeOpenPrefsRequest()).toBe(false);
    fireEvent.click(screen.getByText("profile.privacy.openBanner"));
    expect(consumeOpenPrefsRequest()).toBe(true);
  });

  it("przycisk banera cookie WOŁA też zamontowany baner zdarzeniem", async () => {
    // Druga droga tego samego kliknięcia: baner już wisi i słucha zdarzenia,
    // więc panel preferencji ma się otworzyć natychmiast, bez czekania na
    // montaż.
    const wywolania: string[] = [];
    const listener = () => wywolania.push(OPEN_PREFS_EVENT);
    window.addEventListener(OPEN_PREFS_EVENT, listener);
    await zamontuj();
    fireEvent.click(screen.getByText("profile.privacy.openBanner"));
    window.removeEventListener(OPEN_PREFS_EVENT, listener);
    expect(wywolania).toEqual([OPEN_PREFS_EVENT]);
  });

  it("linkuje do BEZPIECZEŃSTWA KONTA, bo granica nie jest oczywista", async () => {
    // Hasło, e-mail, sesje i dwuskładnikowe zostały na `/profile/security`.
    // Bez tego odnośnika użytkownik szuka zmiany hasła w prywatności.
    await zamontuj();
    expect(
      screen.getByText("profile.privacy.securityLink").closest("a")?.getAttribute("href"),
    ).toBe("/profile/security");
  });

  it("REJESTRUJE SŁOWNIK SIECI KONTAKTÓW przed renderem sekcji widoczności", async () => {
    // Sekcja widoczności czyta klucze `network.allowConnections*`. Bez
    // rejestracji słownika w chunku trasy przełączniki mają surowe klucze
    // zamiast etykiet - a to są przełączniki decydujące, kto może się z kimś
    // skontaktować.
    await zamontuj();
    expect(h.sequence.indexOf("i18n:network")).toBeGreaterThanOrEqual(0);
    expect(h.sequence.indexOf("i18n:network")).toBeLessThan(
      h.sequence.indexOf("render:VisibilityAndContactSection"),
    );
  });

  it("ma nagłówki wszystkich trzech sekcji, nie same organizmy", async () => {
    // Sekcja bez nagłówka to dla czytnika ekranu jeden długi blok kontrolek.
    await zamontuj();
    expect(screen.getByText("profile.privacy.title")).toBeTruthy();
    expect(screen.getByText("profile.privacy.consentsSection")).toBeTruthy();
    expect(screen.getByText("profile.privacy.dataSection")).toBeTruthy();
    expect(screen.getByText("profile.privacy.registryNote")).toBeTruthy();
  });
});

describe("indeksacja - żadna podstrona konta nie trafia do wyszukiwarki", () => {
  it.each([
    ["/profile/billing", BillingRoute],
    ["/profile/interests", InterestsRoute],
    ["/profile/notifications", NotificationsRoute],
    ["/profile/payments", PaymentsRoute],
    ["/profile/privacy", PrivacyRoute],
  ])("%s ma EFEKTYWNE `noindex`", async (_sciezka, route) => {
    // Liczy się skutek, nie warstwa: dwie trasy mają własny `head()`, trzy
    // dziedziczą go z powłoki `/profile`. Faktura, adres firmy i zgody
    // marketingowe w wynikach wyszukiwania to incydent, nie usterka kosmetyczna.
    expect(await efektywneRobots(route)).toContain("noindex");
  });
});
