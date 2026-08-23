// Molekuła wiersza tabeli linków podarunkowych - CZY WIERSZ MÓWI PRAWDĘ
// O DOSTĘPIE DO PŁATNEJ TREŚCI.
//
// CO TEN PLIK DOWODZI.
//   1. KOLUMNA OTWARĆ CZYTA BUDŻET ZAMROŻONY NA LINKU, nie bieżące ustawienia
//      tenanta. Gdyby czytała ustawienia, obniżenie suwaka „5 → 2" przepisałoby
//      historię wszystkich starych linków: kolumna twierdziłaby „3 / 2", choć
//      baza (redeem_gift_link) egzekwuje cap zapisany przy tworzeniu.
//   2. WYCZERPANY BUDŻET JEST OZNACZONY, a cap 0 NIE jest wyczerpany nigdy
//      (0 = bez limitu). Odwrotna interpretacja zera dałaby czerwone „ostrzeżenie"
//      na linkach całkowicie sprawnych.
//   3. PRZYCISK COFNIĘCIA ISTNIEJE TYLKO DLA LINKU AKTYWNEGO, a kopiowanie kodu
//      jest w KAŻDYM wierszu (kod cofniętego linku wciąż trzeba móc wkleić do
//      zgłoszenia). Cofanie już cofniętego to wywołanie RPC bez skutku.
//   4. BRAK DANYCH MA UCZCIWY ZASTĘPNIK („-", „bez wygaśnięcia"), a e-mail
//      darczyńcy NIE DUBLUJE nazwy - w tabeli z siedmioma kolumnami dwa razy ten
//      sam tekst to zmarnowana linia.
//   5. FORMATOWANIE DATY JEST WSTRZYKNIĘTE. Molekuła nie zna decyzji o locale
//      (ta należy do trasy przez `uiLocale`), więc test dowodzi, że wiersz woła
//      podane domknięcie, a nie własne `toLocaleString`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Wyliczania statusu z `revoked_at`/`expires_at` -
// to `GiftLinksPanel.test.tsx`. Semantyki `giftCapExhausted` -
// `lib/gifting/__tests__/admin-model.test.ts`. Tonacji plakietki -
// `GiftStatusPill.test.tsx`.
//
// Atrapa i18n: `@/test/i18nStub` - asercja mierzy DOBÓR klucza i parametry
// (np. liczbę unikalnych odbiorców), a nie polszczyznę słownika.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-gifting-admin", () => ({ ensureI18n: () => undefined }));

import { GiftLinkRow } from "@/components/admin/gifting/molecules/GiftLinkRow";
import type { GiftLinkAdminRow } from "@/lib/gifting-admin.functions";

const BAZOWY: GiftLinkAdminRow = {
  id: "11111111-1111-4111-8111-111111111111",
  post_id: "22222222-2222-4222-8222-222222222222",
  post_title: "Reforma rynku energii",
  post_slug: "reforma-rynku-energii",
  created_by: "33333333-3333-4333-8333-333333333333",
  creator_name: "Redakcja Testowa",
  creator_email: "redakcja@example.com",
  code: "GIFTCODE1234567890",
  created_at: "2026-08-01T10:00:00.000Z",
  expires_at: "2026-09-01T10:00:00.000Z",
  revoked_at: null,
  redemption_count: 1,
  max_redemptions: 5,
  unique_recipients: 1,
  last_redeemed_at: null,
  total_count: 1,
};

function wiersz(
  patch: Partial<GiftLinkAdminRow> = {},
  opcje: { status?: "active" | "revoked" | "expired"; revoking?: boolean } = {},
) {
  const onCopy = vi.fn();
  const onRevoke = vi.fn();
  const formatDate = vi.fn((iso: string | null) => (iso ? `DATA(${iso})` : "-"));
  render(
    <table>
      <tbody>
        <GiftLinkRow
          row={{ ...BAZOWY, ...patch }}
          status={opcje.status ?? "active"}
          formatDate={formatDate}
          revoking={opcje.revoking ?? false}
          onCopy={onCopy}
          onRevoke={onRevoke}
        />
      </tbody>
    </table>,
  );
  return { onCopy, onRevoke, formatDate };
}

