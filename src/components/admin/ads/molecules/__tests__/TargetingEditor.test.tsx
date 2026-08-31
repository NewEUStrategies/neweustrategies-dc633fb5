// Edytor kolumny `ad_slots.targeting` - chipy kategorii/tagow i przelaczniki
// wersji jezykowych.
//
// PO CO TEN PLIK ISTNIEJE. Ten komponent jest STEROWANY: sam niczego nie
// pamieta, tylko oddaje rodzicowi CALY nowy obiekt `AdTargeting`. Cale ryzyko
// siedzi wiec w KSZTALCIE tego obiektu, a nie w tym, co widac na ekranie:
//   * zgubiony rozspread (`{ ...value }`) kasuje pozostale wymiary targetingu -
//     zaznaczenie tagu kasuje wybrane kategorie, a redaktor widzi to dopiero po
//     zapisie, kiedy kreacja zaczyna leciec szerzej, niz mial zamiar;
//   * odznaczenie realizowane przez „dopisz jeszcze raz" zamiast przez usuniecie
//     ze zbioru daje slot, ktorego NIE DA SIE odwezic z panelu;
//   * duplikat sluga w tablicy przechodzi do jsonb i psuje licznik
//     w podsumowaniu („3 kategorie" przy dwoch realnych).
// Dlatego kazdy przypadek asertuje ARGUMENT `onChange`, a nie klase CSS.
//
// GRANICE vs SASIEDZI. Atrapowany jest wylacznie klient Supabase (granica I/O)
// i i18n. `useInterestCatalog` biegnie PRAWDZIWY - to on decyduje, jaka
// etykieta i jaki slug trafiaja na chip, wiec jego podmiana zamienilaby test
// w sprawdzanie wlasnej atrapy. `chipClass` z `../model` rowniez biegnie
// prawdziwy.
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, type SupabaseFromStub } from "@/test/supabaseChain";
import type { AdTargeting } from "@/lib/ads/types";

const stubs = vi.hoisted(() => ({ from: null as unknown, rt: null as unknown, lang: "pl" }));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => stubs.lang),
);

// GRANICA: klient Supabase. `useInterestCatalog` odswieza katalog po realtime,
// wiec atrapa musi umiec takze `channel`/`removeChannel` - inaczej efekt hooka
// wywraca sie na starcie i test nie dociera do zachowania edytora.
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const { realtimeStub } = await import("@/test/supabase/realtime");
  const from = supabaseFromStub();
  const rt = realtimeStub();
  stubs.from = from;
  stubs.rt = rt;
  return {
    supabase: {
      from: from.from,
      channel: rt.channel.bind(rt),
      removeChannel: rt.removeChannel.bind(rt),
    },
  };
});

import { TargetingEditor } from "../TargetingEditor";

const db = () => stubs.from as SupabaseFromStub;

/** Katalog zainteresowan tak, jak zwraca go PostgREST (kolumny, nie DTO). */
function withCatalog(): void {
  db().setResponse(
    "categories",
    ok([
      { id: "cat-ue", slug: "unia-europejska", name_pl: "Unia", name_en: "EU", parent_id: null },
      {
        id: "cat-sec",
        slug: "bezpieczenstwo",
        name_pl: "Bezpieczenstwo",
        name_en: "Security",
        parent_id: null,
      },
    ]),
  );
  db().setResponse("tags", ok([{ id: "tag-nato", slug: "nato", name: "NATO" }]));
}

function withEmptyCatalog(): void {
  db().setResponse("categories", ok([]));
  db().setResponse("tags", ok([]));
}

beforeEach(() => {
  db().reset();
  (stubs.rt as { reset(): void }).reset();
  stubs.lang = "pl";
});

describe("TargetingEditor - katalog", () => {
  it("PUSTY katalog zainteresowan nie wywraca edytora - zostaja same jezyki", async () => {
    // Swiezy najemca nie ma jeszcze ani jednej kategorii. Edytor musi wtedy
    // dalej pozwalac zawezic emisje po jezyku, zamiast zniknac albo rzucic.
    withEmptyCatalog();
    renderWithQueryClient(<TargetingEditor value={{}} onChange={vi.fn()} />);
    await waitFor(() => expect(db().chainsFor("categories").length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: "PL" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "EN" })).toBeInTheDocument();
    expect(screen.getByText("adsAdmin.categories")).toBeInTheDocument();
  });

  it("chipy niosa ETYKIETY z katalogu, a tagi dostaja prefiks `#`", async () => {
    withCatalog();
    renderWithQueryClient(<TargetingEditor value={{}} onChange={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Unia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "#NATO" })).toBeInTheDocument();
  });

  it("jezyk interfejsu EN wybiera angielskie etykiety kategorii", async () => {
    // Katalog jest dwujezyczny; panel ma pokazywac etykiety w jezyku redaktora,
    // inaczej redakcja anglojezyczna targetuje po omacku.
    stubs.lang = "en";
    withCatalog();
    renderWithQueryClient(<TargetingEditor value={{}} onChange={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "EU" })).toBeInTheDocument();
  });
});

