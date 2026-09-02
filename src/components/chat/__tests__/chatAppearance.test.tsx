// Personalizacja rozmowy widziana oczami użytkownika: `ChatAppearanceDialog`
// (0/58 linii, 0/23 funkcji przed tym plikiem) i `EmojiPicker` (0/14 linii,
// 0/9 funkcji). Oba są końcówką tej samej ścieżki - wybór wyglądu wątku
// i wybór emotki - dlatego mieszkają w jednym pliku dowodowym.
//
// CO JEST PRZEDMIOTEM DOWODU.
//   1. Że KATALOG z `src/lib/chat/themes.ts` dociera do interfejsu w całości.
//      Ten moduł ma 100% pokrycia jako reguła (parzystość z CHECK-ami w bazie),
//      ale nigdy nie był sprawdzony NA RENDERZE: jeden zapomniany `.map`
//      i motyw istnieje w bazie, a użytkownik nie ma go czym wybrać. Tu
//      porównujemy listę opcji w dialogu z katalogiem pozycja po pozycji.
//   2. Że kliknięcie niesie do mutacji WŁAŚCIWĄ wartość bazową - z pułapką
//      wartości domyślnych: „Klasyczny" i „Kropki" jadą jako NULL, a szybka
//      emotka równa domyślnej też kasuje kolumnę `quick_emoji`.
//   3. Że odmowa serwera nazywa przyczynę i NIE zamyka dialogu (nie kasuje
//      kontekstu wyboru), a wyjście bez wyboru nie rusza serwera.
//   4. Że picker emoji da się obsłużyć wyszukiwarką i klawiaturowo: pole ma
//      etykietę, każdy przycisk emotki ma dostępną nazwę, a fraza bez trafień
//      pokazuje komunikat zamiast pustej siatki.
//
// ŚWIADOMIE POZA ZAKRESEM. Sam DATASET emoji i czysta funkcja `searchEmoji`
// (dopasowanie PL/EN, limit trafień) mają dowody w
// `src/lib/chat/__tests__/chatBuses.test.ts` - tutaj testujemy wyłącznie
// RENDER pickera i to, co picker z tej funkcji robi. Warstwa danych
// (`useSetConversationAppearance`, `useSetNickname`, `usePeerProfiles`) jest
// zamockowana: autoryzację zapisu trzymają RPC `chat_set_appearance`
// i `chat_set_nickname` (SECURITY DEFINER + RLS), a nie ten dialog.
//
// RODO: osoby zmyślone, identyfikatory z `CHAT_IDS`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "@/lib/i18n";
import "@/lib/i18n-chat";
import { chatPl } from "@/lib/i18n-chat";
import { CHAT_IDS, conversationView, peerProfile } from "@/test/chat/fixtures";
import {
  CHAT_THEMES,
  CHAT_WALLPAPERS,
  DEFAULT_QUICK_EMOJI,
  QUICK_EMOJI_CHOICES,
} from "@/lib/chat/themes";
import { EMOJI_CATEGORIES } from "@/lib/chat/emoji";
import type { NicknameIndex } from "@/lib/chat/nicknames";
import type { PeerProfile } from "@/lib/chat/types";

/** Opcje przekazywane do `mutate` per wywołanie (wariant react-query). */
interface MutateOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/** Atrapa mutacji: zapisuje ładunek i odgrywa werdykt serwera. */
interface MutationStub {
  calls: unknown[];
  outcome: { kind: "success" } | { kind: "error"; error: Error };
  isPending: boolean;
  mutate: (vars: unknown, options?: MutateOptions) => void;
}

const h = vi.hoisted(() => {
  const makeMutation = (): MutationStub => {
    const stub: MutationStub = {
      calls: [],
      outcome: { kind: "success" },
      isPending: false,
      mutate: (vars, options) => {
        stub.calls.push(vars);
        if (stub.outcome.kind === "success") options?.onSuccess?.();
        else options?.onError?.(stub.outcome.error);
      },
    };
    return stub;
  };
  return {
    user: null as { id: string } | null,
    profiles: null as ReadonlyMap<string, PeerProfile> | null,
    nicknames: new Map() as NicknameIndex,
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
    setAppearance: makeMutation(),
    setNickname: makeMutation(),
  };
});

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));

vi.mock("@/lib/chat/useConversations", () => ({
  usePeerProfiles: () => ({ data: h.profiles }),
  useSetConversationAppearance: () => h.setAppearance,
}));

