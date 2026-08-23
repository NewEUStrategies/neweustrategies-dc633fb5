// Molekuła akcji wiersza kampanii - TU mieszka reguła „która akcja dla którego
// statusu", czyli jedyna bariera przed drugą masową wysyłką tych samych kodów.
//
// CO TEN PLIK DOWODZI.
//   1. Każdy z czterech statusów pokazuje DOKŁADNIE swój zestaw przycisków.
//      Kampania wysłana nie ma przycisku wysyłki, kampania robocza nie ma
//      eksportu kodów, kampania zarchiwizowana nie ma nic. Reguła jest funkcją
//      (`campaignActions`), ale to tutaj widać, czy funkcja jest naprawdę
//      podłączona - rozjazd między nią a JSX-em przejdzie przez `tsc`.
//   2. Blokada powtórnego kliknięcia jest OSOBNA dla generowania i dla wysyłki:
//      trwające generowanie NIE blokuje wysyłki innej kampanii i odwrotnie.
//   3. Archiwizacja NIE PYTA o potwierdzenie - kliknięcie od razu woła zdarzenie.
//      Kontrast: usunięcie kuponu na sąsiedniej zakładce przechodzi przez
//      `confirm()`. To jest różnica w traktowaniu dwóch destrukcyjnych akcji.
//   4. Eksport CSV nie ma stanu oczekiwania: pięć kliknięć to pięć zdarzeń.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Samej tablicy akcji per status - jest przejechana
// tabelarycznie w `couponCampaignForm.test.ts`; tutaj chodzi o PODŁĄCZENIE.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CampaignRowActions } from "@/components/admin/coupons/molecules/CampaignRowActions";
import type { CampaignStatus } from "@/lib/billing/couponCampaignForm";

afterEach(cleanup);

const LABELS = {
  generate: "Generuj",
  csv: "CSV",
  send: "Wyślij",
  archive: "archive",
};

function renderActions(overrides: Partial<Parameters<typeof CampaignRowActions>[0]> = {}) {
  const props = {
    status: "draft" as CampaignStatus,
    generating: false,
    sending: false,
    onGenerate: vi.fn(),
    onExport: vi.fn(),
    onSend: vi.fn(),
    onArchive: vi.fn(),
    labels: LABELS,
    ...overrides,
  };
  render(<CampaignRowActions {...props} />);
  return props;
}

/** Nazwy dostępnościowe widocznych przycisków, w kolejności renderu. */
function widoczneAkcje(): string[] {
  return screen
    .queryAllByRole("button")
    .map((b) => b.textContent?.trim() || b.getAttribute("aria-label") || "");
}

describe("zestaw przycisków zależy od statusu", () => {
  it("wersja robocza: generowanie i archiwizacja, BEZ eksportu i BEZ wysyłki", () => {
    renderActions({ status: "draft" });
    expect(widoczneAkcje()).toEqual(["Generuj", "archive"]);
  });

  it("kampania z wygenerowanymi kodami: eksport, wysyłka i archiwizacja, BEZ generowania", () => {
    renderActions({ status: "generated" });
    expect(widoczneAkcje()).toEqual(["CSV", "Wyślij", "archive"]);
  });

  it("kampania WYSŁANA nie ma przycisku ponownej wysyłki - zostaje sama archiwizacja", () => {
    renderActions({ status: "sent" });
    expect(widoczneAkcje()).toEqual(["archive"]);
  });

  it("kampania zarchiwizowana nie ma ŻADNEJ akcji", () => {
    renderActions({ status: "archived" });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("zdarzenia akcji", () => {
  it("generowanie woła własne zdarzenie i nie rusza pozostałych", () => {
    const props = renderActions({ status: "draft" });
    fireEvent.click(screen.getByRole("button", { name: "Generuj" }));
    expect(props.onGenerate).toHaveBeenCalledTimes(1);
    expect(props.onArchive).not.toHaveBeenCalled();
  });

  it("ARCHIWIZACJA NIE PYTA o potwierdzenie - jedno kliknięcie i zdarzenie leci", () => {
    const props = renderActions({ status: "draft" });
    fireEvent.click(screen.getByRole("button", { name: "archive" }));
    expect(props.onArchive).toHaveBeenCalledTimes(1);
  });

  it("eksport CSV nie ma blokady - pięć kliknięć to pięć zapytań o kody", () => {
    const props = renderActions({ status: "generated" });
    const csv = screen.getByRole("button", { name: "CSV" });
    for (let i = 0; i < 5; i += 1) fireEvent.click(csv);
    expect(props.onExport).toHaveBeenCalledTimes(5);
  });
});

describe("blokada w trakcie zapisu", () => {
  it("trwające GENEROWANIE blokuje przycisk generowania", () => {
    renderActions({ status: "draft", generating: true });
    expect(screen.getByRole("button", { name: "Generuj" })).toBeDisabled();
  });

  it("trwające generowanie NIE blokuje archiwizacji - to niezależne mutacje", () => {
    renderActions({ status: "draft", generating: true });
    expect(screen.getByRole("button", { name: "archive" })).not.toBeDisabled();
  });

  it("trwająca WYSYŁKA blokuje wysyłkę, ale nie eksport kodów", () => {
    renderActions({ status: "generated", sending: true });
    expect(screen.getByRole("button", { name: "Wyślij" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "CSV" })).not.toBeDisabled();
  });

  it("zablokowany przycisk wysyłki NIE woła zdarzenia po kliknięciu", () => {
    const props = renderActions({ status: "generated", sending: true });
    fireEvent.click(screen.getByRole("button", { name: "Wyślij" }));
    expect(props.onSend).not.toHaveBeenCalled();
  });
});

describe("nazwa dostępnościowa archiwizacji", () => {
  it("przycisk archiwizacji to SAMA IKONA - bez etykiety byłby niedostępny dla czytnika", () => {
    renderActions({ status: "draft" });
    const przycisk = screen.getByRole("button", { name: "archive" });
    expect(przycisk.textContent?.trim()).toBe("");
    expect(przycisk.getAttribute("aria-label")).toBe("archive");
  });
});
