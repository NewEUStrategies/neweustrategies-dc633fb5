// ATOM: co pokazać w miejscu listy, gdy pozycje SĄ, ale nie dały się wczytać.
//
// CO TEN PLIK DOWODZI. Panele `/profile/bookmarks` i `/profile/follows` czytają
// dane w dwóch krokach: najpierw identyfikatory, potem treść do wyświetlenia.
// Awaria DRUGIEGO kroku była nieodróżnialna od pustki i od oczekiwania - trasa
// rysowała puste `<ul>` bez ani jednego słowa, a licznik w zakładce nadal
// pokazywał liczbę z pierwszego kroku. Użytkownik czytał „Wpisy (2)" nad pustym
// prostokątem i wnioskował, że panel zgubił jego zapisane artykuły.
//
// TRZY STANY MUSZĄ BYĆ ROZŁĄCZNE: oczekiwanie, awaria, pustka. Ten atom
// odpowiada za dwa pierwsze; trzeci zostaje w trasie (to ona wie, że lista
// identyfikatorów jest pusta).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - DECYZJI, KTÓRY STAN POKAZAĆ: należy do tras i ma asercje w
//   `src/routes/__tests__/profileListRoutes.test.tsx`.
// - TREŚCI KOMUNIKATÓW: asercje idą na KLUCZACH i18n, nie na napisach.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

import { ListHydrationNotice } from "@/components/profile/atoms/ListHydrationNotice";
import { axeViolations, summarize } from "@/test/axe";

afterEach(() => cleanup());

describe("stan oczekiwania", () => {
  it("mówi o wczytywaniu, a NIE o awarii", () => {
    render(<ListHydrationNotice state="pending" />);
    expect(screen.getByText("profile.lists.loading")).toBeTruthy();
    expect(screen.queryByText("profile.lists.loadFailed")).toBeNull();
  });

  it("oczekiwanie NIE jest alarmem - czytnik ekranu nie przerywa czytania", () => {
    // `role="alert"` na wskaźniku wczytywania ogłaszałby awarię przy każdym
    // wejściu na panel.
    render(<ListHydrationNotice state="pending" />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("oczekiwanie nie pokazuje przycisku ponowienia, choćby był podany", () => {
    // Ponowienie odczytu, który jeszcze trwa, tylko mnoży żądania.
    const onRetry = vi.fn();
    render(<ListHydrationNotice state="pending" onRetry={onRetry} />);
    expect(screen.queryByText("profile.lists.retry")).toBeNull();
  });
});

describe("stan awarii", () => {
  it("jest OGŁASZANY jako alarm i mówi, że to nie pustka", () => {
    render(<ListHydrationNotice state="error" />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("profile.lists.loadFailed");
  });

  it("pokazuje ponowienie, gdy trasa je udostępnia", () => {
    const onRetry = vi.fn();
    render(<ListHydrationNotice state="error" onRetry={onRetry} />);
    fireEvent.click(screen.getByText("profile.lists.retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("BEZ ponowienia zostaje sam komunikat - bez martwego przycisku", () => {
    // Przycisk, który nic nie robi, jest gorszy od jego braku: użytkownik klika
    // i wnioskuje, że awaria jest trwała.
    render(<ListHydrationNotice state="error" />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText("profile.lists.retry")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("awaria i oczekiwanie są rozróżnialne w DOM, nie tylko w treści", () => {
    // Po tych znacznikach asertują testy tras.
    const pending = render(<ListHydrationNotice state="pending" />);
    expect(pending.container.querySelector('[data-testid="hydration-pending"]')).toBeTruthy();
    cleanup();
    const error = render(<ListHydrationNotice state="error" />);
    expect(error.container.querySelector('[data-testid="hydration-error"]')).toBeTruthy();
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = render(<ListHydrationNotice state="error" onRetry={vi.fn()} />);
    expect(await axeViolations(container).then(summarize)).toBe("");
  });
});
