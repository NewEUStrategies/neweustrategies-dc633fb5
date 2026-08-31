// GiftArticleButton - POWIERZCHNIA UDOSTEPNIANIA gotowego linku.
//
// PO CO OSOBNY PLIK. `GiftArticleButton.test.tsx` dowodzi MACIERZY FAZ (gosc /
// bez subskrypcji / limit / wyczerpany budzet). Tutaj zaczynamy tam, gdzie
// tamten konczy: link JUZ ISTNIEJE i czytelnik go wysyla. To jest jedyny
// moment, w ktorym mechanika styka sie ze swiatem zewnetrznym - schowkiem
// i intentami platform - i jedyny, w ktorym mozna wyslac ZLY adres:
//
//   1. SKOPIOWANY ADRES MUSI NIESC KOD. Bez `?gift=<kod>` odbiorca dostaje
//      zwykly link do platnego artykulu, czyli sciane paywalla zamiast
//      prezentu. Nadawca zuzyl limit i nie dowie sie, ze nic nie dal.
//   2. ZABLOKOWANY SCHOWEK MUSI SIE ODEZWAC. Kontekst niezabezpieczony albo
//      cofnieta zgoda przegladarki konczy sie odrzuconym `writeText`. Cisza
//      w tym miejscu daje nadawce, ktory wkleja poprzednia zawartosc schowka.
//   3. STOPKA MUSI MOWIC PRAWDE O BUDZECIE. "Pierwszych N czytelnikow" i
//      "kazdy, kto dostanie link" to dwie rozne obietnice - o wyborze decyduje
//      `budget.unlimited`, czyli cap 0 zapisany na linku.
//   4. PONOWIENIE PO ODMOWIE musi RESETOWAC mutacje, inaczej efekt
//      auto-generowania widzi `isError` i nigdy nie strzela ponownie.
//
// ATRAPY: te same GRANICE co w pliku siostrzanym - warstwa danych
// (`lib/gifting/hooks`), router, i18n, toast, schowek. Modele i atomy biegna
// prawdziwe.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { giftClickBudget } from "@/lib/gifting/model";
import type { GiftArticleState, GiftLinkResult, GiftSettings } from "@/lib/gifting/model";

const BASE_SETTINGS: GiftSettings = {
  enabled: true,
  monthly_limit: 0,
  link_ttl_days: 0,
  max_redemptions_per_link: 5,
  eligibility: "registered",
};

const h = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  settings: {
    enabled: true,
    monthly_limit: 0,
    link_ttl_days: 0,
    max_redemptions_per_link: 5,
    eligibility: "registered",
  } as GiftSettings,
  state: null as GiftArticleState | null,
  mutationData: null as GiftLinkResult | null,
  mutationError: false,
  errorKey: null as "notGated" | "unknown" | null,
  mutate: vi.fn(),
  reset: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && Object.keys(opts).length > 0 ? `${key} ${JSON.stringify(opts)}` : key,
  }),
}));

vi.mock("@/lib/i18n-gifting", () => ({}));

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: h.session }) }));

vi.mock("@/components/atoms/BrandIcon", () => ({
  BrandIcon: ({ alt }: { alt?: string }) => <span data-testid="brand-icon">{alt}</span>,
}));

vi.mock("@/lib/access/metering", () => ({ formatMeterResetDate: () => "1 wrzesnia" }));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => h.toastSuccess(...args),
    error: (...args: unknown[]) => h.toastError(...args),
  },
}));

