// MATERIAŁY PARTNERÓW: sekcja, która WYDAJE PLIKI.
//
// Ta sekcja różni się od reszty strony publicznej jednym: jej treścią jest
// ADRES PLIKU. Pomyłka nie kończy się brzydkim układem, tylko wydaniem
// prezentacji partnera komuś, kto miał ją dostać dopiero po zapisie.
//
// PIĘĆ RZECZY, KTÓRE MUSZĄ TRZYMAĆ:
// 1. SEKCJA ZAMKNIĘTA NIE WYDAJE ADRESU. `_event_default_sections()` daje
//    materiałom widoczność `registered`, więc gość dostaje kartę zamka -
//    a `enabled={false}` ma ZATRZYMAĆ zapytanie, nie tylko schować wynik.
//    Gdyby zapytanie mimo to poszło, adres pliku wylądowałby w pamięci
//    przeglądarki gościa i w narzędziach sieciowych.
// 2. GRUPUJEMY PO PARTNERZE, NIE PO RODZAJU. Uczestnik szuka „prezentacji
//    firmy X”; lista po rodzaju kazałaby mu przejść całość.
// 3. MATERIAŁ BEZ ADRESU NIE STAJE SIĘ PRZYCISKIEM DONIKĄD - wypada, a jeśli
//    był jedyny, to razem z nagłówkiem swojego partnera.
// 4. ZDANIE O PUSTCE ZOSTAJE jako DRUGA linia obrony: sekcja i lista jadą
//    dwoma osobnymi zapytaniami i mogą się rozjechać w czasie (partner cofa
//    publikację między jednym a drugim). Pierwszą linią jest
//    `event_sections.has_content` - to mierzy `eventMaterialsVisibility.test.tsx`
//    i tutaj tego nie dublujemy.
// 5. KAŻDY ODNOŚNIK WYCHODZI Z SERWISU BEZ UCHWYTU DO OKNA I BEZ RANKINGU -
//    adresy pochodzą od partnerów.
//
// ATRAPA STOI NA GRANICY: podmieniony jest wyłącznie klient Supabase, więc
// parser `sponsorsSurface`, hook `usePublicEventMaterials` i sam komponent
// jadą kodem produkcyjnym. Wzorzec atrap przejęty z
// `eventDiscussionsList.test.tsx`, a atrapa RPC z
// `src/lib/events/__tests__/publicEventApi.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import { supabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  rpc: null as ReturnType<typeof import("@/test/supabase/rpc").supabaseRpcStub> | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options === undefined ? key : `${key}:${JSON.stringify(options)}`,
    i18n: { language: "pl", exists: () => true, changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

const { EventMaterialsSection } =
  await import("@/components/events/public/organisms/EventMaterialsSection");

type Wire = Record<string, unknown>;

/** Adresy plików WYŁĄCZNIE w domenach dokumentacyjnych. */
const DECK_URL = "https://files.example.org/nordwind/prezentacja.pdf";

function materialWire(over: Wire = {}): Wire {
  return {
    id: "mat-1",
    sponsor_id: "sp-nordwind",
    sponsor_name: "Nordwind Analytics",
    sponsor_logo_url: null,
    tier_id: "tier-gold",
    tier_name_pl: "Złoty Partner",
    tier_name_en: "Gold Partner",
    tier_rank: 30,
    title_pl: "Raport rynku energii",
    title_en: "Energy market report",
    kind: "document",
    url: DECK_URL,
    sort_order: 0,
    ...over,
  };
}

function withClient(node: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

describe("EventMaterialsSection - lista plików partnerów", () => {
  it("pyta o materiały TEGO slugu (zawężenie najemcą siedzi w SQL)", async () => {
    h.rpc?.setData("event_sponsor_materials_public", [materialWire()]);
    withClient(<EventMaterialsSection slug="kongres-strategii" />);

    await screen.findByText("Raport rynku energii");
    // Najemcy nie ma w argumentach: `event_sponsor_materials_public` bierze go
    // z nagłówka hosta (`public_tenant_id()`), czego pilnuje bramka
    // `check:sql-tenant-scope`. Front podaje slug i nic poza nim.
    expect(h.rpc?.names()).toEqual(["event_sponsor_materials_public"]);
    expect(h.rpc?.lastCall("event_sponsor_materials_public")?.arg("p_slug")).toBe(
      "kongres-strategii",
    );
    expect(h.rpc?.lastCall("event_sponsor_materials_public")?.keys()).toEqual(["p_slug"]);
  });

  it("sekcja ZA BRAMKĄ nie pyta bazy i nie wydaje anonimowi ani jednego adresu", async () => {
    h.rpc?.setData("event_sponsor_materials_public", [materialWire()]);
    const { container } = withClient(
      <EventMaterialsSection slug="kongres-strategii" enabled={false} />,
    );

    await screen.findByLabelText("eventFront.materials.loading");
    // Materiały są korzyścią uczestnictwa - dopóki bramka jest zamknięta,
    // adres pliku nie ma prawa pojawić się ani w DOM-ie, ani w ruchu sieciowym.
    expect(h.rpc?.callsFor("event_sponsor_materials_public")).toHaveLength(0);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.innerHTML).not.toContain("files.example.org");
  });

  it("zanim odpowiedź przyjdzie, sekcja mówi że wczytuje - a nie że jest pusta", () => {
    h.rpc?.setData("event_sponsor_materials_public", [materialWire()]);
    withClient(<EventMaterialsSection slug="kongres-strategii" />);

    expect(screen.getByLabelText("eventFront.materials.loading")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.queryByText("eventFront.sections.materials.empty")).not.toBeInTheDocument();
  });

  it("pusta odpowiedź daje ZDANIE o pustce, a nie sam nagłówek partnera", async () => {
    h.rpc?.setData("event_sponsor_materials_public", []);
    const { container } = withClient(<EventMaterialsSection slug="kongres-strategii" />);

    expect(await screen.findByText("eventFront.sections.materials.empty")).toBeInTheDocument();
    expect(container.querySelector("h3")).toBeNull();
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("odmowa bazy zamienia się w zdanie i NIE udaje braku materiałów", async () => {
    h.rpc?.setError("event_sponsor_materials_public", "not_found: no such event", "P0002");
    const first = withClient(<EventMaterialsSection slug="kongres-strategii" />);

    await waitFor(() => expect(first.container.querySelector("p")).not.toBeNull());
    const notFound = first.container.querySelector("p")?.textContent ?? "";
    // Ani surowy komunikat plpgsql, ani goły klucz słownika nie wychodzą na
    // stronę publiczną: jedno straszy czytelnika, drugie wygląda jak
    // niewdrożone tłumaczenie.
    expect(notFound).not.toContain("not_found");
    expect(notFound).not.toContain("no such event");
    expect(notFound).not.toContain("eventFront.errors.");
    expect(notFound.trim()).not.toBe("");
    // Awaria pobrania to nie „partnerzy nic nie wrzucili” - inaczej organizator
    // szukałby zguby w studiu zamiast w logach.
    expect(screen.queryByText("eventFront.sections.materials.empty")).not.toBeInTheDocument();

    h.rpc?.setError("event_sponsor_materials_public", "forbidden: sign in first", "42501");
    const second = withClient(<EventMaterialsSection slug="inny-kongres" />);
    await waitFor(() => expect(second.container.querySelector("p")).not.toBeNull());
    expect(second.container.querySelector("p")?.textContent).not.toBe(notFound);
  });

  it("dwa pliki jednego partnera stoją pod JEDNYM nagłówkiem, drugi partner ma własny", async () => {
    h.rpc?.setData("event_sponsor_materials_public", [
      materialWire(),
      materialWire({
        id: "mat-2",
        title_pl: "Prezentacja z sesji plenarnej",
        kind: "presentation",
        url: "https://files.example.org/nordwind/sesja.pptx",
        sort_order: 1,
      }),
      materialWire({
        id: "mat-3",
        sponsor_id: "sp-baltic",
        sponsor_name: "Baltic Print",
        title_pl: "Katalog stoiska",
        url: "https://files.example.org/baltic/katalog.pdf",
      }),
    ]);
    const { container } = withClient(<EventMaterialsSection slug="kongres-strategii" />);

    await screen.findByText("Raport rynku energii");
    // Uczestnik szuka „plików firmy X”, a nie „wszystkich prezentacji”.
    expect([...container.querySelectorAll("h3")].map((el) => el.textContent)).toEqual([
      "Nordwind Analytics",
      "Baltic Print",
    ]);
    const groups = container.querySelectorAll("section");
    expect(groups[0].querySelectorAll("li")).toHaveLength(2);
    expect(groups[1].querySelectorAll("li")).toHaveLength(1);
  });

  it("materiał bez adresu wypada, a partner, który miał tylko jego, nie zostawia nagłówka", async () => {
    h.rpc?.setData("event_sponsor_materials_public", [
      materialWire({ id: "mat-pusty", url: null }),
      materialWire({
        id: "mat-baltic",
        sponsor_id: "sp-baltic",
        sponsor_name: "Baltic Print",
        title_pl: "Katalog stoiska",
        url: "https://files.example.org/baltic/katalog.pdf",
      }),
    ]);
    const { container } = withClient(<EventMaterialsSection slug="kongres-strategii" />);

    await screen.findByText("Katalog stoiska");
    // Przycisk, który nic nie robi, jest gorszy niż jego brak.
    expect(screen.queryByText("Raport rynku energii")).not.toBeInTheDocument();
    expect([...container.querySelectorAll("h3")].map((el) => el.textContent)).toEqual([
      "Baltic Print",
    ]);
  });

  it("adres pliku wychodzi z serwisu bez uchwytu do okna i bez rankingu", async () => {
    h.rpc?.setData("event_sponsor_materials_public", [materialWire()]);
    withClient(<EventMaterialsSection slug="kongres-strategii" />);

    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("href", DECK_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(screen.getByText("eventFront.materials.open")).toBeInTheDocument();
  });

  it("materiał bez tytułu podpisuje się NAZWĄ partnera, a nie pustym wierszem", async () => {
    h.rpc?.setData("event_sponsor_materials_public", [
      materialWire({ title_pl: null, title_en: null }),
    ]);
    withClient(<EventMaterialsSection slug="kongres-strategii" />);

    const link = await screen.findByRole("link");
    // Pusty podpis to pozycja, po której nie da się poznać, co się pobiera.
    expect(link.textContent).toContain("Nordwind Analytics");
  });

  it("rodzaj materiału ma własną etykietę - `logo_pack` nie czyta się jak „link”", async () => {
    h.rpc?.setData("event_sponsor_materials_public", [
      materialWire({ kind: "logo_pack", title_pl: "Paczka logotypów" }),
    ]);
    withClient(<EventMaterialsSection slug="kongres-strategii" />);

    await screen.findByText("Paczka logotypów");
    expect(screen.getByText("eventFront.materials.kinds.logoPack")).toBeInTheDocument();
  });

  it("nieznany rodzaj z bazy degraduje do „linku”, a nie wywraca listy", async () => {
    h.rpc?.setData("event_sponsor_materials_public", [
      materialWire({ kind: "hologram", title_pl: "Nowość z importu" }),
    ]);
    withClient(<EventMaterialsSection slug="kongres-strategii" />);

    // Kolumna `kind` bywa zasilana importem, więc wartość spoza słownika jest
    // osiągalna - i nie może skończyć się białym ekranem sekcji.
    await screen.findByText("Nowość z importu");
    expect(screen.getByText("eventFront.materials.kinds.link")).toBeInTheDocument();
  });
});
