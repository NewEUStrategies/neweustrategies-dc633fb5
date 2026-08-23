// Molekuła edytora `ad_slots.targeting`: KTÓRE slugi trafiają do kolumny.
//
// CO TEN PLIK DOWODZI.
//   1. CHIP ZAPISUJE SLUG, A NIE IDENTYFIKATOR. Kolumna jest porównywana ze
//      slugami kontekstu strony (patrz `matchesAdTargeting`), więc zapisany
//      `id` dałby slot, który NIGDY się nie wyemituje - i to bez żadnego błędu:
//      panel pokazywałby zaznaczony chip, a czytelnik nie zobaczyłby reklamy.
//   2. PRZEŁĄCZANIE DZIAŁA W OBIE STRONY i odznaczenie zostawia PUSTĄ TABLICĘ
//      (nie `undefined`), bo dopiero `adTargetingToJson` decyduje o pominięciu
//      pustego pola - i to on jest dowodzony w teście formularza.
//   3. TAG JEST POKAZYWANY Z „#", A SLUG ZAPISYWANY BEZ „#". Prefiks jest
//      dekoracją listy; wysłany do bazy zamieniłby dopasowanie w pudło.
//   4. WERSJE JĘZYKOWE SĄ ZAWSZE DWIE (pl, en) i NIE zależą od katalogu -
//      pusty katalog zainteresowań nie może zabrać możliwości zawężenia emisji
//      do jednej wersji językowej.
//   5. KOLEJNOŚĆ JĘZYKÓW TO KOLEJNOŚĆ KLIKANIA (semantyka `Set`), więc payload
//      jest przewidywalny dla testu ładunku w panelu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) `useInterestCatalog` - molekuła NIE zna
// react-query ani Supabase, katalog przychodzi propsem (dowód, że katalog jedzie
// z języka interfejsu, stoi w `AdSlotForm.test.tsx`). (2) Serializacji do jsonb -
// `src/lib/ads/__tests__/targeting.test.ts` i test formularza.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-ads-admin", () => ({ ensureI18n: () => undefined }));

import { AdTargetingEditor } from "@/components/admin/ads/molecules/AdTargetingEditor";
import type { AdTargeting } from "@/lib/ads/types";

const CATEGORIES = [
  { id: "c1", slug: "polityka", label: "Polityka" },
  { id: "c2", slug: "gospodarka", label: "Gospodarka" },
];
const TAGS = [{ id: "t1", slug: "ue", label: "UE" }];

function renderEditor(value: AdTargeting = {}) {
  const onChange = vi.fn();
  const utils = render(
    <AdTargetingEditor value={value} onChange={onChange} categories={CATEGORIES} tags={TAGS} />,
  );
  return { onChange, ...utils };
}

describe("edytor targetingu slotu", () => {
  it("kliknięcie kategorii zapisuje SLUG, nie identyfikator wiersza", () => {
    const { onChange } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Polityka" }));
    expect(onChange).toHaveBeenCalledWith({ categorySlugs: ["polityka"] });
  });

  it("druga kategoria dopisuje się do pierwszej (semantyka OR, nie podmiana)", () => {
    const { onChange } = renderEditor({ categorySlugs: ["polityka"] });
    fireEvent.click(screen.getByRole("button", { name: "Gospodarka" }));
    expect(onChange).toHaveBeenCalledWith({ categorySlugs: ["polityka", "gospodarka"] });
  });

  it("ponowne kliknięcie ODZNACZA i zostawia pustą tablicę, nie undefined", () => {
    const { onChange } = renderEditor({ categorySlugs: ["polityka"] });
    fireEvent.click(screen.getByRole("button", { name: "Polityka" }));
    expect(onChange).toHaveBeenCalledWith({ categorySlugs: [] });
  });

  it("wybrana kategoria jest ogłoszona przez aria-pressed", () => {
    renderEditor({ categorySlugs: ["polityka"] });
    expect(screen.getByRole("button", { name: "Polityka" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Gospodarka" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("tag pokazuje się z '#', a do kolumny leci slug BEZ '#'", () => {
    const { onChange } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "#UE" }));
    expect(onChange).toHaveBeenCalledWith({ tagSlugs: ["ue"] });
  });

  it("kategorie i tagi są niezależne - wybór tagu nie czyści kategorii", () => {
    const { onChange } = renderEditor({ categorySlugs: ["polityka"] });
    fireEvent.click(screen.getByRole("button", { name: "#UE" }));
    expect(onChange).toHaveBeenCalledWith({ categorySlugs: ["polityka"], tagSlugs: ["ue"] });
  });

  it("wersje językowe to zawsze PL i EN - pusty katalog ich nie zabiera", () => {
    render(<AdTargetingEditor value={{}} onChange={vi.fn()} categories={[]} tags={[]} />);
    expect(screen.getByRole("button", { name: "PL" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "EN" })).toBeTruthy();
  });

  it("kolejność języków to kolejność klikania, nie kolejność alfabetyczna", () => {
    const { onChange } = renderEditor({ languages: ["en"] });
    fireEvent.click(screen.getByRole("button", { name: "PL" }));
    expect(onChange).toHaveBeenCalledWith({ languages: ["en", "pl"] });
  });

  it("odznaczenie ostatniego języka zostawia pustą tablicę (brak zawężenia)", () => {
    const { onChange } = renderEditor({ languages: ["pl"] });
    fireEvent.click(screen.getByRole("button", { name: "PL" }));
    expect(onChange).toHaveBeenCalledWith({ languages: [] });
  });

  it("pusty katalog kategorii nie renderuje ani jednego chipa kategorii", () => {
    render(<AdTargetingEditor value={{}} onChange={vi.fn()} categories={[]} tags={TAGS} />);
    expect(screen.queryByRole("button", { name: "Polityka" })).toBeNull();
    // Podpowiedź o znaczeniu pustego pola zostaje - inaczej pusty katalog
    // czytałby się jak awaria.
    expect(screen.getByText("adsAdmin.targetingHint")).toBeTruthy();
  });

  it("nagłówki grup jadą z kluczy słownika, nie z twardych napisów", () => {
    renderEditor();
    expect(screen.getByText("adsAdmin.targetingTitle")).toBeTruthy();
    expect(screen.getByText("adsAdmin.categories")).toBeTruthy();
    expect(screen.getByText("adsAdmin.tags")).toBeTruthy();
    expect(screen.getByText("adsAdmin.languages")).toBeTruthy();
  });
});