// Częściowa atrapa: czyste `nicknameFor`/`buildNicknameIndex` zostają
// PRAWDZIWE (mają własne testy i to one rozstrzygają, co widać w wierszu),
// podmieniamy wyłącznie hooki chodzące do bazy.
vi.mock("@/lib/chat/nicknames", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/nicknames")>()),
  useNicknames: () => ({ data: h.nicknames }),
  useSetNickname: () => h.setNickname,
}));

vi.mock("sonner", () => ({ toast: h.toast }));

import { ChatAppearanceDialog, type ChatAppearanceDialogProps } from "../ChatAppearanceDialog";
import { EmojiPicker } from "../EmojiPicker";

const t = chatPl.chat;
const appearance = t.appearance;

function dialogProps(
  overrides: Partial<ChatAppearanceDialogProps> = {},
): ChatAppearanceDialogProps {
  return {
    view: conversationView(),
    open: true,
    onClose: vi.fn(),
    ...overrides,
  };
}

function renderDialog(overrides: Partial<ChatAppearanceDialogProps> = {}) {
  const props = dialogProps(overrides);
  const utils = render(<ChatAppearanceDialog {...props} />);
  return { ...utils, props };
}

/** Grupa wyboru o zadanej etykiecie (motyw / tapeta / szybka emotka). */
function radiogroup(label: string): HTMLElement {
  return screen.getByRole("radiogroup", { name: label });
}

/** Widoczne etykiety opcji w danej grupie - w kolejności renderu. */
function optionLabels(label: string): string[] {
  return within(radiogroup(label))
    .getAllByRole("radio")
    .map((radio) => radio.textContent?.trim() ?? "");
}

/** Opcja zaznaczona (`aria-checked`) w danej grupie - dokładnie jedna. */
function checkedLabel(label: string): string {
  const checked = within(radiogroup(label))
    .getAllByRole("radio")
    .filter((radio) => radio.getAttribute("aria-checked") === "true");
  if (checked.length !== 1) {
    throw new Error(
      `test: grupa "${label}" ma ${checked.length} zaznaczonych opcji zamiast jednej`,
    );
  }
  return checked[0].getAttribute("aria-label") ?? checked[0].textContent?.trim() ?? "";
}

function pick(group: string, option: string): void {
  fireEvent.click(within(radiogroup(group)).getByRole("radio", { name: option }));
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog", { name: /./ });
}

beforeEach(() => {
  h.user = { id: CHAT_IDS.me };
  h.profiles = new Map([
    [CHAT_IDS.me, peerProfile({ id: CHAT_IDS.me, display_name: "Zofia Testowa" })],
    [CHAT_IDS.peer, peerProfile({ id: CHAT_IDS.peer, display_name: "Anna Przykładowa" })],
  ]);
  h.nicknames = new Map();
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  h.toast.info.mockReset();
  for (const stub of [h.setAppearance, h.setNickname]) {
    stub.calls.length = 0;
    stub.outcome = { kind: "success" };
    stub.isPending = false;
  }
});

afterEach(() => cleanup());