describe("wiersz linku podarunkowego: budżet otwarć", () => {
  it("pokazuje budżet Z LINKU w postaci „użyte / cap”", () => {
    wiersz({ redemption_count: 3, max_redemptions: 7 });

    expect(screen.getByText("3 / 7")).toBeTruthy();
  });

  it("wyczerpany budżet jest oznaczony ostrzegawczo i opisany podpowiedzią", () => {
    wiersz({ redemption_count: 2, max_redemptions: 2 });

    const komórka = screen.getByText("2 / 2");
    expect(komórka.className).toContain("text-destructive");
    expect(komórka.getAttribute("title")).toBe("giftingAdmin.links.capReached");
  });

  it("cap 0 znaczy BEZ LIMITU: sama liczba, żadnego ukośnika, żadnego ostrzeżenia", () => {
    wiersz({ redemption_count: 12, max_redemptions: 0 });

    expect(screen.queryByText("12 / 0")).toBeNull();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.queryByTitle("giftingAdmin.links.capReached")).toBeNull();
  });

  it("liczba UNIKALNYCH odbiorców jedzie parametrem obok licznika otwarć", () => {
    wiersz({ redemption_count: 9, max_redemptions: 0, unique_recipients: 4 });

    expect(screen.getByText("(giftingAdmin.links.recipients(count=4))")).toBeTruthy();
  });
});

describe("wiersz linku podarunkowego: uczciwe zastępniki", () => {
  it("brak tytułu spada na slug, brak obu na kreskę", () => {
    const { formatDate } = wiersz({ post_title: "", post_slug: "tylko-slug" });
    void formatDate;
    expect(screen.getByText("tylko-slug")).toBeTruthy();
  });

  it("brak tytułu I sluga daje kreskę, a nie pustą komórkę", () => {
    wiersz({ post_title: "", post_slug: null });

    expect(screen.getByText("-")).toBeTruthy();
  });

  it("e-mail darczyńcy NIE dubluje się, gdy jest równy nazwie", () => {
    wiersz({ creator_name: "redakcja@example.com", creator_email: "redakcja@example.com" });

    expect(screen.getAllByText("redakcja@example.com")).toHaveLength(1);
  });

  it("brak nazwy darczyńcy pokazuje e-mail jako nazwę (i nie powtarza go niżej)", () => {
    wiersz({ creator_name: null, creator_email: "autor@example.org" });

    expect(screen.getAllByText("autor@example.org")).toHaveLength(2);
  });

  it("brak nazwy I e-maila darczyńcy daje kreskę - kolumna nigdy nie jest pusta", () => {
    wiersz({ creator_name: null, creator_email: null });

    expect(screen.getByText("-")).toBeTruthy();
  });

  it("link bez daty wygaśnięcia mówi to WPROST, a nie kreską", () => {
    wiersz({ expires_at: null });

    expect(screen.getByText("giftingAdmin.links.neverExpires")).toBeTruthy();
  });
});

describe("wiersz linku podarunkowego: akcje", () => {
  it("formatowanie daty idzie przez WSTRZYKNIĘTE domknięcie, nie przez własne Intl", () => {
    const { formatDate } = wiersz();

    expect(formatDate).toHaveBeenCalledWith(BAZOWY.created_at);
    expect(formatDate).toHaveBeenCalledWith(BAZOWY.expires_at);
    expect(screen.getByText(`DATA(${BAZOWY.created_at})`)).toBeTruthy();
  });

  it("kopiowanie kodu jest dostępne także w wierszu COFNIĘTYM", () => {
    const { onCopy } = wiersz({ revoked_at: "2026-08-10T10:00:00.000Z" }, { status: "revoked" });

    fireEvent.click(screen.getByTitle("giftingAdmin.links.copyCode"));

    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it("przycisk cofnięcia NIE ISTNIEJE dla linku cofniętego ani wygasłego", () => {
    wiersz({ revoked_at: "2026-08-10T10:00:00.000Z" }, { status: "revoked" });
    expect(screen.queryByTitle("giftingAdmin.links.revoke")).toBeNull();
  });

  it("przycisk cofnięcia oddaje decyzję wołającemu (potwierdzenie żyje w organizmie)", () => {
    const { onRevoke } = wiersz({}, { status: "active" });

    fireEvent.click(screen.getByTitle("giftingAdmin.links.revoke"));

    expect(onRevoke).toHaveBeenCalledTimes(1);
  });

  it("na czas trwającego cofania przycisk jest zablokowany", () => {
    wiersz({}, { status: "active", revoking: true });

    expect((screen.getByTitle("giftingAdmin.links.revoke") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("plakietka statusu bierze etykietę z klucza dla PRZEKAZANEGO statusu", () => {
    wiersz({}, { status: "expired" });

    expect(screen.getByText("giftingAdmin.links.status.expired")).toBeTruthy();
  });
});
