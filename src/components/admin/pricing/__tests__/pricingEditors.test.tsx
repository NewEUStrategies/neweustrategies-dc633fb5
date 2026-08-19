// Edytory cennika w panelu redakcyjnym - cztery powierzchnie, wszystkie na
// ZERZE do 18.08.2026: `TierBenefitsEditor` (0 z 21 funkcji),
// `TierFeatureTogglesEditor` (0 z 6), `ExpertRequestQuotaEditor` (0 z 6),
// `ConfluenceReconciliationCard` (0 z 3).
//
// TU REDAKCJA DEFINIUJE, CO KUPUJE KLIENT. Benefit dopisany w tym panelu
// pojawia się na karcie planu jako obietnica sprzedażowa, a flaga capability
// steruje REALNĄ bramką dostępu. Błąd w tych edytorach nie jest błędem
// wyświetlania - to rozjazd między tym, co sprzedaliśmy, a tym, co klient
// dostaje.
//
// Trzy rzeczy pilnowane najmocniej:
//
//   1. EDYCJA NIE GUBI POZOSTAŁYCH PÓL. Oba edytory flag pracują na WSPÓLNYM
//      drafcie JSON razem z polem surowym - flaga spoza rejestru i wartość
//      nie-boolowska muszą przejść nietknięte, bo inaczej przełączenie jednego
//      chipa wyciera cudzą konfigurację.
//   2. FLAGA EGZEKWOWANA JEST ODRÓŻNIONA OD DEKLARACJI MARKETINGOWEJ. Redakcja
//      musi widzieć, która obietnica ma za sobą bramkę, a która jest tylko
//      napisem na karcie planu.
//   3. PULA ZAPYTAŃ DO EKSPERTA jest liczbą całkowitą w zakresie, a przy
//      dostępie bezpośrednim (VIP) nie ma zastosowania - i panel to mówi,
//      zamiast pokazywać mylące „0".
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { TierBenefit } from "@/lib/billing/tiers";

const h = vi.hoisted(() => ({ lang: { current: "pl" } }));

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub(() => h.lang.current);
});

vi.mock("@/lib/i18n-admin-pricing", () => ({ ensureI18n: () => {} }));
vi.mock("@/lib/i18n-admin-membership", () => ({ ensureI18n: () => {} }));

import { ConfluenceReconciliationCard } from "@/components/admin/pricing/ConfluenceReconciliationCard";
import { ExpertRequestQuotaEditor } from "@/components/admin/pricing/ExpertRequestQuotaEditor";
import { TierBenefitsEditor } from "@/components/admin/pricing/TierBenefitsEditor";
import { TierFeatureTogglesEditor } from "@/components/admin/pricing/TierFeatureTogglesEditor";
import { TIER_CAPABILITIES } from "@/lib/billing/capabilities";

beforeEach(() => {
  h.lang.current = "pl";
});

// --- TierBenefitsEditor -----------------------------------------------------

/** Renderuje edytor benefitów, zwracając ostatni stan przekazany do `onChange`. */
function renderBenefits(initial: TierBenefit[]) {
  const onChange = vi.fn();
  const view = render(<TierBenefitsEditor value={initial} onChange={onChange} />);
  const latest = (): TierBenefit[] =>
    (onChange.mock.calls.at(-1)?.[0] as TierBenefit[] | undefined) ?? initial;
  return { ...view, onChange, latest };
}

const benefit = (overrides: Partial<TierBenefit> = {}): TierBenefit => ({
  pl: "Dostęp do analiz",
  en: "Access to analyses",
  ...overrides,
});

