// Widget "pojedynczy slot reklamowy" z buildera stron: redaktor wskazuje slot
// po ID, a komponent dorabia do niego SYNTETYCZNY placement, którego nie ma
// w bazie. Ryzyko jest podwójne: widget znika bez słowa, gdy odczyt padnie,
// a zdarzenia reklamowe raportują identyfikator bez rodzica.
//
// CO TEN PLIK DOWODZI.
//   1. AWARIA ODCZYTU JEST NIEODRÓŻNIALNA OD "SLOT NIEAKTYWNY". `if (!data)
//      return null` obejmuje jednym warunkiem trzy różne światy: zapytanie
//      w toku, slot wstrzymany/usunięty i BŁĄD bazy. Test pokazuje oba
//      skrajne przypadki obok siebie: stan zapytania jest inny (`error`
//      kontra `success`), a strona wygląda IDENTYCZNIE - pusto. Redakcja
//      widzi "kampania nie leci" i nie ma jak odróżnić awarii od konfiguracji.
//   2. SYNTETYCZNY PLACEMENT KŁAMIE O MIEJSCU EMISJI. Niezależnie od tego,
//      gdzie stoi widget (stopka, kolumna boczna, środek strony), placement
//      niesie `position: "top_of_post"` i `page_type: "all"`, a jego `id` to
//      `inline-<slotId>` - klucz, którego NIE MA w `ad_placements`.
//      `AdSlotView` przekazuje `placement.id` wprost do
//      `beaconAdEvent("impression"/"click", slot.id, placement.id)`
//      (`src/components/AdSlot.tsx`, linie 52 i 57), więc każde zdarzenie
//      z widgetu inline ląduje w statystykach jako sierota bez placementu -
//      i jest w nich policzone jako emisja "na górze wpisu".
//      Zapisane jako `it.fails` z opisem oczekiwanego zachowania.
//   3. BRAK WYBRANEGO SLOTU POKAZUJE POLSKI NAPIS WPISANY W KOD.
//      "Wybierz slot reklamowy w ustawieniach widgetu." nie przechodzi przez
//      i18next - czytelnik anglojęzycznej wersji strony (i redaktor
//      pracujący na EN) zobaczy polskie zdanie. Dług i18n, udokumentowany
//      testem, nie naprawiany tutaj.
//   4. FILTR `status = active` SIEDZI W ZAPYTANIU. Wstrzymany slot nie wraca
//      z bazy - usunięcie tego ogniwa przywróciłoby na stronę kreacje, które
//      redakcja świadomie zatrzymała, i żaden typ tego nie złapie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Renderowanie samej kreacji (zgoda marketingowa,
// bramki odroczenia, sandbox HTML/script) dowodzi `AdSlotView.test.tsx`.
//
// ATRAPY I DLACZEGO.
//   * `@/components/AdSlot` - podmieniony na znacznik zapisujący otrzymane
//     propsy. To pozwala zobaczyć DOKŁADNIE, jaki placement dostaje warstwa
//     raportująca, bez wciągania bramek zgody i IntersectionObserver, których
//     dowodzi własny plik testowy tego komponentu.
//   * `@/integrations/supabase/client` - wspólna atrapa łańcucha PostgREST
//     (`src/test/supabase`). Odczyt slotu NIE jest zamockowany na poziomie
//     hooka: przez `useQuery` przechodzi prawdziwy `queryFn` z filtrami.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import type { AdPlacementWithSlot, AdSlot } from "@/lib/ads/types";

const db = await vi.hoisted(async () => {
  const { supabaseFromStub } = await import("@/test/supabase");
  return { stub: supabaseFromStub() };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => db.stub.from(table) },
}));

const przekazane: { placement: AdPlacementWithSlot; className?: string }[] = [];

vi.mock("@/components/AdSlot", () => ({
  AdSlotView: ({
    placement,
    className,
  }: {
    placement: AdPlacementWithSlot;
    className?: string;
  }) => {
    przekazane.push({ placement, className });
    return (
      <div
        data-testid="reklama"
        data-placement-id={placement.id}
        data-slot-id={placement.slot.id}
        data-position={placement.position}
        data-page-type={placement.page_type}
        className={className}
      />
    );
  },
}));

import { fail, ok } from "@/test/supabase";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { AdSlotById } from "@/components/ads/AdSlotById";

const TABELA = "ad_slots";
const KOMUNIKAT_BEZ_SLOTU = "Wybierz slot reklamowy w ustawieniach widgetu.";

