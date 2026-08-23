// Audyt gifting na PRAWDZIWYM słowniku - CZY ZOBACZYMY ZDARZENIE Z PRZYSZŁOŚCI.
//
// CO TEN PLIK DOWODZI.
//   1. ZDARZENIE, KTÓREGO TEN BUILD NIE ZNA, DOJEŻDŻA DO INTERFEJSU NIETKNIĘTE.
//      `event_type` jest celowo otwartym stringiem (komentarz przy
//      `GiftEventAdminRow`): trigger w bazie może dopisać nowy typ zdarzenia
//      przed wdrożeniem frontu, a audyt, który takie zdarzenie ukrywa albo
//      podmienia na inne, jest gorszy niż brak audytu - wygląda na kompletny.
//      Mechanizmem jest `defaultValue: e.event_type` w wywołaniu `t()`.
//   2. KONTROLA DODATNIA W TYM SAMYM PLIKU: typ znany dostaje TŁUMACZENIE ze
//      słownika („utworzony"), więc test nie przechodzi tylko dlatego, że
//      tłumacz nic nie tłumaczy.
//
// DLACZEGO OSOBNY PLIK. Obie atrapy i18n w repo (`@/test/i18nStub`,
// `@/test/reactStubs`) USUWAJĄ `defaultValue` z parametrów, więc pod nimi ten
// dowód jest niewykonalny - zobaczyłby się sam klucz. Dlatego tutaj
// `react-i18next` NIE JEST mockowany: `@/lib/i18n` woła
// `i18n.use(initReactI18next).init(...)`, więc `useTranslation()` bez providera
// czyta prawdziwą instancję aplikacji. Skrót `vi.mock("react-i18next", () =>
// reactI18nextMock())` zakleszczyłby plik (fabryka mocka importuje `@/lib/i18n`,
// a ten importuje mockowany moduł) - patrz nagłówek `SavedSearchesPanel.test.tsx`.
// `@/lib/i18n-gifting-admin` też NIE jest mockowany, bo to jego import
// rejestruje słownik panelu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Doboru kluczy i zastępników w wierszu - to
// `GiftEventRow.test.tsx` (na atrapie echującej klucz). Parytetu pl/en słownika -
// bramki `src/__tests__/i18nParity.gate.test.ts`.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import "@/test/i18nReal";
import "@/lib/i18n-gifting-admin";
import { GiftEventRow } from "@/components/admin/gifting/molecules/GiftEventRow";
import type { GiftEventAdminRow } from "@/lib/gifting-admin.functions";

const BAZOWE: GiftEventAdminRow = {
  id: "77777777-7777-4777-8777-777777777777",
  event_type: "created",
  post_id: "88888888-8888-4888-8888-888888888888",
  post_title: "Reforma rynku energii",
  actor_id: "99999999-9999-4999-8999-999999999999",
  actor_name: "Redakcja Testowa",
  actor_email: "redakcja@example.com",
  code: "ABCDEFGHIJKLMNOPQRST",
  created_at: "2026-08-01T10:00:00.000Z",
  total_count: 1,
};

function wiersz(event_type: string) {
  render(
    <table>
      <tbody>
        <GiftEventRow event={{ ...BAZOWE, event_type }} formatDate={() => "CZAS"} />
      </tbody>
    </table>,
  );
}

describe("audyt gifting na prawdziwym słowniku", () => {
  it("typ zdarzenia NIEZNANY temu buildowi widnieje pod SWOJĄ nazwą", () => {
    wiersz("quota_topped_up");

    // Dokładnie surowa nazwa z bazy - nie klucz, nie pusta komórka, nie „inne".
    expect(screen.getByText("quota_topped_up")).toBeTruthy();
    expect(screen.queryByText(/giftingAdmin\.audit\.type/)).toBeNull();
  });

  it("KONTROLA DODATNIA: typ znany dostaje tłumaczenie ze słownika", () => {
    wiersz("created");

    expect(screen.getByText("utworzony")).toBeTruthy();
  });

  it("nieznany typ nie przebiera się za żaden typ znany", () => {
    wiersz("quota_topped_up");

    for (const znane of ["utworzony", "otwarty", "cofnięty", "wygasł"]) {
      expect(screen.queryByText(znane)).toBeNull();
    }
  });
});
