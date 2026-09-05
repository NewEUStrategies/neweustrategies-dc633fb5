/**
 * <FollowButton /> - przełącznik obserwowania autora / kategorii / tagu
 * w nagłówkach archiwum. Jedyna ścieżka, którą czytelnik może ZACZĄĆ coś
 * obserwować, więc test dotyka każdego wyjścia przycisku:
 *
 *  1. GOŚĆ nie dostaje cichej porażki - leci zdarzenie otwarcia okna logowania
 *     Z TEKSTAMI z ustawień personalizacji (to one tłumaczą, po co konto).
 *  2. ZALOGOWANY przełącza stan: gdy jeszcze nie obserwuje, mutacja idzie z
 *     `on: true`; gdy obserwuje - z `on: false`. Sam przycisk melduje stan
 *     przez `aria-pressed`, a w trakcie zapisu jest zablokowany.
 *  3. ODMOWA ZAPISU pokazuje komunikat (toast), zamiast zostawić przycisk
 *     w stanie, którego serwer nie przyjął.
 *  4. WYŁĄCZONA PERSONALIZACJA chowa przycisk całkowicie.
 *  5. LISTA OBSERWACJI JESZCZE NIEWCZYTANA (dane `undefined`) - przycisk musi
 *     stanąć w pozycji „nie obserwuję" i mimo to działać, a nie wywrócić się
 *     na czytaniu pustki.
 *
 * CO JEST ZAATRAPOWANE: `useAuth` (sesja), `usePersonalizedSettings`
 * (ustawienia serwisu), `useFollows` / `useToggleFollow` (warstwa danych) oraz
 * `sonner` (toast). Magistrala okna logowania (`loginPopupBus`) zostaje
 * PRAWDZIWA - test nasłuchuje jej publicznym `onOpenLoginPopup`, więc mierzy
 * zdarzenie, które naprawdę poleci po stronie klienta.
 *
 * UWAGA JĘZYKOWA: ten komponent NIE korzysta ze słownika i18n - ma własny,
 * wbudowany słownik dwóch napisów (`t(pl, en)`). Asercje na "Obserwuj" /
 * "Follow" są więc z konieczności porównaniem z kopią napisu; mierzą wybór
 * GAŁĘZI językowej, nie zawartość słownika (nie ma czego mierzyć).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Follow } from "@/hooks/useFollows";
import {
  DEFAULT_PERSONALIZED_SETTINGS,
  type PersonalizedSettings,
} from "@/hooks/usePersonalizedSettings";

interface ToggleInput {
  targetType: string;
  targetId: string;
  on: boolean;
}

interface ToggleOptions {
  onError?: (error: Error) => void;
}

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  settings: null as PersonalizedSettings | null,
  /** `undefined` = lista obserwacji jeszcze się nie wczytała. */
  follows: [] as
    undefined | Array<{ id: string; target_type: string; target_id: string; created_at: string }>,
  pending: false,
  failWith: null as string | null,
  mutations: [] as Array<{ targetType: string; targetId: string; on: boolean }>,
  toasts: [] as string[],
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));

vi.mock("@/hooks/usePersonalizedSettings", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/usePersonalizedSettings")>(
    "@/hooks/usePersonalizedSettings",
  );
  return { ...actual, usePersonalizedSettings: () => h.settings };
});

