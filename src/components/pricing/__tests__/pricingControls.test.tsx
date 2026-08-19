// Sterowanie ofertą na stronie cennika: przełącznik SEGMENTÓW i przełącznik
// CYKLU rozliczenia - 0 z 8 funkcji pokrytych do 18.08.2026.
//
// Oba są bramkami wejścia do zakupu: segment decyduje, KTÓRE warstwy klient
// zobaczy, cykl - JAKĄ cenę. Dla segmentów sprawdzamy pełny kontrakt tablisty
// (strzałki, Home/End, roving tabindex), bo bez klawiatury połowa oferty jest
// nieosiągalna. Dla cyklu - że badge oszczędności stoi WYŁĄCZNIE przy opcji
// rocznej i tylko wtedy, gdy oszczędność wyliczono z planów.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { pricingAudience, reactI18nextStub } from "@/test/admin/pricingFixtures";

const trackCta = vi.fn();
let lang = "pl";

vi.mock("react-i18next", () => reactI18nextStub(() => lang));
vi.mock("@/lib/analytics/track", () => ({ trackCta: (...args: unknown[]) => trackCta(...args) }));

const { AudienceSwitcher } = await import("@/components/pricing/AudienceSwitcher");
const { IntervalToggle } = await import("@/components/pricing/IntervalToggle");

const AUDIENCES = [
  pricingAudience({ id: "a1", key: "individual", name_pl: "Dla Ciebie", name_en: "For you" }),
  pricingAudience({ id: "a2", key: "b2b", name_pl: "Dla firm", name_en: "For business" }),
  pricingAudience({ id: "a3", key: "edu", name_pl: "Edukacja", name_en: "Education" }),
];

function renderSwitcher(value = "individual") {
  const onChange = vi.fn();
  render(
    <AudienceSwitcher
      audiences={AUDIENCES}
      value={value}
      onChange={onChange}
      lang={lang}
      label="Segmenty"
    />,
  );
  return { onChange };
}

beforeEach(() => {
  lang = "pl";
  trackCta.mockClear();
});

