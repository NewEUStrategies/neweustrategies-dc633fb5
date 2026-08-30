// Organizm „BRANDING WYDARZENIA" - piec slotow koloru, obraz tla i jasnosc.
//
// PO CO TEN PLIK ISTNIEJE. Caly ten ekran stoi na JEDNEJ regule, ktorej nie
// widac w kontrolce: SLOT PUSTY ZNACZY DZIEDZICZENIE Z MOTYWU SERWISU, a nie
// „bialy". Kazdy blad tego ekranu wychodzi z tej jednej roznicy:
//
//   1. ZAPISANY SLOT PUSTY ZAMRAZA MARKE. Gdyby „Przywroc branding
//      spolecznosci" wpisywalo dzisiejsze kolory motywu zamiast je CZYSCIC,
//      wydarzenie przestaloby reagowac na zmiane marki i po pol roku wygladalo
//      by jak archiwum. Dlatego ladunek nie ma prawa niesc pustych slotow.
//   2. ZLY FORMAT KOLORU NIE MOZE DOJECHAC DO BAZY. Kolumna `branding` jest
//      `jsonb` bez CHECK-a na ksztalt wartosci, wiec „#GG0000" zapisze sie bez
//      protestu i wysadzi dopiero stylowanie strony publicznej - u uczestnika,
//      nie u redaktora. Walidacja stoi wiec po stronie ekranu i musi BLOKOWAC
//      zapis, a nie tylko malowac pole na czerwono.
//   3. ADRES OBRAZU TLA MUSI BYC `https`. Adres `http` na stronie serwowanej po
//      HTTPS jest po cichu blokowany przez przegladarke - tlo po prostu nie
//      wchodzi, a redaktor widzi „zapisano" i pusta strone.
//   4. PODGLAD CZYTA SZKIC, NIE WARTOSCI DOMYSLNE. Szesciocyfrowy kod koloru
//      nie mowi nic o tym, czy tekst bedzie czytelny na tle bloku - dopiero
//      rysunek strony to pokazuje, i musi pokazywac TE wartosci, ktore stoja
//      w polach, zanim ktokolwiek kliknie zapis.
//
// PARA „ZAPISUJE / NIE ZAPISUJE" NA KAZDEJ REGULE - test samego przebiegu
// szczesliwego nie odroznia „ekran blokuje zly kolor" od „ekran nie zapisuje
// nigdy".
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Funkcji czystych szkicu (odczyt JSON,
// walidacja, ladunek, „brudnosc") - `lib/events/__tests__/eventBrandingDraft
// .test.ts`. (2) Mapowania odmow bazy na zdania - `eventErrorMaps*.test.ts`.
// (3) Doku podgladu - `EventStudioPreview*`; tutaj sprawdzamy WYLACZNIE to, co
// panel do niego wpisuje.
//
// RODO: zadnych prawdziwych danych osobowych, adresy wylacznie `example.org`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { axeViolations, summarize } from "@/test/axe";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { adminEventDetailRow, STUDIO_EVENT_ID } from "@/test/events/adminEventStudioRows";
import {
  EVENT_BRANDING_COLOR_SLOTS,
  EVENT_BRANDING_SLOT_LABEL_KEYS,
  type EventBrandingColorSlot,
} from "@/lib/events/eventBrandingDraft";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  /** Szkice wpisane do doku podgladu, w kolejnosci. */
  preview: [] as Record<string, unknown>[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/events/adminEventStudioErrors", () => ({
  adminEventStudioErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

// Dok podgladu nie renderuje niczego w tym drzewie - przedmiotem dowodu jest
// to, CO panel do niego wpisuje i KIEDY.
vi.mock("@/components/admin/events/studio/EventStudioPreviewContext", () => ({
  useSyncEventPreview: (partial: Record<string, unknown>) => {
    h.preview.push(partial);
  },
}));

const { EventBrandingPanel } =
  await import("@/components/admin/events/organisms/EventBrandingPanel");

const B = "adminEvents.branding.";

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

function Provider({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function panel(overrides: Partial<AdminEventDetailRow> = {}) {
  return render(
    <Provider>
      <EventBrandingPanel row={adminEventDetailRow(overrides)} />
    </Provider>,
  );
}

/**
 * Pole heksadecymalne slotu. Etykieta jest wspolna z probnikiem systemowym
 * (`aria-label`), wiec bierzemy pierwsze wystapienie - pole tekstowe stoi
 * w drzewie przed probnikiem.
 *
 * KLUCZ ETYKIETY BIERZEMY Z EKSPORTOWANEJ MAPY, a nie sklejamy z nazwy slotu:
 * nazwa kolumny jest `snake_case` (`main_action`), a klucz slownika
 * `camelCase` (`slots.mainAction`) - sklejanie omijaloby wlasnie te mape,
 * ktora ekran naprawde czyta.
 */
function poleKoloru(slot: EventBrandingColorSlot): HTMLInputElement {
  const [pole] = screen.getAllByLabelText(EVENT_BRANDING_SLOT_LABEL_KEYS[slot]);
  return pole as HTMLInputElement;
}

function probnik(slot: EventBrandingColorSlot): HTMLInputElement {
  const pola = screen.getAllByLabelText(EVENT_BRANDING_SLOT_LABEL_KEYS[slot]);
  return pola[pola.length - 1] as HTMLInputElement;
}

/**
 * Kolko wyboru jasnosci.
 *
 * PO ROLI, NIE PO ETYKIECIE: karta wyboru (`EventStudioChoiceCard`) opakowuje
 * kolko etykieta, w ktorej stoi TAKZE miniatura wizytowki - dostepna nazwa
 * kolka jest wiec sklejeniem calej karty, a nie samym napisem „Jasny".
 */
function jasnosc(key: "light" | "dark"): HTMLInputElement {
  return screen.getByRole("radio", { name: new RegExp(`${key}$|${key}\\b`) }) as HTMLInputElement;
}

function poleObrazu(): HTMLInputElement {
  return screen.getByLabelText(`${B}backgroundImageLabel`) as HTMLInputElement;
}

function wpiszKolor(slot: EventBrandingColorSlot, value: string): void {
  fireEvent.change(poleKoloru(slot), { target: { value } });
}

function przyciskZapisu(): HTMLElement | null {
  return screen.queryByRole("button", { name: "adminEvents.studio.actions.save" });
}

function zapisz(): void {
  const przycisk = przyciskZapisu();
  if (przycisk === null) throw new Error("test: paska zapisu nie ma na ekranie");
  fireEvent.click(przycisk);
}

/** Ostatni szkic wpisany do doku podgladu. */
function ostatniPodglad(): Record<string, unknown> {
  const last = h.preview.at(-1);
  if (last === undefined) throw new Error("test: panel nie wpisal niczego do podgladu");
  return last;
}

/** Zapisany branding kompletny - piec slotow, tlo i ciemna jasnosc. */
const ZAPISANY = {
  appearance: "dark",
  navigation: "#0B1120",
  main_action: "#FA9346",
  text: "#F5F7FA",
  blocks_background: "#111827",
  page_background: "#01112F",
  background_image: "https://cdn.example.org/kongres/tlo.jpg",
};

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  h.preview = [];
});

afterEach(cleanup);

describe("ekran czyta to, co ZAPISANE - nie wartosci domyslne", () => {
  it("kazdy slot pokazuje zapisany kolor, bez krzyzyka w polu", () => {
    panel({ branding: ZAPISANY });

    expect(poleKoloru("navigation").value).toBe("0B1120");
    expect(poleKoloru("main_action").value).toBe("FA9346");
    expect(poleKoloru("text").value).toBe("F5F7FA");
    expect(poleKoloru("blocks_background").value).toBe("111827");
    expect(poleKoloru("page_background").value).toBe("01112F");
    expect(poleObrazu().value).toBe("https://cdn.example.org/kongres/tlo.jpg");
  });

  it("wybrana jasnosc czyta sie z zapisu, a nie zaczyna zawsze od jasnej", () => {
    panel({ branding: ZAPISANY });
    expect(jasnosc("dark").checked).toBe(true);
    expect(jasnosc("light").checked).toBe(false);
  });

  // WYDARZENIE BEZ BRANDINGU MA PUSTE SLOTY, a nie kolory motywu wpisane do
  // pol: pola wypelnione „na zachete" pierwszym zapisem zamrazalyby marke.
  it("wydarzenie bez brandingu ma WSZYSTKIE sloty puste", () => {
    panel({ branding: {} });

    for (const slot of EVENT_BRANDING_COLOR_SLOTS) {
      expect(poleKoloru(slot).value, slot).toBe("");
    }
    expect(poleObrazu().value).toBe("");
    expect(jasnosc("light").checked).toBe(true);
  });

  // Wartosc, ktorej nie da sie odczytac jako koloru (zapis recznie, migracja,
  // import) ma sie czytac jako PUSTKA - pole z napisem „granatowy" nie da sie
  // zapisac, a ekran nie mial by jak z niego wyjsc.
  it("smiec w kolumnie czyta sie jako slot pusty, a nie jako wartosc", () => {
    panel({ branding: { navigation: "granatowy", appearance: "sepia" } });

    expect(poleKoloru("navigation").value).toBe("");
    expect(jasnosc("light").checked).toBe(true);
  });

  it("branding zapisany jako lista albo `null` nie wywraca ekranu", () => {
    panel({ branding: null });
    expect(poleKoloru("navigation").value).toBe("");
    cleanup();

    panel({ branding: ["cokolwiek"] });
    expect(poleKoloru("navigation").value).toBe("");
  });
});

describe("podglad dostaje SZKIC, i to natychmiast", () => {
  // PODGLAD JEST TU WARUNKIEM UZYTECZNOSCI: kod koloru nie mowi, czy tekst
  // bedzie czytelny na tle bloku - dopiero rysunek strony to pokazuje.
  it("pierwsze wejscie wpisuje do podgladu branding ZAPISANY", () => {
    panel({ branding: ZAPISANY });

    const branding = ostatniPodglad().branding as { colors: Record<string, string> };
    expect(branding.colors.navigation).toBe("#0B1120");
    expect(branding.colors.main_action).toBe("#FA9346");
  });

  it("zmiana koloru dojezdza do podgladu PRZED zapisem", () => {
    panel({ branding: ZAPISANY });
    wpiszKolor("main_action", "d73953");

    const branding = ostatniPodglad().branding as { colors: Record<string, string> };
    expect(branding.colors.main_action).toBe("#D73953");
    // Zapis nie poszedl - podglad wyprzedza baze, nie zastepuje jej.
    expect(stub().calls).toEqual([]);
  });

  // PARA NA JASNOSCI: obie karty musza dzialac. Karta, ktora tylko POKAZUJE
  // wybor, ale go nie ustawia, wyglada identycznie do chwili zapisu.
  it("wybor jasnosci dziala w OBIE strony", () => {
    panel({ branding: ZAPISANY });
    fireEvent.click(jasnosc("light"));

    expect(jasnosc("light").checked).toBe(true);
    const branding = ostatniPodglad().branding as { appearance: string };
    expect(branding.appearance).toBe("light");
  });

  it("kolory sekcji tla zmieniaja sie tak samo, jak kolory pierwszej sekcji", () => {
    panel({ branding: {} });
    wpiszKolor("page_background", "01112F");
    wpiszKolor("blocks_background", "111827");

    const branding = ostatniPodglad().branding as { colors: Record<string, string> };
    expect(branding.colors.page_background).toBe("#01112F");
    expect(branding.colors.blocks_background).toBe("#111827");
  });

  it("zmiana jasnosci i obrazu tla tez idzie do podgladu", () => {
    panel({ branding: {} });
    fireEvent.click(jasnosc("dark"));
    fireEvent.change(poleObrazu(), {
      target: { value: "https://cdn.example.org/kongres/tlo.jpg" },
    });

    const branding = ostatniPodglad().branding as {
      appearance: string;
      backgroundImage: string;
    };
    expect(branding.appearance).toBe("dark");
    expect(branding.backgroundImage).toBe("https://cdn.example.org/kongres/tlo.jpg");
  });
});

describe("zly format koloru zatrzymuje sie PRZED baza", () => {
  it("bledny kod mowi o tym przy polu i GASI przycisk zapisu", () => {
    panel({ branding: {} });
    wpiszKolor("navigation", "GG0000");

    expect(screen.getByText(`${B}errors.colorInvalid`)).toBeTruthy();
    expect(przyciskZapisu()?.hasAttribute("disabled")).toBe(true);
  });

  it("klikniecie w zgaszony zapis nie wysyla niczego do bazy", () => {
    panel({ branding: {} });
    wpiszKolor("navigation", "GG0000");
    zapisz();

    expect(stub().calls).toEqual([]);
  });

  // WYCZYSZCZENIE SLOTU TO POWROT DO DZIEDZICZENIA, nie zapis bieli. Klucz ma
  // wtedy WYPASC z ladunku - inaczej wydarzenie zostaje z kopia dzisiejszego
  // koloru i przestaje reagowac na zmiane marki.
  it("wyczyszczenie zapisanego koloru ZDEJMUJE klucz z ladunku", async () => {
    stub().setData("admin_event_branding_save", null);
    panel({ branding: ZAPISANY });
    wpiszKolor("navigation", "");

    expect(poleKoloru("navigation").value).toBe("");
    zapisz();

    await waitFor(() => expect(stub().lastCall("admin_event_branding_save")).toBeDefined());
    const branding = stub().lastCall("admin_event_branding_save")?.arg("p_branding");
    expect(branding).not.toHaveProperty("navigation");
    // Pozostale sloty zostaja - czyszczenie jednego nie jest resetem calosci.
    expect(branding).toMatchObject({ main_action: "#FA9346" });
  });

  // KONTRAPUNKT: poprawiony kolor ODBLOKOWUJE zapis. Bez tego przypadku
  // asercje wyzej przechodzilyby takze wtedy, gdyby panel nie zapisywal nigdy.
  it("poprawiony kolor odblokowuje zapis i jedzie do bazy", async () => {
    stub().setData("admin_event_branding_save", null);
    panel({ branding: {} });
    wpiszKolor("navigation", "GG0000");
    wpiszKolor("navigation", "0b1120");
    zapisz();

    await waitFor(() => expect(stub().lastCall("admin_event_branding_save")).toBeDefined());
    const branding = stub().lastCall("admin_event_branding_save")?.arg("p_branding");
    expect(branding).toMatchObject({ navigation: "#0B1120" });
  });

  // Skrot trzyznakowy jest poprawnym kolorem w CSS, ale nie tutaj: strona
  // publiczna sklada kolory z tych wartosci wprost, a szesc cyfr jest jedynym
  // ksztaltem, ktory czyta caly modul (te same wzorce, co `event_pages`).
  it("skrot trzyznakowy tez jest odrzucany", () => {
    panel({ branding: {} });
    wpiszKolor("text", "FFF");

    expect(screen.getByText(`${B}errors.colorInvalid`)).toBeTruthy();
    expect(przyciskZapisu()?.hasAttribute("disabled")).toBe(true);
  });

  it("probnik systemowy zapisuje kolor tak samo jak pole tekstowe", async () => {
    stub().setData("admin_event_branding_save", null);
    panel({ branding: {} });
    fireEvent.change(probnik("main_action"), { target: { value: "#d73953" } });
    zapisz();

    await waitFor(() => expect(stub().lastCall("admin_event_branding_save")).toBeDefined());
    expect(stub().lastCall("admin_event_branding_save")?.arg("p_branding")).toMatchObject({
      main_action: "#D73953",
    });
  });

  // PUSTY SLOT POKAZUJE W PROBNIKU BIEL, ale sam z siebie jej NIE zapisuje -
  // inaczej samo otwarcie probnika zamrazaloby dziedziczenie na bialym.
  it("pusty slot pokazuje w probniku biel i NIE robi z ekranu brudnego", () => {
    panel({ branding: {} });

    expect(probnik("navigation").value).toBe("#ffffff");
    expect(przyciskZapisu()).toBeNull();
  });
});

describe("obraz tla - adres, brak adresu i jego usuniecie", () => {
  it("adres bez `https` mowi o tym przy polu i gasi zapis", () => {
    panel({ branding: {} });
    fireEvent.change(poleObrazu(), { target: { value: "http://cdn.example.org/tlo.jpg" } });

    expect(screen.getByText(`${B}errors.imageInvalid`)).toBeTruthy();
    expect(przyciskZapisu()?.hasAttribute("disabled")).toBe(true);
  });

  it("napis, ktory nie jest adresem, tez jest odrzucany", () => {
    panel({ branding: {} });
    fireEvent.change(poleObrazu(), { target: { value: "tlo.jpg" } });

    expect(screen.getByText(`${B}errors.imageInvalid`)).toBeTruthy();
  });

  // BRAK OBRAZU JEST STANEM POPRAWNYM, nie bledem: wydarzenie bez wlasnego tla
  // bierze tlo z motywu serwisu.
  it("puste pole obrazu NIE jest bledem i nie blokuje zapisu", async () => {
    stub().setData("admin_event_branding_save", null);
    panel({ branding: {} });
    wpiszKolor("navigation", "0B1120");

    expect(screen.queryByText(`${B}errors.imageInvalid`)).toBeNull();
    zapisz();

    await waitFor(() => expect(stub().lastCall("admin_event_branding_save")).toBeDefined());
    expect(stub().lastCall("admin_event_branding_save")?.arg("p_branding")).not.toHaveProperty(
      "background_image",
    );
  });

  // USUNIECIE OBRAZU to wyczyszczenie pola - i musi USUNAC klucz z ladunku,
  // bo pusty napis zapisany w kolumnie znaczylby „tlo o adresie pustym", czyli
  // brak dziedziczenia z motywu.
  it("wyczyszczenie obrazu ZDEJMUJE klucz z ladunku, a nie wysyla pustki", async () => {
    stub().setData("admin_event_branding_save", null);
    panel({ branding: ZAPISANY });
    fireEvent.change(poleObrazu(), { target: { value: "" } });
    zapisz();

    await waitFor(() => expect(stub().lastCall("admin_event_branding_save")).toBeDefined());
    const branding = stub().lastCall("admin_event_branding_save")?.arg("p_branding");
    expect(branding).not.toHaveProperty("background_image");
    // Reszta brandingu zostaje - usuniecie tla nie jest resetem calego ekranu.
    expect(branding).toMatchObject({ navigation: "#0B1120" });
  });
});

describe("pasek zapisu, ladunek i „Przywroc branding spolecznosci”", () => {
  // PASEK POJAWIA SIE DOPIERO PRZY ZMIANIE. Pasek stojacy zawsze uczy, zeby go
  // nie zauwazac - a wtedy nie zauwaza sie go takze wtedy, gdy cos jest do
  // zapisania.
  it("bez zmiany nie ma paska zapisu", () => {
    panel({ branding: ZAPISANY });
    expect(przyciskZapisu()).toBeNull();
  });

  it("zmiana koloru wystawia pasek", () => {
    panel({ branding: ZAPISANY });
    wpiszKolor("navigation", "D73953");
    expect(przyciskZapisu()).toBeTruthy();
  });

  // LADUNEK NIE NIESIE PUSTYCH SLOTOW - to jest cala mechanika dziedziczenia.
  it("ladunek pomija sloty puste i niesie jasnosc zawsze", async () => {
    stub().setData("admin_event_branding_save", null);
    panel({ branding: {} });
    wpiszKolor("main_action", "FA9346");
    zapisz();

    await waitFor(() => expect(stub().lastCall("admin_event_branding_save")).toBeDefined());
    const call = stub().lastCall("admin_event_branding_save");
    expect(call?.arg("p_event_id")).toBe(STUDIO_EVENT_ID);
    expect(call?.arg("p_branding")).toEqual({ appearance: "light", main_action: "#FA9346" });
  });

  // DEFEKT. „Przywroc branding spolecznosci" stoi W PASKU ZAPISU (jako jego
  // `leading`), a pasek renderuje sie WYLACZNIE przy `dirty || saving`. Akcja
  // jest wiec niedostepna dokladnie w tym stanie, w ktorym jest potrzebna:
  // wydarzenie ma ZAPISANY branding, nic nie zmieniono i redaktor chce wrocic
  // do dziedziczenia z motywu serwisu. Zeby ja zobaczyc, musi najpierw zmienic
  // cokolwiek - czyli wykonac zmiane, ktorej nie chce.
  //
  // Przywrocenie nie jest czescia szkicu (nie odrzuca zmian - CZYSCI zapisane
  // wartosci), wiec jego miejsce jest przy sekcji kolorow, a nie w pasku,
  // ktory pojawia sie warunkowo.
  it.fails("DEFEKT: „Przywroc branding spolecznosci” jest nieosiagalne bez zmiany", () => {
    panel({ branding: ZAPISANY });
    // `query`, nie `get`: asercja ma PADAC NA POROWNANIU, a nie na wyjatku
    // z wyszukiwania - inaczej nie widac, czy defekt jest ten, ktory opisano.
    expect(screen.queryByText(`${B}resetToCommunity`)).not.toBeNull();
  });

  // „PRZYWROC BRANDING SPOLECZNOSCI" CZYSCI WARTOSCI, zamiast wpisywac
  // dzisiejsze kolory motywu - wydarzenie z zapisana kopia kolorow przestaloby
  // reagowac na zmiane marki.
  it("„Przywroc branding spolecznosci” czysci komplet slotow, takze obraz", () => {
    panel({ branding: ZAPISANY });
    // Pasek zapisu (a razem z nim ta akcja) pojawia sie dopiero przy zmianie -
    // patrz defekt wyzej.
    wpiszKolor("navigation", "D73953");
    fireEvent.click(screen.getByText(`${B}resetToCommunity`));

    for (const slot of EVENT_BRANDING_COLOR_SLOTS) {
      expect(poleKoloru(slot).value, slot).toBe("");
    }
    expect(poleObrazu().value).toBe("");
    expect(jasnosc("light").checked).toBe(true);
  });

  it("po przywroceniu ladunek niesie SAMA jasnosc", async () => {
    stub().setData("admin_event_branding_save", null);
    panel({ branding: ZAPISANY });
    wpiszKolor("navigation", "D73953");
    fireEvent.click(screen.getByText(`${B}resetToCommunity`));
    zapisz();

    await waitFor(() => expect(stub().lastCall("admin_event_branding_save")).toBeDefined());
    expect(stub().lastCall("admin_event_branding_save")?.arg("p_branding")).toEqual({
      appearance: "light",
    });
  });

  // „ODRZUC" WRACA DO STANU Z BAZY, takze po przywroceniu - inaczej jedno
  // klikniecie w „Przywroc" byloby nieodwracalne bez przeladowania strony.
  it("„Odrzuc” cofa takze przywrocenie brandingu spolecznosci", () => {
    panel({ branding: ZAPISANY });
    wpiszKolor("navigation", "D73953");
    fireEvent.click(screen.getByText(`${B}resetToCommunity`));
    fireEvent.click(screen.getByRole("button", { name: "adminEvents.studio.actions.discard" }));

    expect(poleKoloru("navigation").value).toBe("0B1120");
    expect(poleObrazu().value).toBe("https://cdn.example.org/kongres/tlo.jpg");
    expect(przyciskZapisu()).toBeNull();
  });

  it("udany zapis nazywa skutek", async () => {
    stub().setData("admin_event_branding_save", null);
    panel({ branding: {} });
    wpiszKolor("navigation", "0B1120");
    zapisz();

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEvents.studio.toasts.brandingSaved"),
    );
  });

  // ODMOWA BAZY POKAZUJE SIE ZDANIEM I ZOSTAWIA SZKIC - inaczej redaktor
  // traci komplet kolorow za kazdym razem, gdy wygasnie sesja.
  it("odmowa bazy mowi zdaniem i ZOSTAWIA wpisane wartosci", async () => {
    stub().setError("admin_event_branding_save", "forbidden: editor role required");
    panel({ branding: {} });
    wpiszKolor("navigation", "0B1120");
    zapisz();

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastError.mock.calls[0][0]).toContain("forbidden: editor role required");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    // Pole zostaje wypelnione, a pasek zapisu nadal stoi - jest co ponowic.
    expect(poleKoloru("navigation").value).toBe("0B1120");
    expect(przyciskZapisu()).toBeTruthy();
  });
});

describe("dostepnosc", () => {
  it("ekran brandingu nie ma naruszen axe", async () => {
    const { container } = panel({ branding: ZAPISANY });
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("ekran z komunikatami bledow i paskiem zapisu tez nie ma naruszen axe", async () => {
    const { container } = panel({ branding: {} });
    wpiszKolor("navigation", "GG0000");
    fireEvent.change(poleObrazu(), { target: { value: "http://cdn.example.org/tlo.jpg" } });

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});
