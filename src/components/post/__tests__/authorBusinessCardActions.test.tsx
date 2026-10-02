// WIZYTÓWKA AUTORA W SIDEBARZE WPISU - akcje i linki.
//
// `AuthorBusinessCard.test.tsx` obok pilnuje układu (avatar, meta, etykiety).
// Ten plik dotyka tego, co czytelnik KLIKA:
//  1. „Obserwuj autora": gość dostaje okno logowania z tekstami personalizacji,
//     zalogowany przełącza obserwację (on:true / on:false wg listy obserwacji
//     zawężonej do typu „author"), odmowa zapisu melduje się toastem w języku
//     wpisu, a zapis w toku blokuje przycisk.
//  2. KAFELKI SOCIAL: tylko bezpieczne schematy. `safeUrl` bez drugiego
//     argumentu zwraca "#", więc wcześniej adres `javascript:` stawał się
//     kafelkiem otwierającym bieżącą stronę w nowej karcie, a strażnik
//     `if (!url) return null` przy własnych linkach był martwy.
//  3. AVATAR bez adresu profilu nie jest linkiem donikąd, a inicjały biorą
//     pierwszą LITERĘ członu (emoji nie rozpada się na połówkę pary UTF-16).
//
// CO JEST ZAATRAPOWANE: sesja, ustawienia personalizacji, warstwa obserwacji,
// `sonner` i `BrandIcon` (pobiera bibliotekę ikon z bazy - ma własne testy).
// Magistrala okna logowania zostaje PRAWDZIWA.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import {
  DEFAULT_PERSONALIZED_SETTINGS,
  type PersonalizedSettings,
} from "@/hooks/usePersonalizedSettings";

interface ToggleInput {
  targetType: string;
  targetId: string;
  on: boolean;
}

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  settings: null as PersonalizedSettings | null,
  follows: undefined as
    undefined | Array<{ id: string; target_type: string; target_id: string; created_at: string }>,
  pending: false,
  failWith: null as string | null,
  mutations: [] as ToggleInput[],
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
    mutate: (input: ToggleInput, opts?: { onError?: (error: Error) => void }) => {
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
  },
}));

vi.mock("@/components/atoms/BrandIcon", () => ({
  BrandIcon: ({ name }: { name: string }) => <span data-brand-icon={name} />,
}));

import { onOpenLoginPopup, type LoginPopupOptions } from "@/lib/loginPopupBus";
import { AuthorBusinessCard } from "@/components/post/AuthorBusinessCard";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

type CardProps = ComponentProps<typeof AuthorBusinessCard>;

function renderCard(over: Partial<CardProps> = {}) {
  return renderWithQueryClient(
    <AuthorBusinessCard lang="pl" name="Anna Nowak" authorId="author-1" {...over} />,
  );
}

const follow = (targetType: string, targetId: string) => ({
  id: `f-${targetType}-${targetId}`,
  target_type: targetType,
  target_id: targetId,
  created_at: "fixture",
});

