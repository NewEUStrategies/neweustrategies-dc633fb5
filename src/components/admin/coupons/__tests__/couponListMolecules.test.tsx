// Molekuły listy kuponów B2B: pasek narzędzi, pasek kafli, komórka kodu
// i akcje wiersza.
//
// CO TEN PLIK DOWODZI.
//   1. PASEK NARZĘDZI ODDAJE WYBÓR, A NIE PRZEFILTROWANĄ LISTĘ. Cztery wartości
//      filtra istnieją w DOM-ie i każda dochodzi do wołającego dokładnie raz -
//      dzięki temu definicja „wygasłego” mieszka w jednym module reguł,
//      a nie drugi raz w widoku.
//   2. KOPIOWANIE KODU JEST ZDARZENIEM, NIE EFEKTEM UBOCZNYM MOLEKUŁY: komórka
//      nie zna ani schowka, ani toastów, więc decyzję „czy meldować sukces”
//      podejmuje organizm (i dziś podejmuje ją źle - dowód w teście organizmu).
//   3. AKCJE WIERSZA NIE MAJĄ WŁASNEGO STANU. Przełącznik jest sterowany
//      wierszem, więc po odmowie zapisu wraca na swoje miejsce sam. Cena jest
//      taka, że NIC nie blokuje drugiego kliknięcia - dwa kliknięcia zgłaszają
//      dwa identyczne żądania. To jest zgłoszone parą `it.fails` + `it`.
//   4. PASEK KAFLI NICZEGO NIE LICZY - pokazuje liczby podane przez wołającego.
//      Kafel, który liczy sam, rozjeżdża się z listą (i tak było przed
//      ekstrakcją).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł filtrowania i liczenia -
// `lib/billing/__tests__/couponAdminList.test.ts`. (2) Atomów (kafel,
// plakietki) - `couponAtoms.test.tsx`. (3) Sklejenia z Supabase - to test trasy.
//
// Radix `Select` i `Switch` są podmienione na natywne odpowiedniki: pod
// happy-dom nie ma pełnego API wskaźnika, więc bez atrapy żadna opcja nie
// trafiłaby do DOM-u, a przełącznik nie oddałby zdarzenia.
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
// Prawdziwa nakładka robi `addResourceBundle` przy imporcie i wciąga CAŁY
// i18next aplikacji - atrapa zostawia sam kontrakt „loader jest wołany".
vi.mock("@/lib/i18n-admin-coupons", () => ({ ensureI18n: () => undefined }));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    children?: ReactNode;
  }) => (
    <select
      aria-label="filtr-statusu"
      value={value}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    "aria-label": ariaLabel,
  }: {
    checked: boolean;
    onCheckedChange: (v: boolean) => void;
    "aria-label"?: string;
  }) => (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      onChange={() => onCheckedChange(!checked)}
    />
  ),
}));

import { CouponCodeCell } from "../molecules/CouponCodeCell";
import { CouponListToolbar } from "../molecules/CouponListToolbar";
import { CouponRowActions } from "../molecules/CouponRowActions";
import { CouponStatsRow } from "../molecules/CouponStatsRow";

