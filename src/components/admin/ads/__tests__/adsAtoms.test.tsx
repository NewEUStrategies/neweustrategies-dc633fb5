// Atomy panelu reklam: cztery komórki, w których panel MÓWI COŚ O EMISJI.
//
// CO TEN PLIK DOWODZI.
//   1. STATUS SLOTU DEGRADUJE SIĘ W STRONĘ „WSTRZYMANY". Gałąź domyślna
//      `AdSlotStatusLabel` to `statusPaused`, więc wiersz z wartością spoza
//      enuma (kolumna z innej migracji, literówka w ręcznej edycji) NIE mówi
//      „aktywny". Odwrotna degradacja obiecywałaby emisję, której nie ma,
//      a `Record<..., string>` ani tsc tego nie pilnują - to gałąź, nie typ.
//   2. ZGODA RODO MA DWA RÓŻNE NAPISY, nie jeden i pustkę. Kolumna zgody jest
//      JEDYNYM miejscem na liście, w którym panel mówi, czy slot ładuje skrypt
//      strony trzeciej czytelnikowi bez zgody marketingowej. Pusta komórka
//      czytałaby się jak „nie wymaga".
//   3. CTR BEZ WYŚWIETLEŃ TO KRESKA, NIE „0.0%" I NIE „NaN%". 0% czytałoby się
//      jak zmierzony wynik („nikt nie kliknął"), a `0/0` w JS daje `NaN`.
//   4. PODSUMOWANIE TARGETINGU BRONI SIĘ PRZED USZKODZONYM jsonb. Kolumna
//      `ad_slots.targeting` jest jsonb, więc do atomu przychodzi tablica, string
//      albo `null` - i wtedy panel mówi „wszyscy" (czyli PRAWDĘ o emisji),
//      a nie pustkę, którą czyta się jak awarię wczytywania.
//   5. CHIP OGŁASZA WYBÓR PRZEZ `aria-pressed`, nie tylko kolorem tła - ta sama
//      decyzja stała w trasie w TRZECH kopiach, więc dowód jest jeden.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł `parseAdTargeting` - mają tabelę
// przypadków w `src/lib/ads/__tests__/targeting.test.ts`; tutaj funkcja jedzie
// PRAWDZIWA i przedmiotem dowodu jest WPIĘCIE (co widzi administrator, gdy
// kolumna jest uszkodzona). (2) Kompletności słowników - `i18nAdsAdmin.test.ts`
// i `adsLabelKeys.gate.test.tsx`. (3) Samego `Button`/`Badge` z `components/ui` -
// to biblioteka.
//
// ATRAPA i18n: `@/test/i18nStub` (echo klucza, parametry w nawiasie). Asercje
// stoją na KLUCZACH, nie na polskim tekście - poprawka literówki w słowniku nie
// ma prawa psuć testu, a rozjazd klucza owszem.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-ads-admin", () => ({ ensureI18n: () => undefined }));

import { AdConsentLabel } from "@/components/admin/ads/atoms/AdConsentLabel";
import { AdCtrCell, adCtr } from "@/components/admin/ads/atoms/AdCtrCell";
import { AdSlotStatusLabel } from "@/components/admin/ads/atoms/AdSlotStatusLabel";
import {
  AdTargetingHeader,
  AdTargetingSummary,
} from "@/components/admin/ads/atoms/AdTargetingSummary";
import { AdTargetingChip, adChipClass } from "@/components/admin/ads/atoms/AdTargetingChip";
import type { AdSlot } from "@/lib/ads/types";

/** `<td>` renderuje się tylko w tabeli - happy-dom nie naprawia zagnieżdżenia. */
function renderCell(ui: React.ReactNode) {
  return render(
    <table>
      <tbody>
        <tr>{ui}</tr>
      </tbody>
    </table>,
  );
}

describe("atom statusu slotu", () => {
  it("slot aktywny mówi 'aktywny'", () => {
    render(<AdSlotStatusLabel status="active" />);
    expect(screen.getByText("adsAdmin.slots.statusActive")).toBeTruthy();
  });

  it("slot wstrzymany mówi 'wstrzymany'", () => {
    render(<AdSlotStatusLabel status="paused" />);
    expect(screen.getByText("adsAdmin.slots.statusPaused")).toBeTruthy();
  });

  it("status spoza enuma degraduje się do 'wstrzymany', a NIE do 'aktywny'", () => {
    // Wartość spoza enuma powstaje z ręcznej edycji wiersza albo z kolumny
    // dopisanej migracją poza typami. Rzutowanie jest tu ŚWIADOME i zawężone
    // do jednego przypadku, bo dowodem jest właśnie gałąź domyślna.
    render(<AdSlotStatusLabel status={"archived" as AdSlot["status"]} />);
    expect(screen.getByText("adsAdmin.slots.statusPaused")).toBeTruthy();
    expect(screen.queryByText("adsAdmin.slots.statusActive")).toBeNull();
  });
});