vi.mock("@/lib/gifting/hooks", () => ({
  useGiftSettings: () => ({ data: h.settings }),
  useGiftArticleState: () => ({
    data: h.state,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateGiftLink: () => ({
    mutation: {
      data: h.mutationData,
      isPending: false,
      isError: h.mutationError,
      mutate: h.mutate,
      reset: h.reset,
    },
    errorKey: h.errorKey,
  }),
}));

const { GiftArticleButton } = await import("@/components/gifting/GiftArticleButton");

const CODE = "abcDEF123_-xyzABC456pqr";
const URL_WPISU = "https://example.org/analizy/wpis";
const writeText = vi.fn();

function makeState(partial: Partial<GiftArticleState>): GiftArticleState {
  return {
    enabled: true,
    canGift: true,
    requiresAuth: false,
    requiresSubscription: false,
    used: 0,
    monthlyLimit: 0,
    remaining: null,
    existingCode: null,
    expiresAt: null,
    eligibility: "registered",
    budget: giftClickBudget(0, 5),
    ...partial,
  };
}

function renderButton(props: { gated?: boolean } = {}) {
  return renderWithQueryClient(
    <GiftArticleButton
      postId="post-1"
      title="Tytul wpisu"
      url={URL_WPISU}
      lang="pl"
      gated={props.gated ?? true}
    />,
  );
}

function openPopover() {
  fireEvent.click(screen.getByRole("button", { name: "gifting.button" }));
}

beforeEach(() => {
  h.session = { user: { id: "u1" } };
  h.settings = { ...BASE_SETTINGS };
  h.state = null;
  h.mutationData = null;
  h.mutationError = false;
  h.errorKey = null;
  h.mutate.mockClear();
  h.reset.mockClear();
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});

describe("GiftArticleButton - kopiowanie linku podarunkowego", () => {
  it("kopiuje adres Z KODEM, a nie goly adres wpisu", async () => {
    h.state = makeState({ existingCode: CODE });
    renderButton();
    openPopover();
    fireEvent.click(screen.getByRole("button", { name: "gifting.copyLink" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${URL_WPISU}?gift=${CODE}`));
    expect(writeText).not.toHaveBeenCalledWith(URL_WPISU);
  });

  it("udane kopiowanie potwierdza sie toastem i zmiana etykiety przycisku", async () => {
    h.state = makeState({ existingCode: CODE });
    renderButton();
    openPopover();
    fireEvent.click(screen.getByRole("button", { name: "gifting.copyLink" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "gifting.copied" })).toBeTruthy(),
    );
    expect(h.toastSuccess).toHaveBeenCalledWith("gifting.copied");
  });

  it("ZABLOKOWANY schowek melduje sie bledem, a przycisk NIE udaje sukcesu", async () => {
    // Kontekst niezabezpieczony albo cofnieta zgoda: `writeText` odrzuca.
    // Cisza w tym miejscu daje nadawce, ktory wkleja poprzednia zawartosc
    // schowka i wysyla ja jako "prezent".
    h.state = makeState({ existingCode: CODE });
    writeText.mockRejectedValue(new Error("NotAllowedError"));
    renderButton();
    openPopover();
    fireEvent.click(screen.getByRole("button", { name: "gifting.copyLink" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("gifting.copyFailed"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "gifting.copyLink" })).toBeTruthy();
  });

  it("zablokowany schowek przy ZWYKLYM linku tez sie odzywa", async () => {
    h.mutationError = true;
    h.errorKey = "notGated";
    h.state = makeState({});
    writeText.mockRejectedValue(new Error("NotAllowedError"));
    renderButton();
    openPopover();
    fireEvent.click(screen.getByRole("button", { name: "gifting.copyLink" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("gifting.copyFailed"));
  });

  it("etykieta 'skopiowano' wraca do stanu wyjsciowego po chwili", async () => {
    // Bez tego powrotu przycisk zostaje na "skopiowano" na zawsze i nadawca
    // nie wie, czy drugie klikniecie w ogole cos zrobilo.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    h.state = makeState({ existingCode: CODE });
    renderButton();
    openPopover();
    fireEvent.click(screen.getByRole("button", { name: "gifting.copyLink" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "gifting.copied" })).toBeTruthy(),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "gifting.copyLink" })).toBeTruthy(),
    );
    vi.useRealTimers();
  });
});

describe("GiftArticleButton - kanaly udostepniania niosa link z kodem", () => {
  it("kazdy z siedmiu kanalow dostaje adres Z KODEM", () => {
    h.state = makeState({ existingCode: CODE });
    renderButton();
    openPopover();
    const zakodowany = encodeURIComponent(`${URL_WPISU}?gift=${CODE}`);
    const linki = screen.getAllByRole("link");
    const kanaly = linki.filter((a) => (a.getAttribute("href") ?? "").startsWith("http"));
    expect(kanaly.length).toBeGreaterThanOrEqual(6);
    for (const a of kanaly) {
      expect(a.getAttribute("href"), a.getAttribute("aria-label") ?? "").toContain(zakodowany);
    }
  });

  it("intent e-mail tez niesie kod (a nie sam tytul)", () => {
    h.state = makeState({ existingCode: CODE });
    renderButton();
    openPopover();
    const mail = screen
      .getAllByRole("link")
      .find((a) => (a.getAttribute("href") ?? "").startsWith("mailto:"));
    expect(mail?.getAttribute("href")).toContain(encodeURIComponent(`gift=${CODE}`));
  });
});

describe("GiftArticleButton - stopka mowi prawde o budzecie", () => {
  it("cap > 0: 'pierwszych N czytelnikow' z liczba z BUDZETU linku", () => {
    h.state = makeState({ existingCode: CODE, budget: giftClickBudget(0, 3) });
    renderButton();
    openPopover();
    expect(screen.getByText(/gifting\.firstNCanRead/).textContent).toContain('"count":3');
  });

  it("cap 0: 'kazdy, kto dostanie link' zamiast liczby", () => {
    // Budzet bez limitu to inna obietnica - podanie tu liczby (np. 0)
    // czytaloby sie jako "nikt nie przeczyta".
    h.state = makeState({ existingCode: CODE, budget: giftClickBudget(0, 0) });
    renderButton();
    openPopover();
    expect(screen.getByText(/gifting\.anyoneCanRead/)).toBeTruthy();
    expect(screen.queryByText(/gifting\.firstNCanRead/)).toBeNull();
  });

  it("data waznosci dolacza sie do stopki, gdy link wygasa", () => {
    h.state = makeState({
      existingCode: CODE,
      expiresAt: "2026-09-01T00:00:00.000Z",
      budget: giftClickBudget(0, 5),
    });
    renderButton();
    openPopover();
    expect(screen.getByText(/gifting\.expiresOn/)).toBeTruthy();
  });

  it("link bezterminowy stopki o waznosci NIE dokleja", () => {
    h.state = makeState({ existingCode: CODE, expiresAt: null });
    renderButton();
    openPopover();
    expect(screen.queryByText(/gifting\.expiresOn/)).toBeNull();
  });
});

describe("GiftArticleButton - nota o limicie miesiecznym", () => {
  it("limit > 0 pokazuje, ILE linkow zostalo w tym miesiacu", () => {
    h.state = makeState({ existingCode: CODE, monthlyLimit: 5, used: 2, remaining: 3 });
    renderButton();
    openPopover();
    expect(screen.getByText(/gifting\.remainingNote/).textContent).toContain('"count":3');
  });

  it("limit 0 mowi wprost 'bez limitu'", () => {
    h.state = makeState({ existingCode: CODE, monthlyLimit: 0, remaining: null });
    renderButton();
    openPopover();
    expect(screen.getByText("gifting.unlimitedNote")).toBeTruthy();
  });
});

describe("GiftArticleButton - lead popovera", () => {
  it("wpis zabramkowany z capem obiecuje konkretna liczbe otwarc", () => {
    h.settings = { ...BASE_SETTINGS, max_redemptions_per_link: 5 };
    h.state = makeState({ existingCode: CODE });
    renderButton();
    openPopover();
    expect(screen.getByText(/gifting\.leadCapped/).textContent).toContain('"count":5');
  });

  it("tenant bez capu nie obiecuje zadnej liczby", () => {
    h.settings = { ...BASE_SETTINGS, max_redemptions_per_link: 0 };
    h.state = makeState({ existingCode: CODE, budget: giftClickBudget(0, 0) });
    renderButton();
    openPopover();
    expect(screen.getByText("gifting.lead")).toBeTruthy();
    expect(screen.queryByText(/gifting\.leadCapped/)).toBeNull();
  });
});

describe("GiftArticleButton - ponowienie po odmowie generowania", () => {
  it("odmowa INNA niz notGated daje przycisk ponowienia, ktory RESETUJE mutacje", () => {
    // Bez `reset()` efekt auto-generowania widzi `isError` i nigdy nie strzela
    // ponownie - przycisk "ponow" bylby wtedy ozdoba.
    h.state = makeState({});
    h.mutationError = true;
    h.errorKey = "unknown";
    renderButton();
    openPopover();
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    expect(h.reset).toHaveBeenCalledTimes(1);
    expect(h.mutate).toHaveBeenCalledTimes(1);
  });

  it("odmowa notGated NIE proponuje ponowienia (to nie jest awaria)", () => {
    // "Wpis nie jest zabramkowany" znaczy, ze linku podarunkowego po prostu
    // nie ma po co tworzyc - ponawianie generowalo by te sama odmowe w kolko.
    h.state = makeState({});
    h.mutationError = true;
    h.errorKey = "notGated";
    renderButton();
    openPopover();
    expect(screen.queryByRole("button", { name: "common.retry" })).toBeNull();
    expect(screen.getByRole("button", { name: "gifting.copyLink" })).toBeTruthy();
  });

  it("komunikat notGated jest stonowany, a prawdziwa awaria - czerwona", () => {
    h.state = makeState({});
    h.mutationError = true;
    h.errorKey = "notGated";
    const { unmount } = renderButton();
    openPopover();
    expect(screen.getByText("gifting.errors.notGated").className).toContain(
      "text-muted-foreground",
    );
    unmount();

    h.errorKey = "unknown";
    renderButton();
    openPopover();
    expect(screen.getByText("gifting.errors.unknown").className).toContain("text-destructive");
  });

  it("swiezy wynik mutacji wystarcza do pokazania linku (zanim cache dojdzie)", () => {
    // `state` jeszcze bez kodu, ale mutacja juz zwrocila wynik - popover ma
    // pokazac gotowy link, a nie "przygotowuje".
    h.state = makeState({ existingCode: null });
    h.mutationData = {
      code: CODE,
      expiresAt: null,
      used: 1,
      monthlyLimit: 0,
      remaining: null,
      budget: giftClickBudget(0, 5),
    };
    renderButton();
    openPopover();
    expect(screen.getByRole("button", { name: "gifting.copyLink" })).toBeTruthy();
    expect(screen.queryByText("gifting.preparing")).toBeNull();
  });
});
