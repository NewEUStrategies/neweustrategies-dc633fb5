// Wspolne pole daty (Popover + Calendar) - kupony, analityka kuponow i CRM.
//
// PO CO TEN PLIK ISTNIEJE. Dialogi kuponu i kampanii sprawdzaja to pole tylko
// „przy okazji" (wybor dnia daje ISO). Tymczasem z tego samego komponentu
// korzysta CRM w trybie `withTime` (termin follow-upu z godzina) i tam leza
// najdrozsze pomylki:
//   1. ZMIANA DNIA NIE MOZE ZGUBIC GODZINY. Follow-up ustawiony na 14:30,
//      przeniesiony na inny dzien, nie moze po cichu spasc na polnoc - wtedy
//      przypomnienie przychodzi w nocy, a w kolejce zadan wyglada na zalegle.
//   2. ZMIANA GODZINY NIE MOZE ZMIENIC DNIA ani zmutowac obiektu `Date`
//      trzymanego w stanie rodzica (React nie zauwazylby zmiany).
//   3. NIEPELNA GODZINA Z POLA NIE MOZE DAC `Invalid Date`. Wyczyszczone pole
//      czasu oddaje pusty napis; `setHours(NaN)` zamienia termin w smiec,
//      ktory potem leci do bazy.
//   4. JEZYK INTERFEJSU decyduje o formacie daty, podpowiedzi i etykiecie
//      godziny - pole ma wygladac tak samo jak reszta panelu.
//
// GRANICE vs SASIEDZI. Prymitywy `@/components/ui/*` (Popover, Calendar,
// Button) biegna PRAWDZIWE - tak jak w dialogach kuponow. Atrapowane jest
// wylacznie i18n (jezyk przelaczany per przypadek) oraz ZEGAR: kalendarz
// otwiera sie na biezacym miesiacu, a tryb `withTime` bez wartosci bierze
// godzine z `new Date()` - bez zamrozenia daty test zalezalby od dnia
// uruchomienia. Zamrazamy WYLACZNIE `Date`, nie timery, zeby nie blokowac
// animacji i fokusu Radiksa.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

const h = vi.hoisted(() => ({ lang: "pl" }));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

import { DatePickerField } from "../DatePickerField";

/** „Teraz" calego pliku: 10 marca 2026, 11:45 czasu lokalnego. */
const TERAZ = new Date(2026, 2, 10, 11, 45, 0, 0);
/** Wartosc z godzina - typowy termin follow-upu w CRM. */
const TERMIN = () => new Date(2026, 2, 15, 14, 30, 0, 0);

type Props = Parameters<typeof DatePickerField>[0];

/**
 * Pole sterowane jak u wywolujacych (`useState` + `onChange`). Dzieki temu
 * widac pelna petle: wybor w kalendarzu -> stan rodzica -> tekst przycisku.
 */
function Sterowane({
  poczatkowa,
  onChange,
  ...rest
}: Omit<Props, "value" | "onChange"> & {
  poczatkowa?: Date;
  onChange: (d: Date | undefined) => void;
}) {
  const [value, setValue] = useState<Date | undefined>(poczatkowa);
  return (
    <DatePickerField
      {...rest}
      value={value}
      onChange={(d) => {
        onChange(d);
        setValue(d);
      }}
    />
  );
}

function wyzwalacz(container: HTMLElement): HTMLButtonElement {
  const btn = container.querySelector("button");
  if (!btn) throw new Error("brak przycisku pola daty");
  return btn;
}

/** Otwiera popover i klika dzien miesiaca (przycisk WEWNATRZ komorki siatki). */
async function wybierzDzien(container: HTMLElement, dzien: string): Promise<void> {
  fireEvent.click(wyzwalacz(container));
  const komorka = await screen.findByRole("gridcell", { name: dzien });
  fireEvent.click(komorka.querySelector("button") ?? komorka);
}

async function poleGodziny(container: HTMLElement): Promise<HTMLInputElement> {
  fireEvent.click(wyzwalacz(container));
  await screen.findByRole("grid");
  const input = document.querySelector<HTMLInputElement>('input[type="time"]');
  if (!input) throw new Error("brak pola godziny");
  return input;
}

/** Ostatnia wartosc oddana przez `onChange`. */
function ostatnia(spy: ReturnType<typeof vi.fn>): Date | undefined {
  return spy.mock.calls.at(-1)?.[0] as Date | undefined;
}