describe("ChatAppearanceDialog - otwarcie i sekcje wyboru", () => {
  it("zamknięty dialog nie renderuje ANI JEDNEJ opcji w tle", () => {
    renderDialog({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText(appearance.title)).toBeNull();
  });

  it("otwarty pokazuje tytuł, notkę o wspólnym wyglądzie i trzy grupy wyboru", () => {
    renderDialog();
    expect(within(dialog()).getByText(appearance.title)).toBeTruthy();
    // Wspólny wygląd to nie kosmetyka: zmiana dotyka WSZYSTKICH uczestników,
    // więc ostrzeżenie musi być widoczne przy pierwszym kliknięciu.
    expect(within(dialog()).getByText(appearance.sharedHint)).toBeTruthy();

    for (const heading of [
      appearance.themeSection,
      appearance.wallpaperSection,
      appearance.quickEmojiSection,
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
      expect(radiogroup(heading)).toBeTruthy();
    }
  });

  it("podgląd pokazuje obie strony rozmowy, zanim cokolwiek zapiszemy", () => {
    renderDialog();
    const preview = screen.getByRole("region", { name: appearance.preview });
    expect(within(preview).getByText(appearance.previewIncoming)).toBeTruthy();
    expect(within(preview).getByText(appearance.previewOutgoing)).toBeTruthy();
    expect(h.setAppearance.calls).toEqual([]);
  });

  it("sekcja szybkiej emotki tłumaczy, kiedy emotka w ogóle się pokazuje", () => {
    renderDialog();
    expect(within(dialog()).getByText(appearance.quickEmojiHint)).toBeTruthy();
  });
});

describe("ChatAppearanceDialog - katalog z themes.ts dociera do interfejsu w całości", () => {
  it("lista motywów pokrywa się z CHAT_THEMES co do pozycji i etykiety", () => {
    renderDialog();
    expect(optionLabels(appearance.themeSection)).toEqual(
      CHAT_THEMES.map((id) => appearance.themes[id]),
    );
  });

  it("lista tapet pokrywa się z CHAT_WALLPAPERS co do pozycji i etykiety", () => {
    renderDialog();
    expect(optionLabels(appearance.wallpaperSection)).toEqual(
      CHAT_WALLPAPERS.map((id) => appearance.wallpapers[id]),
    );
  });

  it("lista szybkich emotek pokrywa się z QUICK_EMOJI_CHOICES", () => {
    renderDialog();
    const labels = within(radiogroup(appearance.quickEmojiSection))
      .getAllByRole("radio")
      .map((radio) => radio.getAttribute("aria-label") ?? "");
    expect(labels).toEqual([...QUICK_EMOJI_CHOICES]);
  });

  it("zaznaczenie odzwierciedla to, co siedzi w rozmowie - nie pierwszą pozycję listy", () => {
    renderDialog({
      view: conversationView({
        conversation: { theme: "forest", wallpaper: "lines", quick_emoji: "🔥" },
      }),
    });
    expect(checkedLabel(appearance.themeSection)).toBe(appearance.themes.forest);
    expect(checkedLabel(appearance.wallpaperSection)).toBe(appearance.wallpapers.lines);
    expect(checkedLabel(appearance.quickEmojiSection)).toBe("🔥");
  });

  it("nieznana wartość z bazy degraduje się do domyślnej, zamiast gasić zaznaczenie", () => {
    // Motyw usunięty z katalogu (albo wiersz sprzed migracji) nie może
    // zostawić grupy bez zaznaczenia - wtedy nie widać, co jest ustawione.
    renderDialog({
      view: conversationView({
        conversation: { theme: "neon-legacy", wallpaper: "marmur", quick_emoji: "   " },
      }),
    });
    expect(checkedLabel(appearance.themeSection)).toBe(appearance.themes.default);
    expect(checkedLabel(appearance.wallpaperSection)).toBe(appearance.wallpapers.dots);
    expect(checkedLabel(appearance.quickEmojiSection)).toBe(DEFAULT_QUICK_EMOJI);
  });
});

describe("ChatAppearanceDialog - zapis wyboru", () => {
  it("wybór motywu wysyła identyfikator rozmowy i wartość bazową motywu", () => {
    renderDialog();
    pick(appearance.themeSection, appearance.themes.ocean);
    expect(h.setAppearance.calls).toEqual([
      { conversationId: CHAT_IDS.conversation, theme: "ocean" },
    ]);
  });

  it("powrót do motywu klasycznego kasuje kolumnę (NULL), a nie zapisuje słowa „default”", () => {
    renderDialog({ view: conversationView({ conversation: { theme: "ocean" } }) });
    pick(appearance.themeSection, appearance.themes.default);
    expect(h.setAppearance.calls).toEqual([{ conversationId: CHAT_IDS.conversation, theme: null }]);
  });

  it("wybór tapety wysyła wartość bazową, a powrót do kropek kasuje kolumnę", () => {
    const { unmount } = renderDialog();
    pick(appearance.wallpaperSection, appearance.wallpapers.soft);
    expect(h.setAppearance.calls).toEqual([
      { conversationId: CHAT_IDS.conversation, wallpaper: "soft" },
    ]);
    unmount();

    h.setAppearance.calls.length = 0;
    renderDialog({ view: conversationView({ conversation: { wallpaper: "soft" } }) });
    pick(appearance.wallpaperSection, appearance.wallpapers.dots);
    expect(h.setAppearance.calls).toEqual([
      { conversationId: CHAT_IDS.conversation, wallpaper: null },
    ]);
  });

  it("wybór szybkiej emotki zapisuje TYLKO kolumnę quick_emoji", () => {
    renderDialog();
    pick(appearance.quickEmojiSection, "🔥");
    // Brak kluczy `theme`/`wallpaper` w ładunku ma znaczenie: RPC czyta ich
    // nieobecność jako sentinel „keep" i nie nadpisuje cudzego wyboru.
    expect(h.setAppearance.calls).toEqual([
      { conversationId: CHAT_IDS.conversation, quickEmoji: "🔥" },
    ]);
  });

  it("powrót do emotki domyślnej kasuje kolumnę quick_emoji", () => {
    renderDialog({ view: conversationView({ conversation: { quick_emoji: "🔥" } }) });
    pick(appearance.quickEmojiSection, DEFAULT_QUICK_EMOJI);
    expect(h.setAppearance.calls).toEqual([
      { conversationId: CHAT_IDS.conversation, quickEmoji: null },
    ]);
  });

  it("klik w opcję już aktywną NIE generuje żądania - nie płacimy za brak zmiany", () => {
    renderDialog({
      view: conversationView({
        conversation: { theme: "ocean", wallpaper: "lines", quick_emoji: "🔥" },
      }),
    });
    pick(appearance.themeSection, appearance.themes.ocean);
    pick(appearance.wallpaperSection, appearance.wallpapers.lines);
    pick(appearance.quickEmojiSection, "🔥");
    expect(h.setAppearance.calls).toEqual([]);
  });

  it("odmowa serwera nazywa przyczynę i ZOSTAWIA dialog otwarty", () => {
    h.setAppearance.outcome = { kind: "error", error: new Error("chat: appearance rejected") };
    const { props } = renderDialog();

    pick(appearance.themeSection, appearance.themes.midnight);

    expect(h.toast.error).toHaveBeenCalledWith(appearance.error);
    expect(h.toast.success).not.toHaveBeenCalled();
    // Dialog zostaje: użytkownik widzi swoje opcje i może spróbować ponownie.
    expect(dialog()).toBeTruthy();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(radiogroup(appearance.themeSection)).toBeTruthy();
  });

  it("po nieudanym zapisie kolejny wybór nadal dochodzi do serwera", () => {
    h.setAppearance.outcome = { kind: "error", error: new Error("chat: appearance rejected") };
    renderDialog();
    pick(appearance.themeSection, appearance.themes.rose);

    h.setAppearance.outcome = { kind: "success" };
    pick(appearance.wallpaperSection, appearance.wallpapers.none);

    expect(h.setAppearance.calls).toEqual([
      { conversationId: CHAT_IDS.conversation, theme: "rose" },
      { conversationId: CHAT_IDS.conversation, wallpaper: "none" },
    ]);
  });
});

describe("ChatAppearanceDialog - pseudonimy uczestników", () => {
  /** Wchodzi w tryb edycji pseudonimu danej osoby i zwraca pole tekstowe. */
  function startEdit(realName: string): HTMLElement {
    const label = i18n.t("chat.appearance.nicknameEdit", { name: realName });
    fireEvent.click(screen.getByRole("button", { name: label }));
    return screen.getByRole("textbox", { name: label });
  }

  it("lista składu pokazuje wszystkich uczestników wraz z wołającym", () => {
    renderDialog();
    const rows = within(screen.getByRole("list", { name: appearance.nicknamesSection }))
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Zofia Testowa");
    expect(rows[0]).toContain(t.you);
    expect(rows[1]).toContain("Anna Przykładowa");
  });

  it("pseudonim wypiera prawdziwe imię, ale imię zostaje widoczne pod spodem", () => {
    h.nicknames = new Map([[CHAT_IDS.conversation, new Map([[CHAT_IDS.peer, "Ekspertka"]])]]);
    renderDialog();
    const rows = within(
      screen.getByRole("list", { name: appearance.nicknamesSection }),
    ).getAllByRole("listitem");
    expect(rows[1].textContent).toContain("Ekspertka");
    expect(rows[1].textContent).toContain("Anna Przykładowa");
  });

  it("zapis pseudonimu leci przycięty, z rozmową i osobą, i potwierdza się komunikatem", () => {
    renderDialog();
    const input = startEdit("Anna Przykładowa");
    fireEvent.change(input, { target: { value: "  Ekspertka  " } });
    fireEvent.click(screen.getByRole("button", { name: appearance.nicknameSave }));

    expect(h.setNickname.calls).toEqual([
      { conversationId: CHAT_IDS.conversation, userId: CHAT_IDS.peer, nickname: "Ekspertka" },
    ]);
    expect(h.toast.success).toHaveBeenCalledWith(appearance.nicknameSaved);
  });

  it("wyczyszczenie pola kasuje pseudonim i mówi o tym innym komunikatem", () => {
    h.nicknames = new Map([[CHAT_IDS.conversation, new Map([[CHAT_IDS.peer, "Ekspertka"]])]]);
    renderDialog();
    const input = startEdit("Anna Przykładowa");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(h.setNickname.calls).toEqual([
      { conversationId: CHAT_IDS.conversation, userId: CHAT_IDS.peer, nickname: "" },
    ]);
    expect(h.toast.success).toHaveBeenCalledWith(appearance.nicknameCleared);
  });

  it("zapis bez zmiany nie dotyka serwera, ale zamyka edycję", () => {
    h.nicknames = new Map([[CHAT_IDS.conversation, new Map([[CHAT_IDS.peer, "Ekspertka"]])]]);
    renderDialog();
    const input = startEdit("Anna Przykładowa");
    fireEvent.change(input, { target: { value: "Ekspertka" } });
    fireEvent.click(screen.getByRole("button", { name: appearance.nicknameSave }));

    expect(h.setNickname.calls).toEqual([]);
    expect(
      screen.queryByRole("textbox", {
        name: i18n.t("chat.appearance.nicknameEdit", { name: "Anna Przykładowa" }),
      }),
    ).toBeNull();
  });

  it("Escape porzuca wpisany pseudonim i NIE zapisuje niczego", () => {
    renderDialog();
    const input = startEdit("Anna Przykładowa");
    fireEvent.change(input, { target: { value: "Pseudonim do porzucenia" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(h.setNickname.calls).toEqual([]);
    expect(screen.getByText("Anna Przykładowa")).toBeTruthy();
  });

  it("odmowa serwera przy pseudonimie nazywa przyczynę", () => {
    h.setNickname.outcome = { kind: "error", error: new Error("chat: nickname rejected") };
    renderDialog();
    fireEvent.change(startEdit("Anna Przykładowa"), { target: { value: "Ekspertka" } });
    fireEvent.click(screen.getByRole("button", { name: appearance.nicknameSave }));

    expect(h.toast.error).toHaveBeenCalledWith(appearance.nicknameError);
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("niewczytany profil daje placeholder zamiast pustego wiersza", () => {
    h.profiles = null;
    renderDialog();
    const rows = within(
      screen.getByRole("list", { name: appearance.nicknamesSection }),
    ).getAllByRole("listitem");
    expect(rows[1].textContent).toContain("...");
  });

  it("trwający zapis blokuje przycisk potwierdzenia - jedno kliknięcie to jedno żądanie", () => {
    h.setNickname.isPending = true;
    renderDialog();
    startEdit("Anna Przykładowa");
    expect(screen.getByRole("button", { name: appearance.nicknameSave })).toBeDisabled();
  });
});

describe("ChatAppearanceDialog - zamknięcie bez wyboru", () => {
  it("Escape zamyka dialog i NIE wysyła żadnej mutacji", () => {
    const { props } = renderDialog();
    fireEvent.keyDown(dialog(), { key: "Escape" });

    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(h.setAppearance.calls).toEqual([]);
    expect(h.setNickname.calls).toEqual([]);
  });

  it("samo obejrzenie sekcji niczego nie zapisuje", () => {
    const { props } = renderDialog();
    expect(optionLabels(appearance.themeSection).length).toBeGreaterThan(0);
    expect(h.setAppearance.calls).toEqual([]);
    expect(props.onClose).not.toHaveBeenCalled();
  });
});

/** Emotki widoczne w siatce pickera (dostępne nazwy przycisków). */
function gridEmojis(): string[] {
  return within(screen.getByRole("listbox", { name: t.emoji }))
    .getAllByRole("option")
    .map((option) => option.textContent?.trim() ?? "");
}

/** Wpisuje frazę do wyszukiwarki pickera. */
function search(value: string): void {
  fireEvent.change(screen.getByLabelText(t.emojiSearch), { target: { value } });
}

describe("EmojiPicker - siatka i kategorie", () => {
  it("otwarcie pokazuje pierwszą kategorię w całości i pasek wszystkich kategorii", () => {
    render(<EmojiPicker onPick={vi.fn()} />);
    const first = EMOJI_CATEGORIES[0];
    expect(gridEmojis()).toEqual(first.emojis.map((entry) => entry.e));

    const tabs = within(screen.getByRole("tablist", { name: t.emoji })).getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("aria-label"))).toEqual(
      EMOJI_CATEGORIES.map((category) => t.emojiCategories[category.id]),
    );
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  });

  it("klik w emotkę woła onPick DOKŁADNIE tą emotką", () => {
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} />);
    const chosen = EMOJI_CATEGORIES[0].emojis[0].e;

    fireEvent.click(screen.getByRole("option", { name: chosen }));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(chosen);
  });

  it("zmiana kategorii podmienia całą siatkę, nie dokleja emotek", () => {
    render(<EmojiPicker onPick={vi.fn()} />);
    const hearts = EMOJI_CATEGORIES.find((category) => category.id === "hearts");
    if (!hearts) throw new Error("test: dataset emoji nie ma kategorii serc");

    fireEvent.click(screen.getByRole("tab", { name: t.emojiCategories.hearts }));

    expect(gridEmojis()).toEqual(hearts.emojis.map((entry) => entry.e));
    expect(gridEmojis()).not.toContain(EMOJI_CATEGORIES[0].emojis[0].e);
    expect(
      screen.getByRole("tab", { name: t.emojiCategories.hearts }).getAttribute("aria-selected"),
    ).toBe("true");
  });
});

describe("EmojiPicker - wyszukiwanie", () => {
  it("fraza zawęża siatkę do trafień i chowa pasek kategorii", () => {
    render(<EmojiPicker onPick={vi.fn()} />);
    const categorySize = gridEmojis().length;

    search("pizza");

    const hits = gridEmojis();
    expect(hits).toContain("🍕");
    expect(hits).not.toContain(EMOJI_CATEGORIES[0].emojis[0].e);
    expect(hits.length).toBeLessThan(categorySize);
    // Pasek kategorii znika: w wynikach wyszukiwania nie ma „aktywnej" zakładki.
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("fraza szuka też po polskich słowach kluczowych, nie tylko po angielskich", () => {
    render(<EmojiPicker onPick={vi.fn()} />);
    search("rakieta");
    expect(gridEmojis()).toContain("🚀");
  });

  it("klik w wynik wyszukiwania też woła onPick", () => {
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} />);
    search("pizza");

    fireEvent.click(screen.getByRole("option", { name: "🍕" }));

    expect(onPick).toHaveBeenCalledWith("🍕");
  });

  it("fraza bez trafień pokazuje komunikat zamiast pustej siatki", () => {
    render(<EmojiPicker onPick={vi.fn()} />);
    search("xyzqvw");

    expect(screen.getByText(t.emojiNoResults)).toBeTruthy();
    expect(screen.queryByRole("listbox", { name: t.emoji })).toBeNull();
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("wyczyszczenie frazy wraca do widoku kategorii - bez utraty wybranej zakładki", () => {
    render(<EmojiPicker onPick={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: t.emojiCategories.food }));
    const foodGrid = gridEmojis();

    search("pizza");
    search("");

    expect(screen.getByRole("tablist", { name: t.emoji })).toBeTruthy();
    expect(gridEmojis()).toEqual(foodGrid);
  });

  it("same spacje to nie wyszukiwanie - siatka kategorii zostaje", () => {
    render(<EmojiPicker onPick={vi.fn()} />);
    search("   ");

    expect(screen.getByRole("tablist", { name: t.emoji })).toBeTruthy();
    expect(gridEmojis()).toEqual(EMOJI_CATEGORIES[0].emojis.map((entry) => entry.e));
    expect(screen.queryByText(t.emojiNoResults)).toBeNull();
  });
});

describe("EmojiPicker - dostępność", () => {
  it("pole wyszukiwania ma etykietę, a nie tylko placeholder", () => {
    render(<EmojiPicker onPick={vi.fn()} />);
    const input = screen.getByLabelText(t.emojiSearch);
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("placeholder", t.emojiSearch);
  });

  it("każdy przycisk emotki ma dostępną nazwę - czytnik ekranu nie czyta pustych pól", () => {
    render(<EmojiPicker onPick={vi.fn()} />);
    const options = within(screen.getByRole("listbox", { name: t.emoji })).getAllByRole("option");
    expect(options.length).toBe(EMOJI_CATEGORIES[0].emojis.length);
    for (const option of options) {
      expect((option.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
    // Ikona lupy jest dekoracją - znaczenie niesie etykieta pola.
    const icon = screen.getByLabelText(t.emojiSearch).parentElement?.querySelector("svg");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("zakładki kategorii są opisane słowem, nie samą ikoną emoji", () => {
    render(<EmojiPicker onPick={vi.fn()} />);
    for (const category of EMOJI_CATEGORIES) {
      expect(screen.getByRole("tab", { name: t.emojiCategories[category.id] })).toBeTruthy();
    }
  });
});