// --- Fixtures -----------------------------------------------------------

function wiersz(over: Partial<AdSlot> = {}): AdSlot {
  return {
    id: "slot-77",
    tenant_id: "t1",
    name: "Baner partnera",
    kind: "html",
    status: "active",
    html: "<b>reklama</b>",
    script: null,
    image_url: null,
    image_link: null,
    image_alt: null,
    width: 728,
    height: 90,
    requires_consent: true,
    targeting: {},
    notes: null,
    created_at: "2026-01-02T10:00:00Z",
    updated_at: "2026-02-03T11:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  db.stub.reset();
  przekazane.length = 0;
});

afterEach(() => {
  cleanup();
});

// --- Brak wybranego slotu -----------------------------------------------

describe("AdSlotById - widget bez wybranego slotu", () => {
  it("pokazuje podpowiedź dla redaktora i NIE odpytuje bazy (enabled: !!slotId)", () => {
    const { getByText } = renderWithQueryClient(<AdSlotById slotId="" />);

    expect(getByText(KOMUNIKAT_BEZ_SLOTU)).toBeInTheDocument();
    expect(db.stub.chainsFor(TABELA)).toHaveLength(0);
  });

  it("podpowiedź jest POLSKIM napisem wpisanym w kod, nie kluczem i18n - zobaczy ją także czytelnik EN", () => {
    // Komponent nie importuje `react-i18next` w ogóle: nie ma jak przełączyć
    // tego zdania na angielski. Dług i18n - zgłoszony, nie naprawiany tutaj.
    const { container } = renderWithQueryClient(<AdSlotById slotId="" />);

    const kafel = container.firstElementChild as HTMLElement;
    expect(kafel.textContent?.trim()).toBe(KOMUNIKAT_BEZ_SLOTU);
    expect(kafel.textContent).not.toMatch(/^[a-z][\w]*\./);
  });

  it("klasa z ustawień widgetu trafia na kafel podpowiedzi", () => {
    const { container } = renderWithQueryClient(<AdSlotById slotId="" className="mt-10" />);

    expect(container.firstElementChild).toHaveClass("mt-10");
    expect(container.firstElementChild).toHaveClass("border-dashed");
  });
});

// --- Odczyt slotu -------------------------------------------------------

describe("AdSlotById - odczyt slotu z bazy", () => {
  it("zapytanie filtruje po identyfikatorze ORAZ po statusie active - wstrzymany slot nie wraca z bazy", async () => {
    db.stub.setResponse(TABELA, ok(wiersz()));

    renderWithQueryClient(<AdSlotById slotId="slot-77" />);

    await waitFor(() => expect(db.stub.chainsFor(TABELA)).toHaveLength(1));
    const chain = db.stub.lastChain(TABELA)!;
    const eqs = chain.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs).toEqual([
      ["id", "slot-77"],
      ["status", "active"],
    ]);
    expect(chain.argsOf("select")).toEqual(["*"]);
    expect(chain.has("maybeSingle")).toBe(true);
  });

  it("aktywny slot renderuje kreację, a klasa widgetu jedzie dalej do AdSlotView", async () => {
    db.stub.setResponse(TABELA, ok(wiersz()));

    const { findByTestId } = renderWithQueryClient(
      <AdSlotById slotId="slot-77" className="w-full" />,
    );

    const kreacja = await findByTestId("reklama");
    expect(kreacja).toHaveClass("w-full");
    expect(kreacja.getAttribute("data-slot-id")).toBe("slot-77");
  });

  it("slot nieaktywny (brak wiersza) renderuje PUSTKĘ - widget znika bez komunikatu", async () => {
    db.stub.setResponse(TABELA, ok(null));

    const { container, queryClient } = renderWithQueryClient(<AdSlotById slotId="slot-77" />);

    await waitFor(() =>
      expect(queryClient.getQueryState(["ad_slot", "slot-77"])?.status).toBe("success"),
    );
    expect(container.innerHTML).toBe("");
  });

  it("AWARIA ODCZYTU wygląda dokładnie tak samo jak slot nieaktywny: zapytanie w stanie error, strona pusta", async () => {
    db.stub.setResponse(TABELA, fail("odmowa dostępu do ad_slots", "42501"));

    const { container, queryClient } = renderWithQueryClient(<AdSlotById slotId="slot-77" />);

    await waitFor(() =>
      expect(queryClient.getQueryState(["ad_slot", "slot-77"])?.status).toBe("error"),
    );
    // Ten sam pusty DOM co przy nieaktywnym slocie - różnicę widać wyłącznie
    // w cache react-query, czyli nigdzie poza narzędziami deweloperskimi.
    expect(container.innerHTML).toBe("");
    expect(przekazane).toHaveLength(0);
  });

  it.fails(
    "OCZEKIWANE: awaria odczytu slotu zostawia ślad w interfejsie (choćby kontener diagnostyczny), " +
      "żeby dało się ją odróżnić od slotu wyłączonego; DZIŚ: if (!data) return null zjada oba przypadki",
    async () => {
      db.stub.setResponse(TABELA, fail("odmowa dostępu do ad_slots", "42501"));

      const { container, queryClient } = renderWithQueryClient(<AdSlotById slotId="slot-77" />);

      await waitFor(() =>
        expect(queryClient.getQueryState(["ad_slot", "slot-77"])?.status).toBe("error"),
      );
      expect(container.innerHTML).not.toBe("");
    },
  );
});