beforeEach(() => {
  h.lang = "pl";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TERAZ);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DatePickerField - przycisk i jezyk interfejsu", () => {
  it("BEZ wartosci pokazuje polska podpowiedz i wyszarzony tekst", () => {
    const { container } = render(<DatePickerField value={undefined} onChange={vi.fn()} />);
    const btn = wyzwalacz(container);
    expect(btn).toHaveTextContent("Wybierz datę");
    expect(btn.className).toContain("text-muted-foreground");
  });

  it("w interfejsie ANGIELSKIM podpowiedz jest po angielsku", () => {
    h.lang = "en";
    const { container } = render(<DatePickerField value={undefined} onChange={vi.fn()} />);
    expect(wyzwalacz(container)).toHaveTextContent("Pick a date");
  });

  it("WLASNA podpowiedz wywolujacego wygrywa z domyslna", () => {
    const { container } = render(
      <DatePickerField value={undefined} onChange={vi.fn()} placeholder="Od kiedy?" />,
    );
    expect(wyzwalacz(container)).toHaveTextContent("Od kiedy?");
    expect(wyzwalacz(container)).not.toHaveTextContent("Wybierz datę");
  });

  it("etykieta pola renderuje sie tylko, gdy ja podano", () => {
    const { rerender } = render(<DatePickerField value={undefined} onChange={vi.fn()} />);
    expect(screen.queryByText("Wazny do")).toBeNull();
    rerender(<DatePickerField value={undefined} onChange={vi.fn()} label="Wazny do" />);
    expect(screen.getByText("Wazny do")).toBeInTheDocument();
  });

  it("wybrana data jest sformatowana PO POLSKU i nie jest juz wyszarzona", () => {
    const { container } = render(
      <DatePickerField value={new Date(2026, 2, 15)} onChange={vi.fn()} />,
    );
    const btn = wyzwalacz(container);
    expect(btn).toHaveTextContent("15 marca 2026");
    expect(btn.className).not.toContain("text-muted-foreground");
  });

  it("wybrana data w interfejsie angielskim idzie formatem angielskim", () => {
    h.lang = "en";
    const { container } = render(
      <DatePickerField value={new Date(2026, 2, 15)} onChange={vi.fn()} />,
    );
    expect(wyzwalacz(container)).toHaveTextContent("March 15th, 2026");
  });

  it("tryb `withTime` dokleja GODZINE do daty na przycisku", () => {
    // Bez godziny na przycisku termin 14:30 i termin 09:00 wygladaja w panelu
    // CRM identycznie.
    const { container } = render(<DatePickerField value={TERMIN()} onChange={vi.fn()} withTime />);
    expect(wyzwalacz(container)).toHaveTextContent("15 marca 2026 14:30");
  });

  it("rozmiar `sm` daje kompaktowy przycisk, domyslny - pelna wysokosc", () => {
    const { container, rerender } = render(
      <DatePickerField value={undefined} onChange={vi.fn()} size="sm" />,
    );
    expect(wyzwalacz(container).className).toContain("h-8");
    expect(wyzwalacz(container).className).not.toContain("h-10");
    rerender(<DatePickerField value={undefined} onChange={vi.fn()} />);
    expect(wyzwalacz(container).className).toContain("h-10");
  });

  it("pole WYLACZONE nie otwiera kalendarza", () => {
    const { container } = render(<DatePickerField value={undefined} onChange={vi.fn()} disabled />);
    expect(wyzwalacz(container)).toBeDisabled();
    fireEvent.click(wyzwalacz(container));
    expect(screen.queryByRole("grid")).toBeNull();
  });
});

describe("DatePickerField - wybor dnia", () => {
  it("BEZ `withTime` wybrany dzien oddaje sie o polnocy i trafia na przycisk", async () => {
    const onChange = vi.fn();
    const { container } = render(<Sterowane onChange={onChange} />);
    await wybierzDzien(container, "20");
    const d = ostatnia(onChange);
    expect(d).toBeInstanceOf(Date);
    expect([d?.getFullYear(), d?.getMonth(), d?.getDate()]).toEqual([2026, 2, 20]);
    expect([d?.getHours(), d?.getMinutes()]).toEqual([0, 0]);
    expect(wyzwalacz(container)).toHaveTextContent("20 marca 2026");
  });

  it("klikniecie JUZ wybranego dnia czysci pole (oddaje `undefined`)", async () => {
    // To jedyna droga wyczyszczenia daty z poziomu kalendarza - filtr
    // „Od/Do" analityki kuponow wraca wtedy do pelnego zakresu.
    const onChange = vi.fn();
    const { container } = render(
      <Sterowane onChange={onChange} poczatkowa={new Date(2026, 2, 15)} />,
    );
    await wybierzDzien(container, "15");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(wyzwalacz(container)).toHaveTextContent("Wybierz datę");
  });

  it("`withTime`: zmiana DNIA zachowuje GODZINE z biezacej wartosci", async () => {
    const onChange = vi.fn();
    const { container } = render(<Sterowane onChange={onChange} poczatkowa={TERMIN()} withTime />);
    await wybierzDzien(container, "20");
    const d = ostatnia(onChange);
    expect([d?.getMonth(), d?.getDate()]).toEqual([2, 20]);
    expect([d?.getHours(), d?.getMinutes(), d?.getSeconds(), d?.getMilliseconds()]).toEqual([
      14, 30, 0, 0,
    ]);
    expect(wyzwalacz(container)).toHaveTextContent("20 marca 2026 14:30");
  });

  it("`withTime` BEZ wartosci: wybrany dzien dostaje BIEZACA godzine", async () => {
    // Nowy follow-up bez godziny dostaje „teraz", a nie polnoc - polnoc
    // oznaczylaby zadanie jako zalegle juz w chwili zapisu.
    const onChange = vi.fn();
    const { container } = render(<Sterowane onChange={onChange} withTime />);
    await wybierzDzien(container, "20");
    const d = ostatnia(onChange);
    expect([d?.getDate(), d?.getHours(), d?.getMinutes(), d?.getSeconds()]).toEqual([
      20, 11, 45, 0,
    ]);
  });
});