describe("pasek narzędzi listy", () => {
  it("wpisana fraza wychodzi do wołającego znak po znaku, bez własnego stanu", () => {
    const onSearch = vi.fn();
    render(<CouponListToolbar search="" onSearch={onSearch} status="all" onStatus={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("adminCoupons.searchCodeName"), {
      target: { value: "vip" },
    });
    expect(onSearch).toHaveBeenCalledWith("vip");
  });

  it("cztery wartości filtra są dostępne do wyboru - żadna nie jest ukryta", () => {
    render(<CouponListToolbar search="" onSearch={vi.fn()} status="all" onStatus={vi.fn()} />);
    const opcje = screen.getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(opcje).toEqual(["all", "active", "inactive", "expired"]);
  });

  it.each(["active", "inactive", "expired"] as const)(
    "wybór filtra %s dochodzi do wołającego jako wartość, nie jako etykieta",
    (wartosc) => {
      const onStatus = vi.fn();
      render(<CouponListToolbar search="" onSearch={vi.fn()} status="all" onStatus={onStatus} />);
      fireEvent.change(screen.getByLabelText("filtr-statusu"), { target: { value: wartosc } });
      expect(onStatus).toHaveBeenCalledWith(wartosc);
    },
  );

  it("miejsce na przycisk otwierający dialog jest częścią paska, nie tabeli", () => {
    render(
      <CouponListToolbar search="" onSearch={vi.fn()} status="all" onStatus={vi.fn()}>
        <button type="button">Nowy kupon</button>
      </CouponListToolbar>,
    );
    expect(screen.getByRole("button", { name: "Nowy kupon" })).toBeInTheDocument();
  });
});

describe("pasek kafli", () => {
  it("kafle pokazują liczby PODANE przez wołającego - molekuła niczego nie liczy", () => {
    render(<CouponStatsRow stats={{ total: 12, active: 7, redemptions: 143, expired: 3 }} />);
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("143")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("kafle są opisane kluczami słownika panelu, nie napisami zaszytymi w kodzie", () => {
    render(<CouponStatsRow stats={{ total: 0, active: 0, redemptions: 0, expired: 0 }} />);
    expect(screen.getByText("adminCoupons.total")).toBeInTheDocument();
    expect(screen.getByText("adminCoupons.totalRedemptions")).toBeInTheDocument();
    expect(screen.getByText("adminCoupons.expired")).toBeInTheDocument();
  });
});

describe("komórka kodu kuponu", () => {
  it("kliknięcie ikony kopiowania oddaje KOD, a nie zdarzenie DOM", () => {
    const onCopy = vi.fn();
    render(
      <CouponCodeCell
        code="NES-B2B-10"
        name={null}
        hasCampaign={false}
        copyLabel="Kopiuj"
        campaignLabel="kampania"
        onCopy={onCopy}
      />,
    );
    fireEvent.click(screen.getByLabelText("Kopiuj"));
    expect(onCopy).toHaveBeenCalledWith("NES-B2B-10");
  });

  it("molekuła NIE dotyka schowka ani toastów - nie zna tych warstw", () => {
    const onCopy = vi.fn();
    render(
      <CouponCodeCell
        code="X"
        name={null}
        hasCampaign={false}
        copyLabel="Kopiuj"
        campaignLabel="kampania"
        onCopy={onCopy}
      />,
    );
    fireEvent.click(screen.getByLabelText("Kopiuj"));
    // Jedyny skutek uboczny to wywołanie propu - stąd wiadomo, że decyzja
    // o komunikacie należy do organizmu.
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it("kupon z kampanii dostaje znacznik powiązania; samodzielny go nie ma", () => {
    const { rerender } = render(
      <CouponCodeCell
        code="X"
        name={null}
        hasCampaign
        copyLabel="Kopiuj"
        campaignLabel="kampania"
        onCopy={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("kampania")).toBeInTheDocument();
    rerender(
      <CouponCodeCell
        code="X"
        name={null}
        hasCampaign={false}
        copyLabel="Kopiuj"
        campaignLabel="kampania"
        onCopy={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("kampania")).toBeNull();
  });

  it("nazwa wewnętrzna pojawia się pod kodem tylko wtedy, gdy istnieje", () => {
    const { rerender, container } = render(
      <CouponCodeCell
        code="X"
        name="Kampania VIP"
        hasCampaign={false}
        copyLabel="Kopiuj"
        campaignLabel="kampania"
        onCopy={vi.fn()}
      />,
    );
    expect(screen.getByText("Kampania VIP")).toBeInTheDocument();
    rerender(
      <CouponCodeCell
        code="X"
        name=""
        hasCampaign={false}
        copyLabel="Kopiuj"
        campaignLabel="kampania"
        onCopy={vi.fn()}
      />,
    );
    expect(container.textContent).toBe("X");
  });
});

describe("akcje wiersza", () => {
  it("przełącznik pokazuje stan Z WIERSZA, a kliknięcie zgłasza zamiar, nie zmianę", () => {
    const onToggle = vi.fn();
    render(
      <CouponRowActions
        active
        toggleLabel="toggle-active"
        deleteLabel="delete"
        onToggle={onToggle}
        onDelete={vi.fn()}
      />,
    );
    const przelacznik = screen.getByLabelText("toggle-active");
    expect((przelacznik as HTMLInputElement).checked).toBe(true);
    fireEvent.click(przelacznik);
    expect(onToggle).toHaveBeenCalledTimes(1);
    // Molekuła nie ma stanu, więc bez odświeżenia danych nic się nie zmienia.
    expect((screen.getByLabelText("toggle-active") as HTMLInputElement).checked).toBe(true);
  });

  it("usunięcie zgłasza się osobnym zdarzeniem - potwierdzenie należy do organizmu", () => {
    const onDelete = vi.fn();
    render(
      <CouponRowActions
        active
        toggleLabel="toggle-active"
        deleteLabel="delete"
        onToggle={vi.fn()}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByLabelText("delete"));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it.fails("drugie kliknięcie w trakcie zapisu NIE powinno wysyłać drugiego żądania", () => {
    const onToggle = vi.fn();
    render(
      <CouponRowActions
        active
        toggleLabel="toggle-active"
        deleteLabel="delete"
        onToggle={onToggle}
        onDelete={vi.fn()}
      />,
    );
    const przelacznik = screen.getByLabelText("toggle-active");
    fireEvent.click(przelacznik);
    fireEvent.click(przelacznik);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("STAN FAKTYCZNY: dwa szybkie kliknięcia zgłaszają DWA identyczne zamiary", () => {
    // Para do usunięcia RAZEM po naprawie (brak `disabled` na czas zapisu).
    const onToggle = vi.fn();
    render(
      <CouponRowActions
        active
        toggleLabel="toggle-active"
        deleteLabel="delete"
        onToggle={onToggle}
        onDelete={vi.fn()}
      />,
    );
    const przelacznik = screen.getByLabelText("toggle-active");
    fireEvent.click(przelacznik);
    fireEvent.click(przelacznik);
    expect(onToggle).toHaveBeenCalledTimes(2);
  });
});
