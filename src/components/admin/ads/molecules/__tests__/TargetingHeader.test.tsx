// Naglowek kolumny targetingu w tabeli slotow.
//
// PO CO OSOBNA MOLEKULA I OSOBNY TEST. Naglowek jest jedynym elementem tabeli
// slotow, ktory MUSI wolac `useTranslation()` z wnetrza komorki `<th>` -
// `SlotsPanel` renderuje pozostale naglowki wprost z wlasnego `t`. Ta molekula
// istnieje po to, zeby kolumna targetingu nie wypadla z tlumaczenia przy
// przenoszeniu tabeli. Test pilnuje dokladnie tego: ze napis pochodzi ze
// SLOWNIKA (atrapa i18n oddaje klucz), a nie z literalu w kodzie.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

import { TargetingHeader } from "../TargetingHeader";

describe("TargetingHeader", () => {
  it("bierze etykiete ze slownika", () => {
    render(<TargetingHeader />);
    expect(screen.getByText("adsAdmin.columnTargeting")).toBeInTheDocument();
  });

  it("nie dokłada zadnego wlasnego elementu - wchodzi prosto do `<th>`", () => {
    // Molekula zwraca fragment. Gdyby opakowala tekst w `<div>`, wstawilaby
    // element blokowy do komorki tabeli i rozjechala szerokosci kolumn.
    const { container } = render(<TargetingHeader />);
    expect(container.innerHTML).toBe("adsAdmin.columnTargeting");
  });
});
