// Molekuła wiersza przełącznika rodzaju powiadomień - 0% pokrycia przed tym
// plikiem (0/2 linii, 0/1 funkcji).
//
// PO CO TEN PLIK. Ten sam wiersz renderuje się w ustawieniach szesnaście razy
// PLUS raz w wariancie `alwaysOn` dla alertów bezpieczeństwa, a różnica między
// tymi dwoma wariantami nie jest kosmetyczna - to KONTRAKT:
//
//   * wariant zwykły MUSI wiązać etykietę z przełącznikiem (`htmlFor` <-> `id`),
//     bo bez tego kliknięcie etykiety i odczyt czytnikiem ekranu trafiają
//     w próżnię przy każdym z szesnastu wierszy naraz;
//   * wariant `alwaysOn` MUSI być nieinteraktywny i NIE MOŻE wskazywać
//     etykietą na element, którego nie da się użyć - „rodzaj docierający
//     zawsze" to obietnica produktowa (baza omija dla `security` bramkę
//     preferencji), więc przełącznik, który da się kliknąć, kłamie
//     użytkownikowi o tym, co dostanie na skrzynkę.
//
// Defekt, przed którym broni asercja o braku `id`/`htmlFor` w wariancie
// always-on: dopisanie `id` „dla spójności" jest jednolinijkową zmianą, która
// niczego nie psuje wizualnie, a robi z etykiety wskaźnik na zablokowany
// element - czyli dokładnie ten rodzaj cichej regresji dostępności, którego
// nie widać w przeglądzie.
//
// Komponent NIE zna i18n (etykietę dostaje gotową od organizmu), więc ten plik
// świadomie nie mocuje `react-i18next`: renderujemy PRAWDZIWE `Label`
// i `Switch` z Radiksa, bo to ich sklejenie jest tu przedmiotem dowodu.
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";
import {
  NotificationKindToggle,
  type NotificationKindToggleProps,
} from "../NotificationKindToggle";

const LABEL = "Wiadomości na czacie";
const SECURITY_LABEL = "Alerty bezpieczeństwa (zawsze włączone)";

/** Wiersz w wariancie przełączalnym - domyślne wejście testów. */
function renderToggle(props: Partial<NotificationKindToggleProps> = {}): {
  onCheckedChange: ReturnType<typeof vi.fn>;
  container: HTMLElement;
} {
  const onCheckedChange = vi.fn<(checked: boolean) => void>();
  const { container } = render(
    <NotificationKindToggle
      kind="message"
      label={LABEL}
      checked={false}
      onCheckedChange={onCheckedChange}
      {...props}
    />,
  );
  return { onCheckedChange, container };
}

const switchEl = () => screen.getByRole("switch");
/** Element `<label>` wiersza - `getByText` trafiłby w tekst, nie w znacznik. */
const labelEl = (container: HTMLElement): HTMLLabelElement => {
  const found = container.querySelector("label");
  if (!found) throw new Error("test: wiersz nie wyrenderował znacznika <label>");
  return found;
};