// --- Syntetyczny placement ----------------------------------------------

describe("AdSlotById - syntetyczny placement i raportowanie zdarzeń", () => {
  it("placement jest dorabiany w locie: id inline-<slotId>, position top_of_post, page_type all", async () => {
    db.stub.setResponse(TABELA, ok(wiersz()));

    const { findByTestId } = renderWithQueryClient(<AdSlotById slotId="slot-77" />);
    const kreacja = await findByTestId("reklama");

    expect(kreacja.getAttribute("data-placement-id")).toBe("inline-slot-77");
    expect(kreacja.getAttribute("data-position")).toBe("top_of_post");
    expect(kreacja.getAttribute("data-page-type")).toBe("all");

    const placement = przekazane.at(-1)!.placement;
    expect(placement.page_id).toBeNull();
    expect(placement.config).toEqual({});
    expect(placement.active).toBe(true);
    expect(placement.starts_at).toBeNull();
    expect(placement.ends_at).toBeNull();
    // Daty i najemca pochodzą ze SLOTU - placement nie ma własnego wiersza.
    expect(placement.tenant_id).toBe("t1");
    expect(placement.created_at).toBe("2026-01-02T10:00:00Z");
    expect(placement.updated_at).toBe("2026-02-03T11:00:00Z");
  });

  it("okno emisji syntetycznego placementu jest ZAWSZE otwarte - widget ignoruje harmonogram kampanii", async () => {
    db.stub.setResponse(TABELA, ok(wiersz()));

    const { findByTestId } = renderWithQueryClient(<AdSlotById slotId="slot-77" />);
    await findByTestId("reklama");

    const placement = przekazane.at(-1)!.placement;
    expect(placement.starts_at).toBeNull();
    expect(placement.ends_at).toBeNull();
  });

  it.fails(
    "OCZEKIWANE: identyfikator przekazany do rejestracji zdarzeń wskazuje istniejący wiersz ad_placements; " +
      "DZIŚ: 'inline-<slotId>' bez rodzica, więc zdarzenia z widgetów inline są w statystykach sierotami",
    async () => {
      db.stub.setResponse(TABELA, ok(wiersz()));

      const { findByTestId } = renderWithQueryClient(<AdSlotById slotId="slot-77" />);
      await findByTestId("reklama");

      // AdSlotView przekazuje `placement.id` wprost do
      // beaconAdEvent(..., slot.id, placement.id) - AdSlot.tsx, linie 52 i 57.
      expect(przekazane.at(-1)!.placement.id).not.toMatch(/^inline-/);
    },
  );

  it.fails(
    "OCZEKIWANE: pozycja i typ strony syntetycznego placementu odpowiadają MIEJSCU, w którym stoi widget; " +
      "DZIŚ: zawsze top_of_post/all, więc statystyki liczą emisję ze stopki jako emisję nad wpisem",
    async () => {
      db.stub.setResponse(TABELA, ok(wiersz()));

      const { findByTestId } = renderWithQueryClient(<AdSlotById slotId="slot-77" />);
      await findByTestId("reklama");

      const placement = przekazane.at(-1)!.placement;
      // Widget nie przyjmuje ani pozycji, ani typu strony - nie ma czym opisać
      // miejsca emisji, więc każde umiejscowienie raportuje się identycznie.
      expect([placement.position, placement.page_type]).not.toEqual(["top_of_post", "all"]);
    },
  );
});
