// BANER ZGÓD: INTEGRALNOŚĆ ZGODY I DOSTĘPNOŚĆ.
//
// ZDANIE, KTÓRE TEN PLIK MA UDOWODNIĆ: **BANER NIE MOŻE ZAPISAĆ ZGODY, KTÓREJ
// UŻYTKOWNIK NIE DAŁ.** Zamknięcie bez wyboru, `Escape` i klik w tło nie są
// zgodą - i nie są też cichą odmową udawaną za wybór. To jest jedyny komponent
// w repo, który zobaczy KAŻDY odwiedzający, więc musi też być obsługiwalny
// z klawiatury.
//
// CO DOWODZIMY - I DLACZEGO KAŻDY PUNKT MA KONSEKWENCJĘ PRAWNĄ:
//   1. PRZED DECYZJĄ modal szczegółów NIE DA SIĘ porzucić: `Escape` nie działa,
//      klik w tło nie działa, a „X" nie zapisuje żadnego stanu. Gdyby którakolwiek
//      z tych dróg zamykała baner, użytkownik zostałby na stronie bez decyzji -
//      czyli skrypty byłyby bramkowane stanem, którego nikt nie wybrał, a baner
//      przestałby być widoczny. To jest dokładnie „dark pattern" z wytycznych
//      EDPB: droga do porzucenia łatwiejsza niż droga do odmowy.
//   2. PO DECYZJI wszystkie trzy drogi ZAMYKAJĄ modal i NIE ZAPISUJĄ nic
//      nowego. Zamknięcie widoku nie jest zmianą decyzji.
//   3. W KOMPAKTOWEJ KARCIE „X" jest jawną ODMOWĄ (wytyczne CNIL: zamknięcie
//      nie może być łatwiejsze niż odrzucenie) - i to jest jedyne miejsce,
//      w którym „X" cokolwiek zapisuje. Etykieta mówi to wprost.
//   4. PANEL PREFERENCJI zapisuje DOKŁADNIE zaznaczony zestaw, a kategoria
//      niezbędna zostaje włączona i zablokowana - bez możliwości „odznaczenia",
//      które i tak nie miałoby skutku.
//   5. DOSTĘPNOŚĆ (`axeViolations`): karta kompaktowa, rozwinięty panel
//      preferencji i modal szczegółów - wszystkie trzy stany bez naruszeń.
//      Kontrolki kategorii są `role="checkbox"` z `aria-checked`, więc czytnik
//      ekranu ogłasza stan, a nie tylko nazwę.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGRESJI WYGLĄDU I TREŚCI: `ConsentBanner.test.tsx` pilnuje tytułu, logo
//   marki, obu polityk, wersji PL/EN i tego, że „X" odrzuca. Ten plik nie
//   powtarza tych asercji - dokłada INTEGRALNOŚĆ i DOSTĘPNOŚĆ.
// - MECHANIKI ZGÓD: `useConsent` (`src/lib/ads/consent.ts`) ma własne testy;
//   tutaj jest atrapą i sprawdzamy WYŁĄCZNIE, co baner do niej wysyła.
// - KLAMROWANIA GPC: `gpcCmpClamp.test.ts` i `gpc.test.ts`.
// - REJESTRU RODO: `registryBridgeSync.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  save: vi.fn(),
  acceptAll: vi.fn(),
  rejectAll: vi.fn(),
  clear: vi.fn(),
  /** Czy decyzja już padła - steruje dostępnością dróg zamknięcia. */
  decided: false,
  /** Stan zgód widziany przez baner; `null` = brak decyzji. */
  state: null as { version: number; ts: number; categories: Record<string, boolean> } | null,
}));

/** Ustalona data bazowa - żadnego `Date.now()` w fixture'ach. */
const BASE_TS = 1767225600000; // 2026-01-01T00:00:00Z