beforeEach(() => {
  h.user = { id: "reader-1" };
  h.settings = { ...DEFAULT_PERSONALIZED_SETTINGS };
  h.follows = [];
  h.pending = false;
  h.failWith = null;
  h.mutations.length = 0;
  h.toasts.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("AuthorBusinessCard - obserwowanie autora", () => {
  it("bez identyfikatora autora albo z wyłączoną flagą nagłówka nie ma przycisku", () => {
    const anonymous = renderCard({ authorId: null });
    expect(screen.queryByRole("button")).toBeNull();
    anonymous.unmount();

    h.settings = { ...DEFAULT_PERSONALIZED_SETTINGS, followInAuthorHeader: false };
    renderCard();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("gość dostaje okno logowania z tekstami personalizacji zamiast zapisu", () => {
    h.user = null;
    h.settings = {
      ...DEFAULT_PERSONALIZED_SETTINGS,
      restrictedTitle: "Dołącz do nas",
      restrictedDescription: "Konto pozwala obserwować autorów.",
    };
    const seen: LoginPopupOptions[] = [];
    const off = onOpenLoginPopup((opts) => seen.push(opts));
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Obserwuj autora" }));
    off();

    expect(seen).toEqual([
      { title: "Dołącz do nas", description: "Konto pozwala obserwować autorów." },
    ]);
    expect(h.mutations).toEqual([]);
  });

  it("zalogowany, który nie obserwuje TEGO autora, zapisuje obserwację (on:true)", () => {
    // Ten sam identyfikator jako KATEGORIA nie jest obserwacją autora.
    h.follows = [follow("category", "author-1"), follow("author", "inny-autor")];
    renderCard();
    const button = screen.getByRole("button", { name: "Obserwuj autora" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAttribute("title", "Otrzymuj powiadomienia o nowych publikacjach");
    fireEvent.click(button);

    expect(h.mutations).toEqual([{ targetType: "author", targetId: "author-1", on: true }]);
  });

  it("kto już obserwuje autora, widzi stan wciśnięty i odpisuje się (on:false)", () => {
    h.follows = [follow("author", "author-1")];
    renderCard();
    const button = screen.getByRole("button", { name: "Obserwujesz" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveTextContent("Obserwujesz");
    fireEvent.click(button);

    expect(h.mutations).toEqual([{ targetType: "author", targetId: "author-1", on: false }]);
  });

  it("lista obserwacji jeszcze niewczytana: stan „nie obserwuję” i działający zapis", () => {
    h.follows = undefined;
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Obserwuj autora" }));
    expect(h.mutations).toEqual([{ targetType: "author", targetId: "author-1", on: true }]);
  });

  it("odmowa zapisu melduje się komunikatem w języku wpisu", () => {
    h.failWith = "rls";
    const pl = renderCard();
    fireEvent.click(screen.getByRole("button"));
    pl.unmount();
    renderCard({ lang: "en" });
    fireEvent.click(screen.getByRole("button", { name: "Follow author" }));

    expect(h.toasts).toEqual([
      "Nie udało się zaktualizować obserwacji",
      "Could not update follow state",
    ]);
    expect(h.mutations).toHaveLength(2);
  });

  it("zapis w toku blokuje przycisk - bez podwójnego żądania", () => {
    h.pending = true;
    renderCard();
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(h.mutations).toEqual([]);
  });
});

describe("AuthorBusinessCard - linki i kafelki", () => {
  it("kafelek social z adresem `javascript:` znika, bezpieczne otwierają się w nowej karcie", () => {
    renderCard({
      linkedinUrl: "javascript:alert(1)",
      xUrl: "https://x.com/anna",
      websiteUrl: "https://anna.example.org",
    });
    expect(screen.queryByLabelText("LinkedIn")).toBeNull();
    const x = screen.getByRole("link", { name: "X" });
    expect(x).toHaveAttribute("href", "https://x.com/anna");
    expect(x).toHaveAttribute("target", "_blank");
    expect(x).toHaveAttribute("rel", "noreferrer noopener");
    expect(screen.getByRole("link", { name: "Website" })).toHaveAttribute(
      "href",
      "https://anna.example.org",
    );
  });

  it("same niebezpieczne adresy nie zostawiają pustego paska kafelków", () => {
    renderCard({ facebookUrl: "javascript:void(0)", authorId: null });
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.querySelector("[data-brand-icon]")).toBeNull();
  });

  it("same niebezpieczne WŁASNE linki też nie zostawiają pustego paska", () => {
    renderCard({ authorId: null, customSocials: [{ label: "Zły", url: "javascript:alert(1)" }] });
    const card = screen.getByRole("complementary", { name: "O autorze" });
    expect(screen.queryByRole("link")).toBeNull();
    // Zostaje tylko nagłówek wizytówki - bez obserwacji i bez pustego paska kafelków.
    expect(card.children).toHaveLength(1);
  });

  it("własne linki: ikona z adresu albo globus, niebezpieczny adres pominięty", () => {
    renderCard({
      customSocials: [
        { label: "Substack", url: "https://anna.substack.com", iconUrl: "/icons/substack.svg" },
        { label: "Zły", url: "javascript:alert(1)" },
        { label: "Blog", url: "https://blog.example.org" },
      ],
    });
    const substack = screen.getByRole("link", { name: "Substack" });
    expect(substack).toHaveAttribute("href", "https://anna.substack.com");
    expect(within(substack).getByRole("img", { name: "Substack" })).toHaveAttribute(
      "src",
      "/icons/substack.svg",
    );
    const blog = screen.getByRole("link", { name: "Blog" });
    expect(blog).toHaveAttribute("target", "_blank");
    expect(within(blog).queryByRole("img")).toBeNull();
    expect(blog.querySelector("svg")).not.toBeNull();
    expect(screen.queryByLabelText("Zły")).toBeNull();
  });

  it("avatar bez adresu profilu nie jest linkiem donikąd", () => {
    renderCard({ avatarUrl: "https://cdn.example.com/anna.jpg", href: null });
    expect(screen.getByRole("img", { name: "Anna Nowak" })).toHaveAttribute(
      "src",
      "https://cdn.example.com/anna.jpg",
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("avatar z adresem profilu prowadzi na profil", () => {
    renderCard({ avatarUrl: "https://cdn.example.com/anna.jpg", href: "/author/anna" });
    // Avatar i nazwa w nagłówku to dwa linki o tej samej nazwie - oba na profil.
    const links = screen.getAllByRole("link", { name: "Anna Nowak" });
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/author/anna", "/author/anna"]);
    expect(within(links[0]).getByRole("img")).toHaveAttribute("alt", "Anna Nowak");
  });
});

describe("AuthorBusinessCard - inicjały i nazwa zapasowa", () => {
  it("inicjały biorą pierwszą LITERĘ członu - emoji nie zostawia połówki znaku", () => {
    renderCard({ name: "🇪🇺 Jan Kowalski" });
    const tile = screen.getByText("JK");
    expect(tile.textContent).toBe("JK");
    expect(tile.textContent).not.toMatch(/[\uD800-\uDFFF]/);
  });

  it("nazwa bez liter daje ikonę osoby zamiast pustego kafelka", () => {
    // Bez przycisku obserwacji jedyną ikoną SVG w karcie jest kafelek osoby.
    const { container } = renderCard({ name: "🙂 🙂", authorId: null });
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("🙂 🙂");
    expect(container.querySelector(".font-display")).toBeNull();
    expect(container.querySelector("svg[aria-hidden]")).not.toBeNull();
  });

  it("brak nazwy: zapasowe „Autor”/„Author” i ich inicjał", () => {
    const pl = renderCard({ name: "   " });
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Autor");
    expect(screen.getByText("A")).toBeInTheDocument();
    pl.unmount();
    renderCard({ name: null, lang: "en" });
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Author");
  });
});
