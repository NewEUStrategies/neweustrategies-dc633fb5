// @vitest-environment jsdom
//
// Osobne pole zgody na pomiar otwarć i kliknięć (I9d-Y2b) - RTL + axe.
//
// ŚRODOWISKO jsdom, nie happy-dom: test „klik w link nie przełącza pola"
// dowodzi zachowania przeglądarki - aktywacja etykiety nic nie robi, gdy celem
// kliknięcia jest treść interaktywna wewnątrz etykiety (HTML, element
// `label`). jsdom implementuje tę regułę; happy-dom przekazuje każde
// kliknięcie etykiety do kontrolki, więc mierzyłby własne uproszczenie,
// nie komponent.
//
// CO TEN PLIK DOWODZI.
//   1. Pole jest domyślnie niezaznaczone, etykieta = krótki skrót z jednego
//      źródła (PL i EN) - jednym zdaniem, bez linku.
//   2. Przełączanie (atom i tekst etykiety) przez stan hosta; `disabled`
//      blokuje zmianę.
//   3. Geometria od hosta (klasy wiersza i atomu, `id`), bez klas zależnych
//      od motywu - ten sam znacznik w jasnym i ciemnym motywie; brak naruszeń
//      axe w obu.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MeasurementConsentField } from "@/components/newsletter/MeasurementConsentField";
import type { ConsentLang } from "@/lib/newsletter/consentSegments";
import {
  measurementConsentFieldAccessibleName,
  measurementConsentSummaryPlain as measurementConsentPlain,
} from "@/lib/newsletter/measurementConsentText";
import { axeViolations, summarize } from "@/test/axe";

const ROW = "flex items-start gap-2.5 text-[12.5px] leading-relaxed";
const BOX = "mt-px h-[16px] w-[16px] shrink-0";

function Host({
  lang = "pl",
  disabled,
  onChange,
}: {
  lang?: ConsentLang;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <MeasurementConsentField
      lang={lang}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next) => {
        onChange?.(next);
        setChecked(next);
      }}
      id="nl-measurement"
      className={ROW}
      checkboxClassName={BOX}
    />
  );
}

const box = () => screen.getByRole("checkbox");

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
});

describe("MeasurementConsentField", () => {
  it("domyślnie niezaznaczone; krótka etykieta widoczna; nazwa pola nazywa zgodę", () => {
    const { container } = render(<Host />);
    expect(box()).toHaveAttribute("aria-checked", "false");
    // Widoczna etykieta jest jednym zdaniem (bez linku), więc nazwa dostępna
    // pola musi sama mówić, czego dokładnie dotyczy zgoda.
    expect(box()).toHaveAccessibleName(measurementConsentFieldAccessibleName("pl"));
    expect(container.querySelector("label")?.textContent).toBe(measurementConsentPlain("pl"));
    const label = container.querySelector("label");
    expect(label).toHaveAttribute("data-consent", "email_measurement");
    expect(label).not.toHaveAttribute("data-disabled");
    // Skrót nie niesie linku - „szczegóły" z odnośnikiem do polityki
    // komunikacji są w pełnej treści na stronie potwierdzenia.
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("EN: treść w języku formularza, bez linku w skrócie", () => {
    const { container } = render(<Host lang="en" />);
    expect(box()).toHaveAccessibleName(measurementConsentFieldAccessibleName("en"));
    expect(container.querySelector("label")?.textContent).toBe(measurementConsentPlain("en"));
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("przełącza atomem i tekstem etykiety (stan hosta)", () => {
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);
    fireEvent.click(box());
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(box()).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByText(/^Zgoda na pomiar interakcji/));
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(box()).toHaveAttribute("aria-checked", "false");
  });


  it("disabled: wyszarzone, nieklikalne, atom wyłączony", () => {
    const onChange = vi.fn();
    const { container } = render(<Host disabled onChange={onChange} />);
    expect(box()).toBeDisabled();
    fireEvent.click(box());
    fireEvent.click(screen.getByText(/^Zgoda na pomiar interakcji/));
    expect(onChange).not.toHaveBeenCalled();
    expect(box()).toHaveAttribute("aria-checked", "false");
    const label = container.querySelector("label");
    expect(label).toHaveAttribute("data-disabled", "");
    expect(label?.className).toContain("cursor-not-allowed");
    expect(label?.className).not.toContain("cursor-pointer");
  });

  it("geometria od hosta: klasy wiersza i atomu, id atomu", () => {
    const { container } = render(<Host />);
    const label = container.querySelector("label");
    for (const cls of ROW.split(" ")) expect(label?.classList.contains(cls)).toBe(true);
    expect(label?.className).toContain("cursor-pointer");
    for (const cls of BOX.split(" ")) expect(box().classList.contains(cls)).toBe(true);
    expect(box()).toHaveAttribute("id", "nl-measurement");
  });

  it("styl i znacznik edycji wiersza od hosta (rozmiar `consentSize` widżetu)", () => {
    const { container } = render(
      <MeasurementConsentField
        lang="pl"
        checked={false}
        onCheckedChange={() => {}}
        className={ROW}
        style={{ fontSize: "13px" }}
        editTarget="consentSize"
      />,
    );
    const label = container.querySelector("label");
    expect(label?.style.fontSize).toBe("13px");
    expect(label).toHaveAttribute("data-edit-target", "consentSize");
    // Bez tych właściwości wiersz nie ma ani stylu, ani znacznika.
    cleanup();
    const plain = render(<Host />);
    expect(plain.container.querySelector("label")?.getAttribute("style")).toBeNull();
    expect(plain.container.querySelector("label")).not.toHaveAttribute("data-edit-target");
  });

  it("jasny i ciemny motyw: ten sam znacznik, bez naruszeń axe", async () => {
    const light = render(<Host />);
    const lightHtml = light.container.innerHTML;
    const lightViolations = await axeViolations(light.container);
    expect(lightViolations, summarize(lightViolations)).toEqual([]);
    cleanup();

    document.documentElement.classList.add("dark");
    const dark = render(<Host />);
    expect(dark.container.innerHTML).toBe(lightHtml);
    const darkViolations = await axeViolations(dark.container);
    expect(darkViolations, summarize(darkViolations)).toEqual([]);
  });

  it("axe: zaznaczone i wyłączone pole", async () => {
    const { container } = render(
      <>
        <Host />
        <MeasurementConsentField
          lang="en"
          checked
          disabled
          onCheckedChange={() => {}}
          className={ROW}
        />
      </>,
    );
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