describe("atom zgody marketingowej", () => {
  it("slot wymagający zgody mówi o tym wprost", () => {
    render(<AdConsentLabel requiresConsent />);
    expect(screen.getByText("adsAdmin.slots.consentRequired")).toBeTruthy();
  });

  it("slot bez wymogu zgody ma WŁASNY napis, nie pustą komórkę", () => {
    const { container } = render(<AdConsentLabel requiresConsent={false} />);
    expect(screen.getByText("adsAdmin.slots.consentNotRequired")).toBeTruthy();
    expect(container.textContent).not.toBe("");
  });
});

describe("atom CTR", () => {
  it("liczy CTR z licznikami z bazy i podaje jedno miejsce po kropce", () => {
    expect(adCtr(8, 3)).toBe("37.5%");
    renderCell(<AdCtrCell impressions={8} clicks={3} />);
    expect(screen.getByText("37.5%")).toBeTruthy();
  });

  it("zero wyświetleń daje kreskę, a nie '0.0%' ani 'NaN%'", () => {
    expect(adCtr(0, 0)).toBe("—");
    renderCell(<AdCtrCell impressions={0} clicks={0} />);
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText("0.0%")).toBeNull();
    expect(screen.queryByText("NaN%")).toBeNull();
  });

  it("kliknięcia bez wyświetleń (zgubiona impresja) też dają kreskę, nie 'Infinity%'", () => {
    // `ad-event` zapisuje impresję i klik osobno, więc klik bez impresji jest
    // stanem osiągalnym: zablokowany beacon impresji, przerwany render.
    expect(adCtr(0, 5)).toBe("—");
  });

  it("CTR 100% nie jest zaokrąglany do liczby całkowitej", () => {
    expect(adCtr(4, 4)).toBe("100.0%");
  });
});

describe("atom podsumowania targetingu", () => {
  const summaryText = () => screen.getByText(/adsAdmin\.summary|PL|EN/).textContent;

  it("liczy członów: kategorie, tagi i wersje językowe wielkimi literami", () => {
    render(
      <AdTargetingSummary
        targeting={{ categorySlugs: ["a", "b"], tagSlugs: ["t"], languages: ["pl"] }}
      />,
    );
    expect(summaryText()).toBe("2 adsAdmin.summaryCategories - 1 adsAdmin.summaryTags - PL");
  });

  it("dwie wersje językowe idą po ukośniku, w kolejności z kolumny", () => {
    render(<AdTargetingSummary targeting={{ languages: ["en", "pl"] }} />);
    expect(summaryText()).toBe("EN/PL");
  });

  it("pusty targeting mówi 'wszyscy' - to informacja o emisji, nie pustka", () => {
    render(<AdTargetingSummary targeting={{}} />);
    expect(screen.getByText("adsAdmin.summaryAll")).toBeTruthy();
  });

  it.each([
    ["tablica", [{ categorySlugs: ["a"] }]],
    ["string", '{"categorySlugs":["a"]}'],
    ["null", null],
    ["liczba", 7],
  ])("uszkodzony jsonb (%s) mówi 'wszyscy', a nie renderuje pustki", (_label, value) => {
    render(<AdTargetingSummary targeting={value} />);
    expect(screen.getByText("adsAdmin.summaryAll")).toBeTruthy();
  });

  it("puste tablice w kolumnie znaczą brak ograniczenia, nie '0 kategorii'", () => {
    render(<AdTargetingSummary targeting={{ categorySlugs: [], tagSlugs: [], languages: [] }} />);
    expect(screen.getByText("adsAdmin.summaryAll")).toBeTruthy();
  });

  it("język spoza pl/en jest odsiewany, więc panel nie obiecuje emisji, której nie ma", () => {
    render(<AdTargetingSummary targeting={{ languages: ["de"] }} />);
    expect(screen.getByText("adsAdmin.summaryAll")).toBeTruthy();
    expect(screen.queryByText("DE")).toBeNull();
  });

  it("nagłówek kolumny jedzie z klucza słownika", () => {
    render(<AdTargetingHeader />);
    expect(screen.getByText("adsAdmin.columnTargeting")).toBeTruthy();
  });
});

describe("atom chipa targetingu", () => {
  it("stan wyboru jest OGŁOSZONY przez aria-pressed, nie tylko kolorem", () => {
    render(<AdTargetingChip label="Polityka" active onToggle={() => undefined} />);
    const chip = screen.getByRole("button", { name: "Polityka" });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });

  it("chip niewybrany też ma aria-pressed (false), a nie brak atrybutu", () => {
    render(<AdTargetingChip label="Polityka" active={false} onToggle={() => undefined} />);
    expect(screen.getByRole("button", { name: "Polityka" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("chip jest przyciskiem typu button - nie wysyła formularza, w którym stoi", () => {
    render(<AdTargetingChip label="UE" active={false} onToggle={() => undefined} />);
    expect(screen.getByRole("button", { name: "UE" }).getAttribute("type")).toBe("button");
  });

  it("kliknięcie oddaje decyzję wołającemu (chip nie trzyma stanu)", () => {
    const onToggle = vi.fn();
    render(<AdTargetingChip label="UE" active={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: "UE" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("klasa chipa różni wybrany od niewybranego (kolor niesie znaczenie)", () => {
    expect(adChipClass(true)).toContain("bg-primary");
    expect(adChipClass(false)).toContain("bg-background");
    expect(adChipClass(true)).not.toBe(adChipClass(false));
  });
});