describe("AudienceSwitcher - lista segmentów jako tablista", () => {
  it("każdy segment jest zakładką z nazwą w języku strony", () => {
    renderSwitcher();

    expect(screen.getByRole("tab", { name: /Dla Ciebie/ })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("po angielsku pokazuje nazwy angielskie", () => {
    lang = "en";
    render(
      <AudienceSwitcher
        audiences={AUDIENCES}
        value="individual"
        onChange={vi.fn()}
        lang="en"
        label="Segments"
      />,
    );

    expect(screen.getByRole("tab", { name: /For business/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Dla firm/ })).not.toBeInTheDocument();
  });

  it("tablista ma nazwę - inaczej czytnik ogłasza bezimienną grupę przycisków", () => {
    renderSwitcher();

    expect(screen.getByRole("tablist", { name: "Segmenty" })).toBeInTheDocument();
  });

  it("WYBRANY segment jest zaznaczony i steruje swoim panelem", () => {
    renderSwitcher("b2b");

    const active = screen.getByRole("tab", { name: /Dla firm/ });
    expect(active).toHaveAttribute("aria-selected", "true");
    expect(active).toHaveAttribute("aria-controls", expect.stringContaining("b2b"));
  });

  it("tylko wybrana zakładka jest w kolejności tabulacji (roving tabindex)", () => {
    renderSwitcher("b2b");

    expect(screen.getByRole("tab", { name: /Dla firm/ })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: /Dla Ciebie/ })).toHaveAttribute("tabindex", "-1");
  });

  it("kliknięcie zgłasza klucz segmentu", () => {
    const { onChange } = renderSwitcher();

    fireEvent.click(screen.getByRole("tab", { name: /Edukacja/ }));

    expect(onChange).toHaveBeenCalledWith("edu");
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("AudienceSwitcher - nawigacja KLAWIATURĄ", () => {
  // Bez tego połowa oferty jest nieosiągalna dla osoby, która nie używa myszki.
  it("strzałka w prawo przechodzi do NASTĘPNEGO segmentu", () => {
    const { onChange } = renderSwitcher("individual");

    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });

    expect(onChange).toHaveBeenCalledWith("b2b");
  });

  it("strzałka w lewo przechodzi do POPRZEDNIEGO", () => {
    const { onChange } = renderSwitcher("b2b");

    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" });

    expect(onChange).toHaveBeenCalledWith("individual");
  });

  it("strzałki w dół i w górę działają jak prawo i lewo", () => {
    const { onChange } = renderSwitcher("individual");

    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalledWith("b2b");

    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledWith("edu");
  });

  it("lista ZAWIJA się z ostatniego na pierwszy", () => {
    const { onChange } = renderSwitcher("edu");

    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });

    expect(onChange).toHaveBeenCalledWith("individual");
  });

  it("lista zawija się z pierwszego na ostatni", () => {
    const { onChange } = renderSwitcher("individual");

    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" });

    expect(onChange).toHaveBeenCalledWith("edu");
  });

  it("Home i End skaczą na koniec listy", () => {
    const { onChange } = renderSwitcher("b2b");

    fireEvent.keyDown(screen.getByRole("tablist"), { key: "Home" });
    expect(onChange).toHaveBeenCalledWith("individual");

    fireEvent.keyDown(screen.getByRole("tablist"), { key: "End" });
    expect(onChange).toHaveBeenCalledWith("edu");
  });

  it("inne klawisze nie zmieniają segmentu", () => {
    const { onChange } = renderSwitcher();

    fireEvent.keyDown(screen.getByRole("tablist"), { key: "a" });
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("NIEZNANY segment w propsie nie wywraca nawigacji", () => {
    // Deep-link `?audience=skasowany` nie może zablokować klawiatury.
    const { onChange } = renderSwitcher("skasowany");

    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });
});

describe("IntervalToggle - cykl rozliczenia i realna oszczędność", () => {
  function renderToggle(overrides: Partial<Parameters<typeof IntervalToggle>[0]> = {}): {
    onChange: ReturnType<typeof vi.fn>;
  } {
    const onChange = vi.fn();
    render(<IntervalToggle value="month" onChange={onChange} savingsPct={null} {...overrides} />);
    return { onChange };
  }

  it("domyślnie pokazuje miesięcznie i rocznie", () => {
    renderToggle();

    expect(screen.getByText("pricing.intervalMonthly")).toBeInTheDocument();
    expect(screen.getByText("pricing.intervalYearly")).toBeInTheDocument();
  });

  it("grupa ma nazwę dla czytnika", () => {
    renderToggle();

    expect(screen.getByRole("group", { name: "pricing.intervalAria" })).toBeInTheDocument();
  });

  it("wybrany cykl jest oznaczony jako wciśnięty", () => {
    renderToggle({ value: "year" });

    const yearly = screen.getByRole("button", { name: /intervalYearly/ });
    expect(yearly).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /intervalMonthly/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("oferta biznesowa pokazuje SWOJE cykle, nie domyślne", () => {
    renderToggle({ options: ["two_weeks", "month", "quarter"] });

    expect(screen.getByText("pricing.intervalTwoWeeks")).toBeInTheDocument();
    expect(screen.getByText("pricing.intervalQuarterly")).toBeInTheDocument();
    expect(screen.queryByText("pricing.intervalYearly")).not.toBeInTheDocument();
  });

  it("badge oszczędności stoi WYŁĄCZNIE przy cyklu rocznym", () => {
    renderToggle({ savingsPct: 17 });

    const yearly = screen.getByRole("button", { name: /intervalYearly/ });
    expect(yearly).toHaveTextContent('"pct":17');
    expect(screen.getByRole("button", { name: /intervalMonthly/ })).not.toHaveTextContent("pct");
  });

  it("BEZ wyliczonej oszczędności badge nie pokazuje się wcale", () => {
    // Wymyślona wartość byłaby obietnicą bez pokrycia w planach.
    renderToggle({ savingsPct: null });

    expect(screen.queryByText(/saveUpTo/)).not.toBeInTheDocument();
  });

  it("zmiana cyklu zgłasza wybór i zdarzenie z poprzednią wartością", () => {
    const { onChange } = renderToggle({ value: "month" });

    fireEvent.click(screen.getByRole("button", { name: /intervalYearly/ }));

    expect(onChange).toHaveBeenCalledWith("year");
    expect(trackCta).toHaveBeenCalledWith("pricing_interval_change", {
      interval: "year",
      previous: "month",
    });
  });

  it("kliknięcie AKTYWNEGO cyklu nie zgłasza zdarzenia analitycznego", () => {
    // Inaczej raport liczyłby zmiany, których nie było.
    const { onChange } = renderToggle({ value: "month" });

    fireEvent.click(screen.getByRole("button", { name: /intervalMonthly/ }));

    expect(trackCta).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith("month");
  });
});
