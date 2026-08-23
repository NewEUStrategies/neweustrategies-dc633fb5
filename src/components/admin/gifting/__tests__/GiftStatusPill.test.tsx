// Atom plakietki statusu linku podarunkowego - CO KOLOR MÓWI ADMINOWI.
//
// CO TEN PLIK DOWODZI.
//   1. TRZY STANY MAJĄ TRZY RÓŻNE TONACJE, a nie „jakiś kolor". Cofnięty
//      (decyzja człowieka, dostęp odcięty) jest czerwony, wygasły (upływ czasu)
//      szary. To jedyna informacja, którą admin dostaje SKANUJĄC tabelę wzrokiem,
//      zanim przeczyta choć jedną etykietę - a tsc nie widzi różnicy między
//      dwiema klasami CSS, więc rozjazd tonacji przechodzi recenzję bez śladu.
//   2. ETYKIETA JEDZIE NIETKNIĘTA. Atom nie zna słownika ani języka; gdyby
//      kiedykolwiek zaczął dokładać własny napis, panel angielski pokazałby
//      polszczyznę.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Wyliczania statusu z wiersza (revoked_at bije
// expires_at) - to `GiftLinksPanel.test.tsx`. Doboru klucza etykiety - to
// `GiftLinkRow.test.tsx`.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { GiftStatusPill } from "@/components/admin/gifting/atoms/GiftStatusPill";

function klasa(status: "active" | "revoked" | "expired"): string {
  const { unmount } = render(<GiftStatusPill status={status} label={`etykieta-${status}`} />);
  const cls = screen.getByText(`etykieta-${status}`).className;
  unmount();
  return cls;
}

describe("plakietka statusu linku", () => {
  it("cofnięty jest CZERWONY, wygasły SZARY, aktywny ZIELONY - trzy różne tonacje", () => {
    const active = klasa("active");
    const revoked = klasa("revoked");
    const expired = klasa("expired");

    expect(active).toContain("emerald");
    expect(revoked).toContain("destructive");
    expect(expired).toContain("bg-muted");
    expect(new Set([active, revoked, expired]).size).toBe(3);
  });

  it("pokazuje DOKŁADNIE przekazaną etykietę - zero własnych napisów", () => {
    render(<GiftStatusPill status="active" label="Bardzo Konkretna Etykieta" />);

    expect(screen.getByText("Bardzo Konkretna Etykieta")).toBeTruthy();
  });
});
