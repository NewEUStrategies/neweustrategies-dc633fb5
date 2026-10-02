// Współdzielone skróty klawiszowe szybkiego formatowania markdown w kompozytorach
// (komentarze + pola "wiadomość" w widgetach formularzy).
//
// Jedno źródło prawdy: mapowanie akcja -> kombinacja klawiszy oraz czytelna
// podpowiedź (⌘ na macOS, Ctrl gdzie indziej) pokazywana w tooltipie paska.
// Zestaw kombinacji jest zgodny z GitHub/Word, żeby nie zaskakiwać użytkownika.

export type MarkdownActionId =
  "bold" | "italic" | "bulletList" | "numberedList" | "quote" | "code" | "link";

interface ShortcutBinding {
  /** Klawisz bazowy (porównanie bez rozróżniania wielkości liter). */
  key: string;
  /** Fizyczny klawisz (`KeyboardEvent.code`) - patrz `keyMatches`. */
  code: string;
  /** Wymagany Shift. */
  shift?: boolean;
  /** Etykieta klawisza w podpowiedzi (gdy różna od `key`). */
  hintKey?: string;
}

const MARKDOWN_SHORTCUTS: Readonly<Record<MarkdownActionId, ShortcutBinding>> = {
  bold: { key: "b", code: "KeyB", hintKey: "B" },
  italic: { key: "i", code: "KeyI", hintKey: "I" },
  bulletList: { key: "8", code: "Digit8", shift: true },
  numberedList: { key: "7", code: "Digit7", shift: true },
  quote: { key: ".", code: "Period", shift: true },
  code: { key: "e", code: "KeyE", hintKey: "E" },
  link: { key: "k", code: "KeyK", hintKey: "K" },
};

export interface ShortcutEventLike {
  key: string;
  /** Fizyczny klawisz; zdarzenia syntetyczne (autouzupełnianie) go nie mają. */
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Litera albo cyfra łacińska - znak, który `key` daje na układzie łacińskim. */
const LATIN_KEY = /^[a-z0-9]$/;

/**
 * Czy zdarzenie trafia w wiązanie.
 *
 * SHIFT ZMIENIA ZNAK. `e.key` to znak, który klawisz WPISAŁBY: Shift+8 daje
 * „*", Shift+7 - „&", Shift+. - „>" (układ US i polski programisty). Do tej
 * zmiany porównywaliśmy wyłącznie `key`, więc listy i cytat działały tylko
 * w teście, który podawał `key: "8"` razem z `shiftKey: true` - przeglądarka
 * takiego zdarzenia nie wysyła. Dla wiązań z Shiftem rozstrzyga więc fizyczny
 * klawisz (`code`).
 *
 * UKŁAD NIEŁACIŃSKI. Na cyrylicy Ctrl+B daje `key` „и" przy `code` „KeyB" -
 * wtedy też rozstrzyga klawisz fizyczny. Przy literze łacińskiej NIE: na
 * Dvoraku fizyczne „KeyB" to „x", a Ctrl+X ma zostać wycinaniem.
 */
function keyMatches(binding: ShortcutBinding, e: ShortcutEventLike, key: string): boolean {
  if (binding.key === key) return true;
  if (e.code !== binding.code) return false;
  return binding.shift === true || !LATIN_KEY.test(key);
}

/**
 * Zwraca id akcji formatowania dla zdarzenia klawiatury albo `null`.
 * Modyfikator: Cmd (macOS) lub Ctrl. Alt nigdy nie bierze udziału - kolidowałby
 * z wprowadzaniem znaków diakrytycznych.
 */
export function matchMarkdownShortcut(e: ShortcutEventLike): MarkdownActionId | null {
  if (e.altKey) return null;
  if (!e.metaKey && !e.ctrlKey) return null;
  // Cmd i Ctrl jednocześnie to nie jest zwykły skrót formatowania.
  if (e.metaKey && e.ctrlKey) return null;
  const key = e.key.toLowerCase();
  for (const [id, binding] of Object.entries(MARKDOWN_SHORTCUTS) as [
    MarkdownActionId,
    ShortcutBinding,
  ][]) {
    if (Boolean(binding.shift) !== e.shiftKey) continue;
    if (keyMatches(binding, e, key)) return id;
  }
  return null;
}

/** Czy bieżąca platforma używa Cmd (⌘) zamiast Ctrl. */
export function isAppleShortcutPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const source = `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
  return /mac|iphone|ipad|ipod/i.test(source);
}

/** Czytelna podpowiedź skrótu, np. "⌘B" albo "Ctrl+Shift+8". */
export function formatShortcutHint(id: MarkdownActionId, apple: boolean): string {
  const binding = MARKDOWN_SHORTCUTS[id];
  const label = binding.hintKey ?? binding.key.toUpperCase();
  const parts = apple ? ["⌘"] : ["Ctrl"];
  if (binding.shift) parts.push(apple ? "⇧" : "Shift");
  parts.push(label);
  return apple ? parts.join("") : parts.join("+");
}