describe("TargetingEditor - zaznaczanie i odznaczanie", () => {
  it("ZAZNACZENIE kategorii dokłada JEJ SLUG, nie etykiete", async () => {
    // Do jsonb ida slugi - sa stabilne miedzy srodowiskami i sa tym, co ma pod
    // reka kontekst strony przy emisji. Etykieta zmienia sie przy kazdej
    // korekcie nazwy kategorii i zerwalaby dopasowanie.
    withCatalog();
    const onChange = vi.fn<(next: AdTargeting) => void>();
    renderWithQueryClient(<TargetingEditor value={{}} onChange={onChange} />);
    fireEvent.click(await screen.findByRole("button", { name: "Unia" }));
    expect(onChange).toHaveBeenCalledWith({ categorySlugs: ["unia-europejska"] });
  });

  it("ODZNACZENIE kategorii USUWA slug ze zbioru", async () => {
    withCatalog();
    const onChange = vi.fn<(next: AdTargeting) => void>();
    renderWithQueryClient(
      <TargetingEditor
        value={{ categorySlugs: ["unia-europejska", "bezpieczenstwo"] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Unia" }));
    expect(onChange).toHaveBeenCalledWith({ categorySlugs: ["bezpieczenstwo"] });
  });

  it("zaznaczenie tagu NIE KASUJE wybranych kategorii ani jezykow", async () => {
    // Najczestszy sposob, w jaki taki edytor cicho traci dane: nowy obiekt
    // budowany od zera zamiast rozspreadowania poprzedniego.
    withCatalog();
    const onChange = vi.fn<(next: AdTargeting) => void>();
    renderWithQueryClient(
      <TargetingEditor
        value={{ categorySlugs: ["unia-europejska"], languages: ["pl"] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "#NATO" }));
    expect(onChange).toHaveBeenCalledWith({
      categorySlugs: ["unia-europejska"],
      tagSlugs: ["nato"],
      languages: ["pl"],
    });
  });

  it("ODZNACZENIE tagu zostawia PUSTA tablice, nie usuwa klucza", async () => {
    // `adTargetingToJson` sam wytnie puste pole przy zapisie; edytor ma tylko
    // rzetelnie powiedziec „zaden tag nie jest juz wybrany".
    withCatalog();
    const onChange = vi.fn<(next: AdTargeting) => void>();
    renderWithQueryClient(<TargetingEditor value={{ tagSlugs: ["nato"] }} onChange={onChange} />);
    fireEvent.click(await screen.findByRole("button", { name: "#NATO" }));
    expect(onChange).toHaveBeenCalledWith({ tagSlugs: [] });
  });

  it("ZAZNACZENIE jezyka dokłada kod wersji", async () => {
    withCatalog();
    const onChange = vi.fn<(next: AdTargeting) => void>();
    renderWithQueryClient(<TargetingEditor value={{}} onChange={onChange} />);
    fireEvent.click(await screen.findByRole("button", { name: "EN" }));
    expect(onChange).toHaveBeenCalledWith({ languages: ["en"] });
  });

  it("ODZNACZENIE jezyka usuwa go, zostawiajac drugi", async () => {
    withCatalog();
    const onChange = vi.fn<(next: AdTargeting) => void>();
    renderWithQueryClient(
      <TargetingEditor value={{ languages: ["pl", "en"] }} onChange={onChange} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "PL" }));
    expect(onChange).toHaveBeenCalledWith({ languages: ["en"] });
  });

  it("pelny cykl sterowania: zaznacz - odznacz wraca do stanu wyjsciowego", async () => {
    // Edytor nie ma wlasnego stanu, wiec dowod musi przejsc PRZEZ rodzica.
    // `Sterowany` odgrywa dokladnie te role, ktora w produkcji pelni szkic
    // slotu: bierze obiekt z `onChange` i oddaje go z powrotem jako `value`.
    // Bez tego cyklu duplikat sluga (tablica zamiast zbioru) nie mialby jak
    // sie ujawnic - a to on rozjezdza licznik w podsumowaniu listy.
    withCatalog();
    const kolejne: AdTargeting[] = [];
    function Sterowany() {
      const [value, setValue] = useState<AdTargeting>({ categorySlugs: ["bezpieczenstwo"] });
      return (
        <TargetingEditor
          value={value}
          onChange={(next) => {
            kolejne.push(next);
            setValue(next);
          }}
        />
      );
    }
    renderWithQueryClient(<Sterowany />);
    const chip = await screen.findByRole("button", { name: "Unia" });
    fireEvent.click(chip);
    expect(kolejne.at(-1)).toEqual({ categorySlugs: ["bezpieczenstwo", "unia-europejska"] });
    fireEvent.click(screen.getByRole("button", { name: "Unia" }));
    expect(kolejne.at(-1)).toEqual({ categorySlugs: ["bezpieczenstwo"] });
  });
});

describe("TargetingEditor - stan wizualny", () => {
  it("chip wybranej kategorii ma `aria-pressed=true`, pozostale `false`", async () => {
    // To jedyny sygnal dla czytnika ekranu; bez niego lista chipow jest dla
    // niewidomego redaktora nieodroznialna od zwyklych przyciskow.
    withCatalog();
    renderWithQueryClient(
      <TargetingEditor value={{ categorySlugs: ["unia-europejska"] }} onChange={vi.fn()} />,
    );
    expect(await screen.findByRole("button", { name: "Unia" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Bezpieczenstwo" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("chip wybranego jezyka jest odrozniony klasa akcentu", async () => {
    withCatalog();
    renderWithQueryClient(<TargetingEditor value={{ languages: ["pl"] }} onChange={vi.fn()} />);
    const pl = await screen.findByRole("button", { name: "PL" });
    const en = screen.getByRole("button", { name: "EN" });
    expect(pl.className).toContain("bg-primary");
    expect(en.className).not.toContain("bg-primary");
  });

  it("wszystkie chipy sa `type=button` - nie moga wysylac formularza slotu", async () => {
    // Edytor stoi WEWNATRZ formularza slotu. Domyslny `type=submit` zamienilby
    // kazde zaznaczenie kategorii w probe zapisu.
    withCatalog();
    renderWithQueryClient(<TargetingEditor value={{}} onChange={vi.fn()} />);
    await screen.findByRole("button", { name: "Unia" });
    for (const chip of screen.getAllByRole("button")) {
      expect(chip).toHaveAttribute("type", "button");
    }
  });
});
