// Atom „podgląd karty biletu" - termin sprzedaży w STREFIE WYDARZENIA.
//
// PLIK BIEGNIE PRZY `TZ=Europe/London` dla wydarzenia w `Europe/Warsaw`.
// Dawny podgląd czytał pole `datetime-local` przez `new Date(pole)` (strefa
// przeglądarki), a pokazywał w strefie serwisu - organizator w Londynie
// wpisujący „do 18:00" widział w podglądzie „do 19:00". Napis nieczytelny jako
// data rzucał przy tym `RangeError` w renderze.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTicketPreview } from "@/components/admin/events/atoms/EventTicketPreview";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

const ORIGINAL_TZ = process.env.TZ;
const S = "adminEventRegistration.tickets.studio.";

beforeAll(() => {
  process.env.TZ = "Europe/London";
});

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

function podglad(salesTo: string, salesToSaved: string | null = null) {
  return render(
    <EventTicketPreview
      name="Standard"
      description=""
      priceLabel={null}
      salesTo={salesTo}
      salesToSaved={salesToSaved}
      timeZone="Europe/Warsaw"
      lang="pl"
    />,
  );
}

describe("EventTicketPreview - termin sprzedaży", () => {
  it("18:00 z pola to 18:00 czasu wydarzenia, nie 19:00 (strefa przeglądarki)", () => {
    podglad("2026-09-30T18:00");
    const wiersz = screen.getByText((text) => text.startsWith(`${S}previewUntil(`));
    expect(wiersz.textContent).toContain("18:00");
    expect(wiersz.textContent).not.toContain("19:00");
  });

  it("puste pole to sprzedaż bez końca", () => {
    podglad("");
    expect(screen.getByText(`${S}previewAlways`)).toBeInTheDocument();
  });

  it("napis nieczytelny jako data nie wywraca renderu - wiersz terminu znika", () => {
    podglad("2026-13-45T99:99");
    expect(screen.queryByText((text) => text.startsWith(`${S}previewUntil(`))).toBeNull();
    expect(screen.queryByText(`${S}previewAlways`)).toBeNull();
    expect(screen.getByText("Standard")).toBeInTheDocument();
  });
});