vi.mock("@/lib/ads/consent", () => ({
  OPEN_PREFS_EVENT: "consent-open-preferences",
  consumeOpenPrefsRequest: () => false,
  useConsent: () => ({
    state: h.state,
    decided: h.decided,
    mounted: true,
    save: h.save,
    acceptAll: h.acceptAll,
    rejectAll: h.rejectAll,
    clear: h.clear,
  }),
  useGpcSignal: () => ({ active: false, source: "none" as const }),
}));

vi.mock("@/lib/useSiteSetting", () => ({
  useSiteSetting: <T,>(key: string, defaults: T): T => {
    if (key === "privacy") {
      return { privacy_page_slug: "polityka-prywatnosci", cookie_banner: true } as T;
    }
    return defaults;
  },
}));
vi.mock("@/components/ThemeProvider", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.mock("@/lib/overlayCoordinator", () => ({
  setConsentOverlayVisible: vi.fn(),
  setMarketingConsent: vi.fn(),
}));

import i18n from "@/lib/i18n";
import { ConsentBanner } from "@/components/ConsentBanner";
import { COOKIE_BANNER_DEFAULTS } from "@/lib/cookieBanner/config";
import { axeViolations, summarize } from "@/test/axe";

const PL = COOKIE_BANNER_DEFAULTS.copy.pl;

/** Stan „zgoda udzielona" - do przypadków PO decyzji. */
function decidedState(): { version: number; ts: number; categories: Record<string, boolean> } {
  return {
    version: 2,
    ts: BASE_TS,
    categories: { necessary: true, functional: true, analytics: false, marketing: false },
  };
}

/**
 * Modal szczegółów jest OSIĄGALNY WYŁĄCZNIE przez panel preferencji - i to
 * jest część mechaniki, nie szczegół testu: „Szczegóły i podmioty" siedzą
 * w rozwiniętym panelu, więc do listy podmiotów nie da się dojść bez
 * przejścia przez kategorie.
 */
function openDetails(): void {
  fireEvent.click(screen.getByRole("button", { name: PL.customize }));
  fireEvent.click(screen.getByRole("button", { name: PL.showDetails }));
}

function openPrefs(): void {
  fireEvent.click(screen.getByRole("button", { name: PL.customize }));
}

/**
 * Modal szczegółów PO DECYZJI. Baner nie renderuje wtedy karty kompaktowej
 * wcale (`if (decided && !detailsOpen && !dismissing) return null`), więc
 * jedyną drogą do panelu prywatności jest zdarzenie z odnośnika w stopce -
 * i to jest realna ścieżka użytkownika, który chce ZMIENIĆ decyzję.
 */
function openDetailsAfterDecision(): void {
  fireEvent(window, new Event("consent-open-preferences"));
}

/** Modal szczegółów jest jedynym `dialog` z `aria-modal="true"`. */
function detailsModal(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
}

/** Karta kompaktowa: `dialog` z `aria-modal="false"`. */
function compactCard(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"][aria-modal="false"]');
}

function noWritesHappened(): void {
  expect(h.save, "zapisano zestaw kategorii bez wyboru użytkownika").not.toHaveBeenCalled();
  expect(h.acceptAll, "zapisano pełną zgodę bez wyboru użytkownika").not.toHaveBeenCalled();
  expect(h.rejectAll, "zapisano odmowę bez wyboru użytkownika").not.toHaveBeenCalled();
  expect(h.clear, "wyczyszczono decyzję bez wyboru użytkownika").not.toHaveBeenCalled();
}

beforeEach(async () => {
  h.save.mockClear();
  h.acceptAll.mockClear();
  h.rejectAll.mockClear();
  h.clear.mockClear();
  h.decided = false;
  h.state = null;
  await i18n.changeLanguage("pl");
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// 1. PRZED DECYZJĄ: modalu szczegółów NIE DA SIĘ porzucić.
// ---------------------------------------------------------------------------

describe("integralność zgody - PRZED decyzją nie ma drogi porzucenia", () => {
  it("`Escape` w modalu szczegółów NIE zamyka go i NIE zapisuje niczego", () => {
    // Nasłuch klawisza jest zarejestrowany warunkowo (`detailsOpen && decided`),
    // więc przed decyzją `Escape` nie ma czego wywołać. Gdyby zamykał, baner
    // znikałby bez decyzji - a stan zgód zostawał na wartości domyślnej, której
    // użytkownik nie wybrał.
    render(<ConsentBanner />);
    openDetails();
    expect(detailsModal()).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(detailsModal(), "`Escape` porzucił baner przed decyzją").toBeTruthy();
    noWritesHappened();
  });

  it("KLIK W TŁO modalu NIE zamyka go i NIE zapisuje niczego", () => {
    // Warunek `if (decided) setDetailsOpen(false)` na tle jest tu regułą, nie
    // wygodą: klik w tło to najłatwiejszy przypadkowy gest na telefonie.
    render(<ConsentBanner />);
    openDetails();
    const modal = detailsModal();
    expect(modal).toBeTruthy();
    if (!modal) throw new Error("test: brak modalu szczegółów");

    fireEvent.click(modal);
    expect(detailsModal(), "klik w tło porzucił baner przed decyzją").toBeTruthy();
    noWritesHappened();
  });

  it("klik w SAMĄ TREŚĆ modalu też nie zamyka (zdarzenie nie przecieka do tła)", () => {
    render(<ConsentBanner />);
    openDetails();
    const title = screen.getByRole("heading", { level: 2 });
    fireEvent.click(title);
    expect(detailsModal()).toBeTruthy();
    noWritesHappened();
  });

  it("„X” w modalu szczegółów ZWIJA widok, ale NIE ZAPISUJE żadnej decyzji", () => {
    // To nie jest ta sama kontrolka co „X" w karcie kompaktowej: tam „X" jest
    // jawną ODMOWĄ (i tak się nazywa), tu jest wyłącznie powrotem do karty.
    // Etykieta przed decyzją brzmi „ukryj szczegóły", nie „zamknij".
    render(<ConsentBanner />);
    openDetails();
    const back = screen.getByRole("button", { name: PL.hideDetails });
    fireEvent.click(back);

    // Modal zniknął, ale karta kompaktowa ZOSTAŁA - decyzja nadal przed nami.
    expect(detailsModal()).toBeNull();
    expect(compactCard()).toBeTruthy();
    noWritesHappened();
  });

  it("etykieta „X” w modalu RÓŻNI SIĘ przed i po decyzji", () => {
    // Czytnik ekranu musi usłyszeć, co ten przycisk robi: przed decyzją wraca
    // do karty, po decyzji zamyka okno. Jedna etykieta na oba przypadki byłaby
    // fałszywa w jednym z nich.
    render(<ConsentBanner />);
    openDetails();
    expect(screen.getByRole("button", { name: PL.hideDetails })).toBeTruthy();

    cleanup();
    h.decided = true;
    h.state = decidedState();
    render(<ConsentBanner />);
    openDetailsAfterDecision();
    expect(screen.getByRole("button", { name: i18n.t("common.close") })).toBeTruthy();
  });

  it("otwarcie i zwinięcie szczegółów NIE zmienia stanu zgód ani razu", () => {
    render(<ConsentBanner />);
    for (let round = 0; round < 3; round += 1) {
      openDetails();
      fireEvent.click(screen.getByRole("button", { name: PL.hideDetails }));
    }
    noWritesHappened();
  });
});

// ---------------------------------------------------------------------------
// 2. PO DECYZJI: trzy drogi zamknięcia, żadna nie zmienia decyzji.
// ---------------------------------------------------------------------------

describe("integralność zgody - PO decyzji zamknięcie nie jest zmianą decyzji", () => {
  beforeEach(() => {
    h.decided = true;
    h.state = decidedState();
  });

  it("`Escape` zamyka modal i NIE zapisuje niczego", () => {
    render(<ConsentBanner />);
    openDetailsAfterDecision();
    expect(detailsModal()).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(detailsModal()).toBeNull();
    noWritesHappened();
  });

  it("inny klawisz NIE zamyka modalu", () => {
    // Nasłuch reaguje wyłącznie na `Escape`; przypadkowe `Tab` albo `Enter`
    // podczas przeglądania podmiotów nie może zamknąć okna.
    render(<ConsentBanner />);
    openDetailsAfterDecision();
    for (const key of ["Enter", "Tab", " ", "a"]) {
      fireEvent.keyDown(window, { key });
      expect(detailsModal(), `klawisz ${key} zamknął modal`).toBeTruthy();
    }
  });

  it("klik w TŁO zamyka modal i NIE zapisuje niczego", () => {
    render(<ConsentBanner />);
    openDetailsAfterDecision();
    const modal = detailsModal();
    if (!modal) throw new Error("test: brak modalu szczegółów");
    fireEvent.click(modal);
    expect(detailsModal()).toBeNull();
    noWritesHappened();
  });

  it("klik w TREŚĆ modalu nadal NIE zamyka - `stopPropagation` działa po decyzji też", () => {
    render(<ConsentBanner />);
    openDetailsAfterDecision();
    fireEvent.click(screen.getByRole("heading", { level: 2 }));
    expect(detailsModal()).toBeTruthy();
  });

  it("„X” zamyka modal i NIE zapisuje niczego", () => {
    render(<ConsentBanner />);
    openDetailsAfterDecision();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common.close") }));
    expect(detailsModal()).toBeNull();
    noWritesHappened();
  });

  it("nasłuch klawiatury jest ODPINANY po zamknięciu modalu", () => {
    // Nasłuch na `window` zostawiony po odmontowaniu reagowałby na `Escape`
    // z całkiem innego widoku - i wołałby `setState` na martwym komponencie.
    render(<ConsentBanner />);
    openDetailsAfterDecision();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(detailsModal()).toBeNull();
    cleanup();
    // Po odmontowaniu `Escape` nie może już niczego dotknąć.
    fireEvent.keyDown(window, { key: "Escape" });
    noWritesHappened();
  });
});

// ---------------------------------------------------------------------------
// 3. KARTA KOMPAKTOWA: „X" JEST odmową - i to jedyne takie miejsce.
// ---------------------------------------------------------------------------

describe("karta kompaktowa - zamknięcie jest ODMOWĄ, nie porzuceniem", () => {
  it("„X” woła odmowę, a nie zgodę - i robi to DOKŁADNIE raz", () => {
    // Wytyczne CNIL: droga zamknięcia nie może być łatwiejsza niż droga
    // odrzucenia. Rozwiązanie jest najprostsze z możliwych - zamknięcie JEST
    // odrzuceniem, a etykieta mówi to wprost.
    render(<ConsentBanner />);
    const card = compactCard();
    if (!card) throw new Error("test: brak karty kompaktowej");
    const closeButton = card.querySelector<HTMLButtonElement>("button[aria-label]");
    expect(closeButton).toBeTruthy();
    if (!closeButton) throw new Error("test: brak przycisku zamknięcia");
    fireEvent.click(closeButton);
    expect(h.rejectAll).toHaveBeenCalledTimes(1);
    expect(h.acceptAll).not.toHaveBeenCalled();
    expect(h.save).not.toHaveBeenCalled();
  });

  it("odmowa i zgoda są RÓWNORZĘDNE - oba przyciski istnieją w tej samej grupie", () => {
    // Asercja strukturalna, nie o wyglądzie: przycisk odmowy poza wspólnym
    // rzędem (np. jako odnośnik pod tekstem) to klasyczny ciemny wzorzec.
    render(<ConsentBanner />);
    const accept = screen.getByRole("button", { name: PL.acceptAll });
    const reject = screen.getByRole("button", { name: PL.rejectAll });
    expect(accept.parentElement).toBe(reject.parentElement);
  });

  it("każda z trzech dróg decyzji woła INNĄ funkcję - żadna nie dubluje drugiej", () => {
    render(<ConsentBanner />);
    fireEvent.click(screen.getByRole("button", { name: PL.acceptAll }));
    expect(h.acceptAll).toHaveBeenCalledTimes(1);
    expect(h.rejectAll).not.toHaveBeenCalled();
    expect(h.save).not.toHaveBeenCalled();

    cleanup();
    h.acceptAll.mockClear();
    render(<ConsentBanner />);
    fireEvent.click(screen.getByRole("button", { name: PL.rejectAll }));
    expect(h.rejectAll).toHaveBeenCalledTimes(1);
    expect(h.acceptAll).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. PANEL PREFERENCJI: zapisuje DOKŁADNIE to, co zaznaczono.
// ---------------------------------------------------------------------------

describe("panel preferencji - zapis wyłącznie zaznaczonego zestawu", () => {
  /** Kontrolki kategorii to `role="checkbox"` - patrz nagłówek pliku. */
  function categoryBoxes(): HTMLElement[] {
    return screen.getAllByRole("checkbox");
  }

  it("kategoria NIEZBĘDNA jest zaznaczona i zablokowana - i taka zostaje po kliknięciu", () => {
    // Zgoda na cookies ściśle niezbędne nie istnieje (art. 5 ust. 3 ePrivacy),
    // więc kontrolka nie może udawać, że jest wyborem.
    render(<ConsentBanner />);
    openPrefs();
    const boxes = categoryBoxes();
    expect(boxes.length).toBeGreaterThan(1);
    const necessary = boxes[0];
    expect(necessary.getAttribute("aria-checked")).toBe("true");
    // Blokada jest NATYWNA (`disabled` na `<button>`), a nie `aria-disabled`:
    // natywny atrybut zdejmuje kontrolkę z kolejności tabulacji I odcina
    // zdarzenia, więc nie da się jej „przekliknąć" klawiaturą.
    expect(necessary.hasAttribute("disabled")).toBe(true);
    fireEvent.click(necessary);
    expect(necessary.getAttribute("aria-checked")).toBe("true");
  });

  it("otwarcie panelu SAMO nie zapisuje niczego", () => {
    render(<ConsentBanner />);
    openPrefs();
    noWritesHappened();
  });

  it("zapis niesie kategorię zaznaczoną i NIE niesie odznaczonej", () => {
    render(<ConsentBanner />);
    openPrefs();
    const boxes = categoryBoxes();
    // Kolejność kategorii jest umową z rejestrem zgód (`necessary` pierwsza).
    fireEvent.click(boxes[1]);
    fireEvent.click(screen.getByRole("button", { name: PL.saveSelection }));
    expect(h.save).toHaveBeenCalledTimes(1);
    const saved = h.save.mock.calls[0][0] as Record<string, boolean>;
    expect(saved.necessary).toBe(true);
    expect(saved.functional).toBe(true);
    expect(saved.analytics).toBe(false);
    expect(saved.marketing).toBe(false);
  });

  it("dwukrotne przełączenie wraca do stanu wyjściowego - zapis też", () => {
    render(<ConsentBanner />);
    openPrefs();
    const boxes = categoryBoxes();
    fireEvent.click(boxes[1]);
    fireEvent.click(boxes[1]);
    fireEvent.click(screen.getByRole("button", { name: PL.saveSelection }));
    const saved = h.save.mock.calls[0][0] as Record<string, boolean>;
    expect(saved.functional).toBe(false);
  });

  it("kontrolki kategorii OGŁASZAJĄ stan, nie tylko nazwę", () => {
    // `role="checkbox"` bez `aria-checked` czytnik ekranu ogłasza jako pole bez
    // stanu - użytkownik nie wie, na co się zgadza.
    render(<ConsentBanner />);
    openPrefs();
    for (const box of categoryBoxes()) {
      expect(box.getAttribute("aria-checked"), "kontrolka bez `aria-checked`").toMatch(
        /^(true|false)$/,
      );
      expect(box.getAttribute("aria-label"), "kontrolka bez nazwy").toBeTruthy();
    }
  });

  it("kontrolki kategorii są OSIĄGALNE z klawiatury - to natywne przyciski", () => {
    // Baner widzi każdy odwiedzający, w tym osoby nieużywające wskaźnika.
    // `<div role="checkbox">` bez `tabindex` byłby dla nich niewidoczny;
    // `<button role="checkbox">` jest w kolejności tabulacji z definicji,
    // a `disabled` na kategorii niezbędnej ją z niej zdejmuje - i to jest
    // poprawne, bo tam nie ma czego wybierać.
    render(<ConsentBanner />);
    openPrefs();
    const boxes = categoryBoxes();
    expect(boxes.length).toBeGreaterThan(1);
    for (const box of boxes) {
      expect(box.tagName, "kontrolka kategorii nie jest przyciskiem").toBe("BUTTON");
      expect(box.getAttribute("tabindex"), "przycisk nie potrzebuje `tabindex`").toBeNull();
    }
    // Wszystkie kategorie POZA niezbędną są czynne.
    expect(boxes.filter((box) => box.hasAttribute("disabled"))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 5. DOSTĘPNOŚĆ - trzy stany banera.
// ---------------------------------------------------------------------------

describe("dostępność banera zgód", () => {
  it("karta kompaktowa nie ma naruszeń dostępności", async () => {
    const { container } = render(<ConsentBanner />);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("rozwinięty panel preferencji nie ma naruszeń dostępności", async () => {
    const { container } = render(<ConsentBanner />);
    openPrefs();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("modal szczegółów nie ma naruszeń dostępności", async () => {
    const { container } = render(<ConsentBanner />);
    openDetails();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("modal szczegółów PO decyzji też nie ma naruszeń", async () => {
    h.decided = true;
    h.state = decidedState();
    const { container } = render(<ConsentBanner />);
    openDetailsAfterDecision();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("angielska wersja banera nie ma naruszeń dostępności", async () => {
    // Naruszenie mogłoby wejść z samym tłumaczeniem: pusta etykieta w jednym
    // słowniku daje przycisk bez nazwy tylko w tej wersji językowej.
    await i18n.changeLanguage("en");
    const { container } = render(<ConsentBanner />);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("karta kompaktowa jest NIEMODALNA, a szczegóły MODALNE", () => {
    // Karta nie może uwięzić fokusu - użytkownik ma prawo czytać stronę przed
    // decyzją. Modal szczegółów uwięzić go musi, bo jest oknem dialogowym.
    render(<ConsentBanner />);
    expect(compactCard()?.getAttribute("aria-modal")).toBe("false");
    openDetails();
    expect(detailsModal()?.getAttribute("aria-modal")).toBe("true");
  });

  it("oba stany mają DOSTĘPNĄ NAZWĘ okna dialogowego", () => {
    // `role="dialog"` bez nazwy czytnik ekranu ogłasza jako „okno dialogowe" -
    // bez informacji, czego dotyczy.
    render(<ConsentBanner />);
    const card = compactCard();
    expect(card?.getAttribute("aria-label")).toBe(PL.title);
    openDetails();
    const modal = detailsModal();
    const labelledBy = modal?.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(String(labelledBy))?.textContent).toBe(PL.title);
  });

  it("ikony dekoracyjne są UKRYTE przed czytnikiem ekranu", () => {
    // Ikona bez `aria-hidden` obok tekstowej etykiety daje podwójne ogłoszenie.
    const { container } = render(<ConsentBanner />);
    const icons = container.querySelectorAll("svg");
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      const hidden =
        icon.getAttribute("aria-hidden") !== null || icon.closest("[aria-hidden]") !== null;
      expect(hidden, "ikona widoczna dla czytnika ekranu").toBe(true);
    }
  });
});