describe("TierBenefitsEditor - lista benefitów", () => {
  it("pusta lista mówi to wprost, zamiast pokazywać nagłówek nad pustką", () => {
    renderBenefits([]);

    expect(screen.getByText("adminPricing.benefits.empty")).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("benefity są numerowane, żeby redakcja wiedziała, co jest gdzie na karcie", () => {
    renderBenefits([benefit({ pl: "Pierwszy" }), benefit({ pl: "Drugi" })]);

    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByText("#2")).toBeTruthy();
  });

  it("dodanie benefitu dokłada PUSTĄ parę na koniec, nie kasuje istniejących", () => {
    const { onChange, latest } = renderBenefits([benefit({ pl: "Istniejący" })]);

    fireEvent.click(screen.getByText("adminPricing.benefits.add"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(latest()).toEqual([benefit({ pl: "Istniejący" }), { pl: "", en: "" }]);
  });

  it("edycja polskiej treści nie rusza angielskiej", () => {
    const { latest } = renderBenefits([benefit()]);

    fireEvent.change(screen.getByDisplayValue("Dostęp do analiz"), {
      target: { value: "Dostęp do raportów" },
    });

    expect(latest()[0].pl).toBe("Dostęp do raportów");
    expect(latest()[0].en).toBe("Access to analyses");
  });

  it("usunięcie benefitu usuwa DOKŁADNIE ten wiersz", () => {
    const { latest } = renderBenefits([
      benefit({ pl: "Pierwszy" }),
      benefit({ pl: "Drugi" }),
      benefit({ pl: "Trzeci" }),
    ]);

    fireEvent.click(screen.getAllByTitle("adminPricing.benefits.remove")[1]);

    expect(latest().map((b) => b.pl)).toEqual(["Pierwszy", "Trzeci"]);
    expect(latest()).toHaveLength(2);
  });

  it("KOLEJNOŚĆ da się zmienić W DÓŁ", () => {
    const { latest } = renderBenefits([benefit({ pl: "Pierwszy" }), benefit({ pl: "Drugi" })]);

    fireEvent.click(screen.getAllByTitle("adminPricing.benefits.moveDown")[0]);

    expect(latest().map((b) => b.pl)).toEqual(["Drugi", "Pierwszy"]);
    expect(latest()).toHaveLength(2);
  });

  it("KOLEJNOŚĆ da się zmienić W GÓRĘ", () => {
    const { latest } = renderBenefits([
      benefit({ pl: "Pierwszy" }),
      benefit({ pl: "Drugi" }),
      benefit({ pl: "Trzeci" }),
    ]);

    fireEvent.click(screen.getAllByTitle("adminPricing.benefits.moveUp")[2]);

    expect(latest().map((b) => b.pl)).toEqual(["Pierwszy", "Trzeci", "Drugi"]);
    expect(latest()).toHaveLength(3);
  });

  it("przesunięcie w górę pierwszego i w dół ostatniego jest ZABLOKOWANE", () => {
    renderBenefits([benefit({ pl: "Pierwszy" }), benefit({ pl: "Drugi" })]);

    const up = screen.getAllByTitle("adminPricing.benefits.moveUp");
    const down = screen.getAllByTitle("adminPricing.benefits.moveDown");
    expect(up[0].hasAttribute("disabled")).toBe(true);
    expect(down[1].hasAttribute("disabled")).toBe(true);
  });

  it("pojedynczy benefit ma zablokowane oba przesunięcia", () => {
    renderBenefits([benefit()]);

    expect(screen.getByTitle("adminPricing.benefits.moveUp").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTitle("adminPricing.benefits.moveDown").hasAttribute("disabled")).toBe(true);
  });
});

describe("TierBenefitsEditor - pola dodatkowe (rozwinięcie i grupa)", () => {
  it("wiersz BEZ pól dodatkowych startuje zwinięty", () => {
    renderBenefits([benefit()]);

    expect(screen.queryByPlaceholderText("adminPricing.benefits.detailPl")).toBeNull();
    expect(screen.getByText("adminPricing.benefits.more").getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("wiersz Z WYPEŁNIONYM rozwinięciem jest otwarty ZAWSZE - nic edytowalnego nie znika", () => {
    renderBenefits([benefit({ detail_pl: "Pełne archiwum" })]);

    expect(screen.getByDisplayValue("Pełne archiwum")).toBeTruthy();
    expect(screen.getByText("adminPricing.benefits.more").getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("wypełniony nagłówek grupy też trzyma wiersz otwarty", () => {
    renderBenefits([benefit({ group_en: "Research" })]);

    expect(screen.getByDisplayValue("Research")).toBeTruthy();
    expect(screen.getByText("adminPricing.benefits.more").getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("ręczne rozwinięcie odsłania cztery pola dodatkowe", () => {
    renderBenefits([benefit()]);

    fireEvent.click(screen.getByText("adminPricing.benefits.more"));

    expect(screen.getByPlaceholderText("adminPricing.benefits.detailPl")).toBeTruthy();
    expect(screen.getByPlaceholderText("adminPricing.benefits.groupEn")).toBeTruthy();
  });

  it("edycja rozwinięcia zachowuje parę PL/EN benefitu", () => {
    const { latest } = renderBenefits([benefit()]);
    fireEvent.click(screen.getByText("adminPricing.benefits.more"));

    fireEvent.change(screen.getByPlaceholderText("adminPricing.benefits.detailEn"), {
      target: { value: "Full archive" },
    });

    expect(latest()[0]).toMatchObject({
      pl: "Dostęp do analiz",
      en: "Access to analyses",
      detail_en: "Full archive",
    });
  });

  it("edycja POLSKIEGO rozwinięcia zachowuje resztę pól", () => {
    const { latest } = renderBenefits([benefit({ group_pl: "Badania" })]);

    fireEvent.change(screen.getByPlaceholderText("adminPricing.benefits.detailPl"), {
      target: { value: "Pełne archiwum" },
    });

    expect(latest()[0].detail_pl).toBe("Pełne archiwum");
    expect(latest()[0].group_pl).toBe("Badania");
  });

  it("edycja ANGIELSKIEGO nagłówka grupy zachowuje polski", () => {
    const { latest } = renderBenefits([benefit({ group_pl: "Badania" })]);

    fireEvent.change(screen.getByPlaceholderText("adminPricing.benefits.groupEn"), {
      target: { value: "Research" },
    });

    expect(latest()[0].group_en).toBe("Research");
    expect(latest()[0].group_pl).toBe("Badania");
  });

  it("edycja ANGIELSKIEJ treści benefitu nie rusza polskiej", () => {
    const { latest } = renderBenefits([benefit()]);

    fireEvent.change(screen.getByDisplayValue("Access to analyses"), {
      target: { value: "Access to reports" },
    });

    expect(latest()[0].en).toBe("Access to reports");
    expect(latest()[0].pl).toBe("Dostęp do analiz");
  });

  it("edycja nagłówka grupy nie wyciera rozwinięcia", () => {
    const { latest } = renderBenefits([benefit({ detail_pl: "Pełne archiwum" })]);

    fireEvent.change(screen.getByPlaceholderText("adminPricing.benefits.groupPl"), {
      target: { value: "Badania" },
    });

    expect(latest()[0].detail_pl).toBe("Pełne archiwum");
    expect(latest()[0].group_pl).toBe("Badania");
  });
});

describe("TierBenefitsEditor - BRAK WALIDACJI (stan zgłoszony)", () => {
  // Edytor nie waliduje niczego: benefit bez etykiety w obu językach zapisuje
  // się jak każdy inny i trafia na kartę planu jako PUSTY punkt listy.
  // Test PRZYPINA ten stan, zamiast go zmieniać - wymuszenie etykiety to decyzja
  // redakcyjna o tym, co blokuje zapis warstwy, a nie sprzątanie przy testach.
  // Zgłoszone w dokumencie wdrożenia.
  it("benefit BEZ ETYKIETY w obu językach przechodzi bez ostrzeżenia", () => {
    const { latest } = renderBenefits([benefit({ pl: "Do wyczyszczenia" })]);

    fireEvent.change(screen.getByDisplayValue("Do wyczyszczenia"), { target: { value: "" } });

    expect(latest()[0]).toMatchObject({ pl: "", en: "Access to analyses" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("dodanie pustego benefitu też nie wywołuje ostrzeżenia", () => {
    renderBenefits([]);

    fireEvent.click(screen.getByText("adminPricing.benefits.add"));

    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// --- TierFeatureTogglesEditor ----------------------------------------------

function renderToggles(value: string, disabled = false) {
  const onChange = vi.fn();
  const view = render(
    <TierFeatureTogglesEditor value={value} onChange={onChange} disabled={disabled} />,
  );
  const latest = (): Record<string, unknown> =>
    JSON.parse((onChange.mock.calls.at(-1)?.[0] as string | undefined) ?? "{}");
  return { ...view, onChange, latest };
}

const firstEnforced = TIER_CAPABILITIES.find((cap) => cap.enforced)!;
const firstDecorative = TIER_CAPABILITIES.find((cap) => !cap.enforced);

describe("TierFeatureTogglesEditor - flagi z rejestru", () => {
  it("pokazuje WSZYSTKIE flagi z rejestru, nie tylko ustawione", () => {
    renderToggles("{}");

    expect(screen.getAllByRole("listitem")).toHaveLength(TIER_CAPABILITIES.length);
    expect(screen.getByText(firstEnforced.key)).toBeTruthy();
  });

  it("flaga ustawiona ma kontrakt a11y stanu wciśniętego", () => {
    renderToggles(JSON.stringify({ [firstEnforced.key]: true }));

    const chip = screen.getByText(firstEnforced.key).closest("button")!;
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("button")[0]).toBeTruthy();
  });

  it("FLAGA EGZEKWOWANA jest odróżniona od deklaracji marketingowej", () => {
    renderToggles("{}");

    expect(screen.getAllByText("adminPricing.capabilities.enforced").length).toBeGreaterThan(0);
    if (firstDecorative) {
      expect(screen.getAllByText("adminPricing.capabilities.decorative").length).toBeGreaterThan(0);
    }
  });

  it("punkt egzekwowania jest podpowiedzią przy chipie", () => {
    renderToggles("{}");

    const chip = screen.getByText(firstEnforced.key).closest("button")!;
    expect(chip.getAttribute("title")).toBe(firstEnforced.where_pl);
  });

  it("punkt egzekwowania idzie za językiem interfejsu", () => {
    h.lang.current = "en";
    renderToggles("{}");

    const chip = screen.getByText(firstEnforced.key).closest("button")!;
    expect(chip.getAttribute("title")).toBe(firstEnforced.where_en);
  });

  it("włączenie flagi dopisuje ją do draftu", () => {
    const { latest } = renderToggles("{}");

    fireEvent.click(screen.getByText(firstEnforced.key).closest("button")!);

    expect(latest()[firstEnforced.key]).toBe(true);
  });

  it("wyłączenie flagi USUWA klucz, nie ustawia `false`", () => {
    const { latest } = renderToggles(JSON.stringify({ [firstEnforced.key]: true }));

    fireEvent.click(screen.getByText(firstEnforced.key).closest("button")!);

    expect(firstEnforced.key in latest()).toBe(false);
    expect(latest()[firstEnforced.key]).toBeUndefined();
  });

  it("EDYCJA NIE GUBI flagi spoza rejestru", () => {
    const { latest } = renderToggles(JSON.stringify({ flaga_z_przyszlosci: true }));

    fireEvent.click(screen.getByText(firstEnforced.key).closest("button")!);

    expect(latest().flaga_z_przyszlosci).toBe(true);
    expect(latest()[firstEnforced.key]).toBe(true);
  });

  it("EDYCJA NIE GUBI wartości nie-boolowskiej (np. puli liczbowej)", () => {
    const { latest } = renderToggles(JSON.stringify({ expert_request_quota: 12 }));

    fireEvent.click(screen.getByText(firstEnforced.key).closest("button")!);

    expect(latest().expert_request_quota).toBe(12);
  });

  it("USZKODZONY JSON nie wywala edytora - traktowany jak brak flag", () => {
    renderToggles("{to nie jest json");

    expect(screen.getAllByRole("listitem")).toHaveLength(TIER_CAPABILITIES.length);
    expect(
      screen.getByText(firstEnforced.key).closest("button")!.getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("TABLICA zamiast obiektu też jest traktowana jak brak flag", () => {
    renderToggles("[1,2,3]");

    expect(
      screen.getByText(firstEnforced.key).closest("button")!.getAttribute("aria-pressed"),
    ).toBe("false");
    expect(screen.getAllByRole("listitem")).toHaveLength(TIER_CAPABILITIES.length);
  });

  it("wyłączony edytor nie zmienia draftu", () => {
    const { onChange } = renderToggles("{}", true);

    fireEvent.click(screen.getByText(firstEnforced.key).closest("button")!);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(firstEnforced.key).closest("button")!.hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("lista chipów ma etykietę dostępną", () => {
    renderToggles("{}");

    expect(screen.getByLabelText("adminMembership.fields.featuresKnown")).toBeTruthy();
  });
});

// --- ExpertRequestQuotaEditor ----------------------------------------------

function renderQuota(value: string, disabled = false) {
  const onChange = vi.fn();
  const view = render(
    <ExpertRequestQuotaEditor value={value} onChange={onChange} disabled={disabled} />,
  );
  const latest = (): Record<string, unknown> =>
    JSON.parse((onChange.mock.calls.at(-1)?.[0] as string | undefined) ?? "{}");
  const field = () => screen.getByLabelText("adminMembership.expertRequest.label");
  return { ...view, onChange, latest, field };
}

describe("ExpertRequestQuotaEditor - pula zapytań do eksperta", () => {
  it("pusta pula pokazuje puste pole, nie zero", () => {
    const { field } = renderQuota("{}");

    expect((field() as HTMLInputElement).value).toBe("");
    expect(field().getAttribute("placeholder")).toBe("0");
  });

  it("ustawiona pula jest widoczna w polu", () => {
    const { field } = renderQuota(JSON.stringify({ expert_request_quota: 12 }));

    expect((field() as HTMLInputElement).value).toBe("12");
  });

  it("pula zapisana jako NAPIS też jest odczytana", () => {
    const { field } = renderQuota(JSON.stringify({ expert_request_quota: "7" }));

    expect((field() as HTMLInputElement).value).toBe("7");
  });

  it("wartość nieliczbowa schodzi na pustą pulę, nie na `NaN`", () => {
    const { field } = renderQuota(JSON.stringify({ expert_request_quota: "dużo" }));

    expect((field() as HTMLInputElement).value).toBe("");
    expect(field().getAttribute("aria-invalid")).toBeNull();
  });

  it("wpisana liczba trafia do draftu", () => {
    const { latest, field } = renderQuota("{}");

    fireEvent.change(field(), { target: { value: "5" } });

    expect(latest().expert_request_quota).toBe(5);
  });

  it("ZERO usuwa pulę z draftu, zamiast zapisywać zero", () => {
    const { latest } = renderQuota(JSON.stringify({ expert_request_quota: 5 }));

    fireEvent.change(screen.getByLabelText("adminMembership.expertRequest.label"), {
      target: { value: "0" },
    });

    expect("expert_request_quota" in latest()).toBe(false);
  });

  it("LICZBA UJEMNA nie zapisuje ujemnej puli", () => {
    const { latest } = renderQuota(JSON.stringify({ expert_request_quota: 5 }));

    fireEvent.change(screen.getByLabelText("adminMembership.expertRequest.label"), {
      target: { value: "-3" },
    });

    expect("expert_request_quota" in latest()).toBe(false);
    expect(latest().expert_request_quota).toBeUndefined();
  });

  it("liczba UŁAMKOWA jest przycinana do całkowitej", () => {
    const { latest, field } = renderQuota("{}");

    fireEvent.change(field(), { target: { value: "7.9" } });

    expect(latest().expert_request_quota).toBe(7);
  });

  it("pula ponad limit jest PRZYCINANA do 999, nie odrzucana", () => {
    const { latest, field } = renderQuota("{}");

    fireEvent.change(field(), { target: { value: "5000" } });

    expect(latest().expert_request_quota).toBe(999);
  });

  it("edycja puli NIE GUBI pozostałych flag", () => {
    const { latest, field } = renderQuota(JSON.stringify({ can_read_premium: true }));

    fireEvent.change(field(), { target: { value: "3" } });

    expect(latest().can_read_premium).toBe(true);
    expect(latest().expert_request_quota).toBe(3);
  });

  it("DOSTĘP BEZPOŚREDNI (VIP) zamienia pole na notę - liczba nie ma zastosowania", () => {
    renderQuota(JSON.stringify({ chat_direct_gated: true }));

    expect(screen.getByText("adminMembership.expertRequest.directNote")).toBeTruthy();
    expect(screen.queryByLabelText("adminMembership.expertRequest.label")).toBeNull();
  });

  it("uszkodzony JSON nie wywala edytora", () => {
    const { field } = renderQuota("{zepsute");

    expect((field() as HTMLInputElement).value).toBe("");
    expect(screen.getByText("adminMembership.expertRequest.hint")).toBeTruthy();
  });

  it("wyłączone pole nie przyjmuje zmian", () => {
    const { field } = renderQuota("{}", true);

    expect(field().hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("adminMembership.expertRequest.hint")).toBeTruthy();
  });
});

// --- ConfluenceReconciliationCard ------------------------------------------

describe("ConfluenceReconciliationCard - nota redakcyjna", () => {
  it("pokazuje tabelę uzgodnienia świadczeń z czterema kolumnami", () => {
    render(<ConfluenceReconciliationCard lang="pl" />);

    expect(screen.getByText("Świadczenie z Confluence")).toBeTruthy();
    expect(screen.getByText("Rekomendowany próg docelowy")).toBeTruthy();
  });

  it("treść wiersza idzie za JĘZYKIEM podanym w propsie, nie za i18n", () => {
    const { unmount } = render(<ConfluenceReconciliationCard lang="pl" />);
    expect(screen.getByText(/Karta członkowska VIP/)).toBeTruthy();
    unmount();

    render(<ConfluenceReconciliationCard lang="en" />);
    expect(screen.getByText(/VIP membership card/)).toBeTruthy();
    expect(screen.queryByText(/Karta członkowska VIP/)).toBeNull();
  });

  it("nagłówki kolumn też przechodzą na angielski", () => {
    render(<ConfluenceReconciliationCard lang="en" />);

    expect(screen.getByText("Confluence benefit")).toBeTruthy();
    expect(screen.queryByText("Świadczenie z Confluence")).toBeNull();
  });

  it("odnośnik do modelu subskrypcji otwiera się bez dostępu do okna źródłowego", () => {
    render(<ConfluenceReconciliationCard lang="pl" />);

    const link = screen.getByText(/Model subskrypcji/).closest("a")!;
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("świadczenie BEZ odpowiednika na platformie jest wypisane jako do decyzji", () => {
    render(<ConfluenceReconciliationCard lang="pl" />);

    // To jest cała wartość tej noty: pokazać, czego jeszcze nie ma. Takich
    // świadczeń jest więcej niż jedno, więc liczymy je, a nie szukamy jednego.
    expect(screen.getAllByText("Brak - do decyzji").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("row").length).toBeGreaterThan(1);
  });
});