describe("NotificationKindToggle - wariant przełączalny", () => {
  it("wiąże etykietę z przełącznikiem przez htmlFor/id wyprowadzone z rodzaju", () => {
    const { container } = renderToggle({ kind: "crm_task" });
    // Identyfikator jest FUNKCJĄ rodzaju, nie losowym napisem: dwa wiersze
    // obok siebie muszą mieć różne `id`, inaczej etykieta drugiego wskazuje
    // na przełącznik pierwszego.
    expect(switchEl()).toHaveAttribute("id", "notif-kind-crm_task");
    expect(labelEl(container)).toHaveAttribute("for", "notif-kind-crm_task");
  });

  it("klik przełącza i oddaje NOWĄ wartość, nie bieżącą", () => {
    // Radix Switch jest komponentem STEROWANYM - sam nie zmienia `checked`,
    // więc jedynym dowodem przełączenia jest argument wywołania zwrotnego.
    // Wartość odwrotna do `checked` to cały kontrakt: oddanie bieżącej
    // wartości dałoby przełącznik, który „klika się" i nic nie zapisuje.
    const off = renderToggle({ checked: false });
    fireEvent.click(switchEl());
    expect(off.onCheckedChange).toHaveBeenCalledWith(true);

    cleanup();
    const on = renderToggle({ checked: true });
    fireEvent.click(switchEl());
    expect(on.onCheckedChange).toHaveBeenCalledWith(false);
  });

  it("stan `checked` jest widoczny w aria-checked (nie tylko w klasie CSS)", () => {
    // Kolor tła przełącznika czyta wzrok; `aria-checked` czyta czytnik ekranu
    // i test. Przełącznik, który różni się WYŁĄCZNIE klasą, jest dla obu
    // pozostałych nieodróżnialny.
    renderToggle({ checked: true });
    expect(switchEl()).toHaveAttribute("aria-checked", "true");
  });

  it("`disabled` (zapis w toku) blokuje przełącznik i nie przepuszcza kliknięcia", () => {
    // Bez blokady szybkie klikanie w trakcie zapisu wysyła kolejne mutacje
    // preferencji, a ostatnia odpowiedź serwera wygrywa - użytkownik dostaje
    // stan, którego nie wybrał.
    const { onCheckedChange } = renderToggle({ disabled: true });
    expect(switchEl()).toBeDisabled();
    fireEvent.click(switchEl());
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("aria-label jest równy etykiecie widocznej", () => {
    // Nazwa dostępna MUSI pokrywać się z tekstem na ekranie - rozjazd łamie
    // sterowanie głosem („kliknij Wiadomości na czacie" nie znajduje celu).
    renderToggle();
    expect(switchEl()).toHaveAccessibleName(LABEL);
  });
});

describe("NotificationKindToggle - wariant alwaysOn", () => {
  it("przełącznik jest ZABLOKOWANY mimo przekazanego onCheckedChange", () => {
    // Kontrakt „rodzaj docierający zawsze": komponent ma być odporny na
    // wołającego, który poda wywołanie zwrotne - blokada nie może zależeć od
    // tego, czy ktoś o niej pamiętał w miejscu użycia.
    const { onCheckedChange } = renderToggle({
      kind: "security",
      label: SECURITY_LABEL,
      checked: true,
      alwaysOn: true,
    });
    expect(switchEl()).toBeDisabled();
    fireEvent.click(switchEl());
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("NIE wystawia id ani htmlFor - etykieta nie wskazuje nieinteraktywnego elementu", () => {
    const { container } = renderToggle({
      kind: "security",
      label: SECURITY_LABEL,
      checked: true,
      alwaysOn: true,
    });
    expect(switchEl()).not.toHaveAttribute("id");
    expect(labelEl(container)).not.toHaveAttribute("for");
  });

  it("ramka jest PRZERYWANA - wariant widać, zanim ktoś spróbuje kliknąć", () => {
    // Jedyny sygnał wizualny odróżniający „zawsze włączone" od „włączone
    // i przełączalne". Bez niego wiersz wygląda jak zwykły, a blokada
    // odkrywa się dopiero przy nieudanej próbie kliknięcia.
    const { container } = renderToggle({
      kind: "security",
      label: SECURITY_LABEL,
      checked: true,
      alwaysOn: true,
    });
    const row = container.firstElementChild;
    expect(row).not.toBeNull();
    expect(row?.className).toContain("border-dashed");
  });

  it("wariant przełączalny NIE ma przerywanej ramki", () => {
    const { container } = renderToggle();
    expect(container.firstElementChild?.className).not.toContain("border-dashed");
  });

  it("aria-label jest równy etykiecie także w wariancie zablokowanym", () => {
    renderToggle({
      kind: "security",
      label: SECURITY_LABEL,
      checked: true,
      alwaysOn: true,
    });
    expect(switchEl()).toHaveAccessibleName(SECURITY_LABEL);
  });
});

describe("NotificationKindToggle - dostępność", () => {
  it("wariant przełączalny nie ma naruszeń axe", async () => {
    const { container } = renderToggle();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("wariant alwaysOn nie ma naruszeń axe", async () => {
    const { container } = renderToggle({
      kind: "security",
      label: SECURITY_LABEL,
      checked: true,
      alwaysOn: true,
    });
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
