// Powłoka kompozytora - `ComposerShell`.
//
// CO TEN PLIK DOWODZI.
// (1) SKRÓT DZIAŁA WSZĘDZIE, GDZIE PASEK GO OGŁASZA. Pasek mówi „Pogrubienie
//     (Ctrl+B)" także w kompozytorze komentarza (`MentionTextarea` w
//     `CommentComposerShell`), a do tej zmiany skrót obsługiwało tylko pole
//     formularza. Regresja była cicha: przycisk działał, etykieta kłamała.
// (2) ZDARZENIA SĄ TAKIE, JAKIE WYSYŁA PRZEGLĄDARKA. Ctrl+Shift+8 to `key: "*"`
//     z `code: "Digit8"`, a nie `key: "8"` - stara suita podawała to drugie
//     i dlatego przepuściła listy i cytat, które w przeglądarce nie działały.
// (3) POLE MA PIERWSZEŃSTWO. Skrót nie wchodzi, gdy pole treści zablokowało
//     domyślną akcję (nawigacja po podpowiedziach @wzmianek), ani gdy klawisz
//     padł w innym polu powłoki (temat, imię gościa).
// (4) LIMIT JEST TWARDY także dla formatowania - znacznik, który przebiłby
//     `maxLength`, nie wchodzi wcale (a nie wchodzi i zostaje ucięty).
// (5) HYDRATACJA NIE ROZJEŻDŻA ETYKIET. Serwer nie zna platformy, więc pierwszy
//     render ma „Ctrl+B" także na Macu; skrót platformy wchodzi po hydratacji.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (a) `applyMarkdown` jako funkcji czystej - `CommentComposerShell.test.tsx`.
// (b) Reguł `validateComposerValue` - `src/lib/composer/__tests__/validation.test.ts`;
//     tu sprawdzamy tylko, że powłoka je wyświetla i zgłasza.
// (c) Tabeli wiązań klawiszy - `src/lib/composer/__tests__/shortcuts.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { useRef, useState, type KeyboardEvent } from "react";
import "@/lib/i18n";
import type { MentionSuggestion } from "@/lib/mentions/useMentionSuggestions";
import type { ComposerValidation } from "@/lib/composer/validation";

const { suggestions } = vi.hoisted(() => ({ suggestions: { current: [] as unknown[] } }));
vi.mock("@/lib/mentions/useMentionSuggestions", () => ({
  MENTION_SUGGESTION_LIMIT: 6,
  useMentionSuggestions: (query: string | null) => ({
    data: query === null ? [] : suggestions.current,
    isFetching: false,
  }),
}));

import { ComposerShell, type ComposerShellProps } from "@/components/composer/ComposerShell";
import { CommentComposerShell } from "@/components/comments/CommentComposerShell";
import { MentionTextarea } from "@/components/mentions/MentionTextarea";

const JAN: MentionSuggestion = {
  kind: "person",
  slug: "jan-kowalski",
  name: "Jan Kowalski",
  avatarUrl: null,
  logoUrl: null,
  website: null,
  subtitle: null,
  verified: false,
};

beforeEach(() => {
  suggestions.current = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type HarnessProps = Partial<Omit<ComposerShellProps, "value" | "onValueChange" | "textareaRef">> & {
  initial?: string;
  /** Własny handler pola - np. pole, które samo obsłużyło klawisz. */
  onFieldKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
};

/** Gołe pole w powłoce: bez `formatterRef` i bez własnej obsługi skrótów. */
function Harness({ initial = "tekst", onFieldKeyDown, ...props }: HarnessProps) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  return (
    <ComposerShell
      value={value}
      onValueChange={setValue}
      textareaRef={ref}
      maxLength={100}
      {...props}
    >
      <input aria-label="Temat" defaultValue="temat" />
      <textarea
        aria-label="Treść"
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onFieldKeyDown}
      />
    </ComposerShell>
  );
}

function body(): HTMLTextAreaElement {
  return screen.getByLabelText("Treść") as HTMLTextAreaElement;
}

function selectAll(box: HTMLTextAreaElement) {
  box.setSelectionRange(0, box.value.length);
}

/** Zdarzenia w kształcie, w jakim wysyła je przeglądarka (układ US / polski). */
const KEYS = {
  bold: { key: "b", code: "KeyB", ctrlKey: true },
  bullet: { key: "*", code: "Digit8", ctrlKey: true, shiftKey: true },
  numbered: { key: "&", code: "Digit7", ctrlKey: true, shiftKey: true },
  quote: { key: ">", code: "Period", ctrlKey: true, shiftKey: true },
  link: { key: "k", code: "KeyK", metaKey: true },
} as const;

