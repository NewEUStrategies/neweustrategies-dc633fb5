// TRZY STANY ODCZYTU, KTÓRYCH NIE WOLNO MYLIĆ - następca asercji ze starego
// `platformDashboardRoute.test.tsx`.
//
// Tamten plik pilnował na czterech licznikach treści jednej rzeczy: NIEUDANY
// ODCZYT NIE MOŻE WYGLĄDAĆ JAK ZMIERZONE ZERO, i musi dać się ponowić. Liczniki
// przeniosły się do funkcji agregującej w bazie, ale inwariant jest ten sam
// i mieszka teraz w powłoce sekcji - więc test przenosi się razem z nim.
//
// Pulpit ma tu o jeden stan więcej niż poprzednik: "źródła jeszcze nie ma"
// (migracja w drodze). Zera w tym miejscu wysłałyby operatora szukać awarii
// ruchu tam, gdzie nie ma pomiaru - to inna decyzja niż "sprawdź połączenie".
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

import { DashboardSection } from "../DashboardSection";

afterEach(cleanup);

const LICZBA = "1234";

describe("DashboardSection - stan odczytu", () => {
  it("w trakcie ładowania nie pokazuje ŻADNEJ liczby", () => {
    render(
      <DashboardSection title="Ruch" isPending>
        <p>{LICZBA}</p>
      </DashboardSection>,
    );
    expect(screen.getByRole("status").textContent).toContain("adminDashboard.state.loading");
    // Sedno: treść sekcji nie jest renderowana, więc nie ma jak mignąć starą
    // albo pustą wartością.
    expect(screen.queryByText(LICZBA)).toBeNull();
  });

  it("awaria odczytu daje alert i NIE podstawia zera", () => {
    render(
      <DashboardSection title="Ruch" isError>
        <p>{LICZBA}</p>
      </DashboardSection>,
    );
    expect(screen.getByRole("alert").textContent).toContain("adminDashboard.state.error");
    expect(screen.queryByText(LICZBA)).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("awarię da się ponowić", () => {
    const onRetry = vi.fn();
    render(<DashboardSection title="Ruch" isError onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "adminDashboard.state.retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("bez `onRetry` nie obiecuje ponowienia przyciskiem, który nic nie robi", () => {
    render(<DashboardSection title="Ruch" isError />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("brak źródła to NIE awaria - status, nie alert, i treść zostaje", () => {
    render(
      <DashboardSection title="Ruch" unavailable>
        <p>{LICZBA}</p>
      </DashboardSection>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("adminDashboard.state.sourceMissing");
    expect(screen.getByText(LICZBA)).toBeTruthy();
  });

  it("odczyt udany pokazuje treść i żadnego komunikatu stanu", () => {
    render(
      <DashboardSection title="Ruch">
        <p>{LICZBA}</p>
      </DashboardSection>,
    );
    expect(screen.getByText(LICZBA)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("DashboardSection - nagłówek", () => {
  it("prowadzi do zakładki-matki, gdy podano odnośnik", () => {
    render(
      <DashboardSection title="CRM" to="/admin/crm" linkLabel="otwórz">
        <p>x</p>
      </DashboardSection>,
    );
    expect(screen.getByRole("link", { name: /otwórz/ }).getAttribute("href")).toBe("/admin/crm");
  });

  it("bez tytułu i bez odnośnika NIE renderuje pustego nagłówka", () => {
    // Sekcja bywa osadzona pod cudzym nagłówkiem (zwijany panel na /admin/crm);
    // pusty `<h2>` dokładałby czytnikowi ekranu bezimienny poziom w konspekcie.
    render(
      <DashboardSection>
        <p>x</p>
      </DashboardSection>,
    );
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("oznacza sekcję jako zajętą tylko w trakcie odczytu", () => {
    const { container, rerender } = render(
      <DashboardSection title="Ruch" isPending>
        <p>x</p>
      </DashboardSection>,
    );
    expect(container.querySelector("section")?.getAttribute("aria-busy")).toBe("true");
    rerender(
      <DashboardSection title="Ruch">
        <p>x</p>
      </DashboardSection>,
    );
    expect(container.querySelector("section")?.getAttribute("aria-busy")).toBeNull();
  });
});