vi.mock("@/hooks/useFollows", () => ({
  useFollows: () => ({ data: h.follows }),
  useToggleFollow: () => ({
    isPending: h.pending,
    mutate: (input: ToggleInput, opts?: ToggleOptions) => {
      h.mutations.push(input);
      if (h.failWith !== null) opts?.onError?.(new Error(h.failWith));
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (message: string) => {
      h.toasts.push(message);
    },
    success: () => {},
  },
}));

import { onOpenLoginPopup, type LoginPopupOptions } from "@/lib/loginPopupBus";
import { FollowButton } from "@/components/FollowButton";

function settings(over: Partial<PersonalizedSettings> = {}): PersonalizedSettings {
  return { ...DEFAULT_PERSONALIZED_SETTINGS, ...over };
}

const follow = (targetType: string, targetId: string): Follow => ({
  id: `f-${targetId}`,
  target_type: targetType as Follow["target_type"],
  target_id: targetId,
  created_at: "2026-01-01",
});

function renderButton(lang: "pl" | "en" = "pl") {
  return render(<FollowButton targetType="author" targetId="autor-1" lang={lang} />);
}

beforeEach(() => {
  h.user = { id: "u1" };
  h.settings = settings();
  h.follows = [];
  h.pending = false;
  h.failWith = null;
  h.mutations.length = 0;
  h.toasts.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("FollowButton - przełącznik obserwowania", () => {
  it("wyłączona personalizacja chowa przycisk zamiast pokazywać go bezczynnym", () => {
    h.settings = settings({ enabled: false });
    const { container } = renderButton();

    expect(container).toBeEmptyDOMElement();
  });

  it("gość dostaje okno logowania z tekstami z ustawień, a nie cichą porażkę", () => {
    h.user = null;
    h.settings = settings({
      restrictedTitle: "Dołącz do nas",
      restrictedDescription: "Konto pozwala obserwować autorów.",
    });
    const seen: LoginPopupOptions[] = [];
    const off = onOpenLoginPopup((opts) => seen.push(opts));

    renderButton();
    fireEvent.click(screen.getByRole("button"));
    off();

    expect(seen).toEqual([
      { title: "Dołącz do nas", description: "Konto pozwala obserwować autorów." },
    ]);
    expect(h.mutations).toEqual([]);
  });

  it("zalogowany, który jeszcze nie obserwuje, wysyła zapis z on:true", () => {
    h.follows = [follow("category", "inna")];
    renderButton();

    const button = screen.getByRole("button", { name: "Obserwuj" });
    expect(button).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(button);

    expect(h.mutations).toEqual([{ targetType: "author", targetId: "autor-1", on: true }]);
  });

  it("kto już obserwuje TEN cel, wysyła odpisanie (on:false) i widzi stan wciśnięty", () => {
    h.follows = [follow("author", "autor-1")];
    renderButton();

    const button = screen.getByRole("button", { name: "Obserwujesz" });
    expect(button).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(button);

    expect(h.mutations).toEqual([{ targetType: "author", targetId: "autor-1", on: false }]);
  });

  it("przed wczytaniem listy obserwacji przycisk zachowuje się jak 'nie obserwuję'", () => {
    h.follows = undefined;
    renderButton();

    const button = screen.getByRole("button", { name: "Obserwuj" });
    expect(button).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(button);

    // Brak danych nie ma prawa wywrócić handlera - zapis leci z on:true.
    expect(h.mutations).toEqual([{ targetType: "author", targetId: "autor-1", on: true }]);
  });

  it("w trakcie zapisu przycisk jest zablokowany (bez podwójnego żądania)", () => {
    h.pending = true;
    renderButton();

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    fireEvent.click(button);

    expect(h.mutations).toEqual([]);
  });

  it("odmowa zapisu melduje się komunikatem - osobnym dla PL i EN", () => {
    h.failWith = "rls";
    const pl = renderButton("pl");
    fireEvent.click(screen.getByRole("button", { name: "Obserwuj" }));
    expect(h.toasts).toEqual(["Nie udało się"]);
    pl.unmount();

    h.toasts.length = 0;
    renderButton("en");
    fireEvent.click(screen.getByRole("button", { name: "Follow" }));
    expect(h.toasts).toEqual(["Something went wrong"]);
  });

  it("wariant angielski zmienia oba napisy stanu przycisku", () => {
    const off = renderButton("en");
    expect(screen.getByRole("button", { name: "Follow" })).toBeInTheDocument();
    off.unmount();

    h.follows = [follow("author", "autor-1")];
    renderButton("en");
    expect(screen.getByRole("button", { name: "Following" })).toBeInTheDocument();
  });
});