describe("DatePickerField - pole godziny (`withTime`)", () => {
  it("pole godziny istnieje TYLKO w trybie `withTime`", async () => {
    const { container } = render(<DatePickerField value={undefined} onChange={vi.fn()} />);
    fireEvent.click(wyzwalacz(container));
    await screen.findByRole("grid");
    expect(document.querySelector('input[type="time"]')).toBeNull();
    expect(screen.queryByText("Godzina")).toBeNull();
  });

  it("bez wartosci podpowiada 09:00, z wartoscia - jej godzine", async () => {
    const pusty = render(<DatePickerField value={undefined} onChange={vi.fn()} withTime />);
    expect(await poleGodziny(pusty.container)).toHaveValue("09:00");
    pusty.unmount();

    const pelny = render(<DatePickerField value={TERMIN()} onChange={vi.fn()} withTime />);
    expect(await poleGodziny(pelny.container)).toHaveValue("14:30");
  });

  it("etykieta godziny idzie za jezykiem interfejsu", async () => {
    const pl = render(<DatePickerField value={undefined} onChange={vi.fn()} withTime />);
    await poleGodziny(pl.container);
    expect(screen.getByText("Godzina")).toBeInTheDocument();
    pl.unmount();

    h.lang = "en";
    const en = render(<DatePickerField value={undefined} onChange={vi.fn()} withTime />);
    await poleGodziny(en.container);
    expect(screen.getByText("Time")).toBeInTheDocument();
    expect(screen.queryByText("Godzina")).toBeNull();
  });

  it("zmiana godziny zostawia DZIEN i NIE mutuje obiektu z propsa", async () => {
    // Rodzic trzyma `Date` w stanie. Mutacja w miejscu zmienilaby wartosc
    // bez nowej referencji - React nie przerysowalby niczego, a stara
    // referencja niosla by juz nowa godzine.
    const onChange = vi.fn();
    const wartosc = TERMIN();
    const { container } = render(<DatePickerField value={wartosc} onChange={onChange} withTime />);
    fireEvent.change(await poleGodziny(container), { target: { value: "16:05" } });
    const d = ostatnia(onChange);
    expect(d).not.toBe(wartosc);
    expect([d?.getFullYear(), d?.getMonth(), d?.getDate()]).toEqual([2026, 2, 15]);
    expect([d?.getHours(), d?.getMinutes(), d?.getSeconds(), d?.getMilliseconds()]).toEqual([
      16, 5, 0, 0,
    ]);
    expect([wartosc.getHours(), wartosc.getMinutes()]).toEqual([14, 30]);
  });

  it("godzina wpisana PRZED wyborem dnia laduje na DZISIAJ", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <DatePickerField value={undefined} onChange={onChange} withTime />,
    );
    fireEvent.change(await poleGodziny(container), { target: { value: "08:15" } });
    const d = ostatnia(onChange);
    expect([d?.getFullYear(), d?.getMonth(), d?.getDate()]).toEqual([2026, 2, 10]);
    expect([d?.getHours(), d?.getMinutes()]).toEqual([8, 15]);
  });

  it("WYCZYSZCZONE pole godziny nie oddaje `Invalid Date` - wartosc zostaje", async () => {
    const onChange = vi.fn();
    const { container } = render(<DatePickerField value={TERMIN()} onChange={onChange} withTime />);
    fireEvent.change(await poleGodziny(container), { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(wyzwalacz(container)).toHaveTextContent("15 marca 2026 14:30");
  });
});
