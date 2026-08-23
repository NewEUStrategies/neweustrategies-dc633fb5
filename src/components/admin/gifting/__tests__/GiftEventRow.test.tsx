// Molekuła wiersza logu audytu gifting - KOMU PRZYPISUJEMY ZDARZENIE.
//
// CO TEN PLIK DOWODZI.
//   1. „ANONIMOWY ODBIORCA" POJAWIA SIĘ WYŁĄCZNIE PRZY OTWARCIU BEZ AKTORA.
//      Przy zdarzeniu `created` brak aktora to kreska, bo link zawsze ktoś
//      utworzył - napis „anonimowy" byłby w tym miejscu nieprawdą o audycie,
//      a warunek `!e.actor_id ? anonymous : ...` (bez sprawdzenia typu) wygląda
//      w recenzji równie sensownie.
//   2. KOD JEST SKRÓCONY DO 10 ZNAKÓW Z WIELOKROPKIEM - i to jest cały kod,
//      jaki panel pokazuje. Skrót krótszy niż prefiks kodu uniemożliwiłby
//      dopasowanie zdarzenia do linku ze zgłoszenia.
//   3. ETYKIETA TYPU IDZIE PRZEZ KLUCZ SŁOWNIKA ZŁOŻONY Z `event_type`.
//   4. FORMATOWANIE CZASU JEST WSTRZYKNIĘTE - molekuła nie zna locale.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Tego, że NIEZNANY typ zdarzenia dojeżdża do
// interfejsu jako surowa nazwa (`defaultValue`) - obie atrapy i18n w repo
// filtrują `defaultValue`, więc dowód musi stać na prawdziwym słowniku i stoi
// w `GiftEventRowRealDictionary.test.tsx`. Tonacji plakietki -
// `GiftEventPill.test.tsx`.
//
// Atrapa i18n: `@/test/i18nStub` - mierzymy DOBÓR klucza, nie polszczyznę.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-gifting-admin", () => ({ ensureI18n: () => undefined }));

import { GiftEventRow } from "@/components/admin/gifting/molecules/GiftEventRow";
import type { GiftEventAdminRow } from "@/lib/gifting-admin.functions";

const BAZOWE: GiftEventAdminRow = {
  id: "44444444-4444-4444-8444-444444444444",
  event_type: "created",
  post_id: "55555555-5555-4555-8555-555555555555",
  post_title: "Reforma rynku energii",
  actor_id: "66666666-6666-4666-8666-666666666666",
  actor_name: "Redakcja Testowa",
  actor_email: "redakcja@example.com",
  code: "ABCDEFGHIJKLMNOPQRST",
  created_at: "2026-08-01T10:00:00.000Z",
  total_count: 1,
};

function wiersz(patch: Partial<GiftEventAdminRow> = {}) {
  const formatDate = vi.fn((iso: string) => `CZAS(${iso})`);
  render(
    <table>
      <tbody>
        <GiftEventRow event={{ ...BAZOWE, ...patch }} formatDate={formatDate} />
      </tbody>
    </table>,
  );
  return { formatDate };
}

describe("wiersz audytu: kto stoi za zdarzeniem", () => {
  it("otwarcie BEZ aktora jest nazwane anonimowym odbiorcą", () => {
    wiersz({ event_type: "redeemed", actor_id: null, actor_name: null, actor_email: null });

    expect(screen.getByText("giftingAdmin.audit.anonymous")).toBeTruthy();
  });

  it("utworzenie bez aktora daje KRESKĘ, nie „anonimowego odbiorcę”", () => {
    wiersz({ event_type: "created", actor_id: null, actor_name: null, actor_email: null });

    expect(screen.queryByText("giftingAdmin.audit.anonymous")).toBeNull();
    expect(screen.getByText("-")).toBeTruthy();
  });

  it("otwarcie Z aktorem pokazuje jego nazwę, a nie „anonimowego odbiorcę”", () => {
    wiersz({ event_type: "redeemed", actor_name: "Czytelnik Testowy" });

    expect(screen.queryByText("giftingAdmin.audit.anonymous")).toBeNull();
    expect(screen.getByText("Czytelnik Testowy")).toBeTruthy();
  });

  it("brak nazwy aktora spada na jego e-mail", () => {
    wiersz({ event_type: "revoked", actor_name: null, actor_email: "admin@example.org" });

    expect(screen.getByText("admin@example.org")).toBeTruthy();
  });
});

describe("wiersz audytu: kod, typ i czas", () => {
  it("kod jest skrócony do DOKŁADNIE 10 znaków z wielokropkiem", () => {
    wiersz({ code: "ABCDEFGHIJKLMNOPQRST" });

    expect(screen.getByText("ABCDEFGHIJ...")).toBeTruthy();
  });

  it("etykieta typu powstaje z klucza złożonego z event_type", () => {
    wiersz({ event_type: "exhausted" });

    expect(screen.getByText("giftingAdmin.audit.type.exhausted")).toBeTruthy();
  });

  it("czas idzie przez WSTRZYKNIĘTE domknięcie, nie przez własne Intl", () => {
    const { formatDate } = wiersz();

    expect(formatDate).toHaveBeenCalledWith(BAZOWE.created_at);
    expect(screen.getByText(`CZAS(${BAZOWE.created_at})`)).toBeTruthy();
  });

  it("brak tytułu wpisu daje kreskę, a nie puste miejsce w kolumnie", () => {
    wiersz({ post_title: "" });

    expect(screen.getByText("-")).toBeTruthy();
  });
});
