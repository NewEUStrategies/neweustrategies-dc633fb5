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

/** Dowolna litera (każdego pisma). */
const ANY_LETTER = /^\p{L}$/u;

/**
 * Czy zdarzenie trafia w wiązanie.
 *
 * SHIFT ZMIENIA ZNAK. `e.key` to znak, który klawisz WPISAŁBY: Shift+8 daje
 * „*", Shift+7 - „&", Shift+. - „>" (układ US i polski programisty). Do tej
 * zmiany porównywaliśmy wyłącznie `key`, więc listy i cytat działały tylko
 * w teście, który podawał `key: "8"` razem z `shiftKey: true` - przeglądarka
 * takiego zdarzenia nie wysyła. Dla wiązań z Shiftem rozstrzyga więc fizyczny
 * klawisz (`code`), gdy Shift dał na nim symbol albo literę innego pisma.
 *
 * UKŁAD NIEŁACIŃSKI. Na cyrylicy Ctrl+B daje `key` „и" przy `code` „KeyB" -
 * wtedy też rozstrzyga klawisz fizyczny.
 *
 * ŁACIŃSKA LITERA ALBO CYFRA NIGDY NIE IDZIE PO `code`. Na Dvoraku fizyczne
 * „KeyB" to „x" (Ctrl+X ma wycinać), a fizyczna kropka to „v" - Ctrl+Shift+V
 * (wklej bez formatowania) nie może zostać cytatem.
 *
 * `key` MUSI BYĆ JEDNYM ZNAKIEM. „Process" (klawisz przejęty przez IME),
 * „Dead" i „Unidentified" to nazwy, nie znaki. Gdyby szły po `code`, Ctrl+I
 * w japońskim IME Microsoftu (konwersja na katakanę w trakcie kompozycji)
 * wstawiałby znaczniki kursywy w środek kompozycji.
 */
function keyMatches(binding: ShortcutBinding, e: ShortcutEventLike, key: string): boolean {
  if (binding.key === key) return true;
  if (e.code !== binding.code) return false;
  if ([...key].length !== 1 || LATIN_KEY.test(key)) return false;
  // Bez Shiftu wiązania są literami - zastępuje je tylko litera innego pisma,
  // a nie kropka czy myślnik (Dvorak: fizyczne „KeyE" to „.").
  return binding.shift === true || ANY_LETTER.test(key);
}

export interface ShortcutPlatform {
  /** Platforma Apple: skrótem jest WYŁĄCZNIE Cmd (patrz `matchMarkdownShortcut`). */
  apple?: boolean;
}

/**
 * Zwraca id akcji formatowania dla zdarzenia klawiatury albo `null`.
 * Modyfikator: Cmd (macOS) lub Ctrl. Alt nigdy nie bierze udziału - kolidowałby
 * z wprowadzaniem znaków diakrytycznych.
 *
 * NA APPLE TYLKO CMD. Pasek ogłasza tam „⌘B", a Ctrl+E/K/B w polu tekstowym
 * macOS to systemowa edycja w stylu Emacsa (koniec linii, usuń do końca linii,
 * znak wstecz) - przejęcie ich wstawiałoby znaczniki zamiast przesuwać kursor.
 */
export function matchMarkdownShortcut(
  e: ShortcutEventLike,
  { apple = false }: ShortcutPlatform = {},
): MarkdownActionId | null {
  if (e.altKey) return null;
  if (!e.metaKey && !e.ctrlKey) return null;
  // Cmd i Ctrl jednocześnie to nie jest zwykły skrót formatowania.
  if (e.metaKey && e.ctrlKey) return null;
  if (apple && !e.metaKey) return null;
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