// ---------------------------------------------------------------------------
// Skróty klawiszowe obsługuje powłoka
// ---------------------------------------------------------------------------

describe("ComposerShell - skróty w polu treści", () => {
  it("Ctrl+B pogrubia zaznaczenie BEZ żadnej obsługi skrótów w polu", () => {
    render(<Harness />);
    selectAll(body());

    fireEvent.keyDown(body(), KEYS.bold);

    expect(body().value).toBe("**tekst**");
  });

  it.each([
    ["Ctrl+Shift+8 (`*`)", KEYS.bullet, "a\nb", "- a\n- b"],
    ["Ctrl+Shift+7 (`&`)", KEYS.numbered, "a\nb", "1. a\n2. b"],
    ["Ctrl+Shift+. (`>`)", KEYS.quote, "cytat", "> cytat"],
  ])("%s działa na zdarzeniu z przeglądarki", (_opis, event, initial, expected) => {
    // Regresja, którą to łapie: dopasowanie wyłącznie po `key`. Przeglądarka
    // przy Shifcie podaje znak z Shiftem, więc te trzy skróty nie działały.
    render(<Harness initial={initial} />);
    selectAll(body());

    fireEvent.keyDown(body(), event);

    expect(body().value).toBe(expected);
  });

  it("Cmd+K wstawia szkielet odnośnika i PO RENDERZE stawia kursor przed adresem", () => {
    // Klatka animacji biegnie w przeglądarce dopiero po renderze nowej treści.
    // Synchroniczna atrapa ustawiałaby kursor w STAREJ wartości, którą React
    // zaraz nadpisuje - więc tu klatki zbieramy i puszczamy po renderze.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    render(<Harness initial="link" />);
    selectAll(body());

    fireEvent.keyDown(body(), KEYS.link);
    expect(body().value).toBe("[link](https://)");
    act(() => frames.splice(0).forEach((cb) => cb(0)));

    expect(body().selectionStart).toBe("[link".length);
    expect(body().selectionEnd).toBe("[link".length);
    expect(document.activeElement).toBe(body());
  });

  it("skrót blokuje domyślną akcję przeglądarki (Ctrl+K to pasek wyszukiwania)", () => {
    render(<Harness />);

    const notCancelled = fireEvent.keyDown(body(), KEYS.link);

    expect(notCancelled).toBe(false);
  });

  it("zwykłe pisanie i nieznany skrót przechodzą bez zmian i bez blokady", () => {
    render(<Harness />);
    selectAll(body());

    expect(fireEvent.keyDown(body(), { key: "b", code: "KeyB" })).toBe(true);
    expect(fireEvent.keyDown(body(), { key: "s", code: "KeyS", ctrlKey: true })).toBe(true);
    expect(body().value).toBe("tekst");
  });

  it("klawisz w INNYM polu powłoki nie formatuje treści", () => {
    render(<Harness />);
    const subject = screen.getByLabelText("Temat");

    const notCancelled = fireEvent.keyDown(subject, KEYS.bold);

    expect(notCancelled).toBe(true);
    expect(body().value).toBe("tekst");
  });

  it("pole, które samo obsłużyło klawisz, ma pierwszeństwo przed skrótem", () => {
    render(<Harness onFieldKeyDown={(e) => e.preventDefault()} />);
    selectAll(body());

    fireEvent.keyDown(body(), KEYS.bold);

    expect(body().value).toBe("tekst");
  });

  it("formatowanie, które przebiłoby limit, nie wchodzi wcale", () => {
    render(<Harness initial="abc" maxLength={5} />);
    selectAll(body());

    fireEvent.keyDown(body(), KEYS.bold);

    // „**abc**" ma 7 znaków przy limicie 5 - zostaje oryginał, nie ucięty znacznik.
    expect(body().value).toBe("abc");
  });
});

// ---------------------------------------------------------------------------
// Kompozytor komentarza - złożenie z CommentsSection
// ---------------------------------------------------------------------------

function CommentHarness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  return (
    <CommentComposerShell value={value} onValueChange={setValue} textareaRef={ref} maxLength={500}>
      <MentionTextarea
        label="Komentarz"
        value={value}
        onChange={setValue}
        lang="pl"
        textareaRef={ref}
      />
    </CommentComposerShell>
  );
}

describe("CommentComposerShell + MentionTextarea", () => {
  function comment(): HTMLTextAreaElement {
    return screen.getByRole("combobox") as HTMLTextAreaElement;
  }

  it("ogłoszony w pasku Ctrl+B naprawdę pogrubia treść komentarza", () => {
    // Regresja, którą to łapie: pasek komentarza ogłaszał skróty, których nikt
    // nie obsługiwał - obsługiwało je wyłącznie pole formularza.
    render(<CommentHarness initial="ważne" />);
    expect(screen.getByRole("button", { name: /\(Ctrl\+B\)|\(⌘B\)/ })).toBeInTheDocument();
    selectAll(comment());

    fireEvent.keyDown(comment(), KEYS.bold);

    expect(comment().value).toBe("**ważne**");
  });

  it("przy otwartej liście @wzmianek Enter wybiera osobę, a nie formatuje", () => {
    suggestions.current = [JAN];
    render(<CommentHarness />);
    fireEvent.change(comment(), { target: { value: "@ja", selectionStart: 3, selectionEnd: 3 } });
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(comment(), { key: "Enter", code: "Enter" });

    expect(comment().value).toBe("@jan-kowalski ");
  });
});

// ---------------------------------------------------------------------------
// Pasek, licznik, walidacja
// ---------------------------------------------------------------------------

describe("ComposerShell - pasek i walidacja", () => {
  it("przycisk listy numerowanej numeruje KAŻDĄ linię zaznaczenia", () => {
    render(<Harness initial={"pierwszy\ndrugi\ntrzeci"} />);
    selectAll(body());

    fireEvent.click(screen.getByRole("button", { name: /numerowana|numbered/i }));

    expect(body().value).toBe("1. pierwszy\n2. drugi\n3. trzeci");
  });

  it("„wyczyść” jest nieaktywne przy pustej treści", () => {
    render(<Harness initial="" />);

    expect(screen.getByRole("button", { name: /wyczyść|clear/i })).toBeDisabled();
  });

  it("licznik przechodzi w kolor błędu dopiero PONAD limitem", () => {
    const { rerender } = render(<Harness initial="12345" maxLength={5} />);
    expect(screen.getByText("5/5")).not.toHaveClass("text-destructive");

    rerender(<Harness initial="12345" maxLength={4} />);
    // `initial` żyje w stanie - ponowny render nie zmienia treści, tylko limit.
    expect(screen.getByText("5/4")).toHaveClass("text-destructive");
  });

  it("komunikat o zbyt krótkiej treści trafia do regionu `status`", () => {
    render(<Harness initial="ab" minLength={5} statusId="status-id" />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("id", "status-id");
    expect(status.textContent).not.toBe("");
  });

  it("akcje w wariancie funkcyjnym dostają wynik walidacji", () => {
    render(
      <Harness
        initial="ok"
        actions={(v: ComposerValidation) => (
          <button type="button" disabled={v.submitDisabled}>
            wyślij
          </button>
        )}
        initialValue="ok"
      />,
    );

    // Tryb edycji bez zmian - wysyłka zablokowana.
    expect(screen.getByRole("button", { name: "wyślij" })).toBeDisabled();
    fireEvent.change(body(), { target: { value: "ok!" } });
    expect(screen.getByRole("button", { name: "wyślij" })).toBeEnabled();
  });

  it("zgłasza zmianę walidacji RAZ na zmianę stanu, nie na każdy znak", () => {
    const onValidationChange = vi.fn();
    render(<Harness initial="" onValidationChange={onValidationChange} />);
    expect(onValidationChange).toHaveBeenCalledTimes(1);
    expect(onValidationChange.mock.calls[0]?.[0]).toMatchObject({ status: "empty" });

    fireEvent.change(body(), { target: { value: "a" } });
    fireEvent.change(body(), { target: { value: "ab" } });
    fireEvent.change(body(), { target: { value: "abc" } });

    expect(onValidationChange).toHaveBeenCalledTimes(2);
    expect(onValidationChange.mock.calls[1]?.[0]).toMatchObject({ status: "ok" });
  });
});

// ---------------------------------------------------------------------------
// Hydratacja podpowiedzi skrótów
// ---------------------------------------------------------------------------

describe("ComposerShell - podpowiedź platformy", () => {
  it("serwer i hydratacja mówią „Ctrl+B”, a Mac dostaje „⌘B” dopiero po niej", async () => {
    // Regresja, którą to łapie: `useMemo(isAppleShortcutPlatform)` liczony już
    // w pierwszym renderze klienta - na Macu „⌘B" kontra „Ctrl+B" z serwera,
    // a React 19 rozjazdu atrybutu nie łata.
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const html = renderToString(<Harness />);
    expect(html).toContain("(Ctrl+B)");

    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    const root = await act(async () => hydrateRoot(host, <Harness />));

    expect(
      host.querySelector('[aria-label="Pogrubienie (⌘B)"], [aria-label="Bold (⌘B)"]'),
    ).not.toBeNull();
    expect(errors).not.toHaveBeenCalled();
    act(() => root.unmount());
    host.remove();
  });
});
