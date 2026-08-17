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
  /** Wymagany Shift. */
  shift?: boolean;
  /** Etykieta klawisza w podpowiedzi (gdy różna od `key`). */
  hintKey?: string;
}

export const MARKDOWN_SHORTCUTS: Readonly<Record<MarkdownActionId, ShortcutBinding>> = {
  bold: { key: "b", hintKey: "B" },
  italic: { key: "i", hintKey: "I" },
  bulletList: { key: "8", shift: true },
  numberedList: { key: "7", shift: true },
  quote: { key: ".", shift: true },
  code: { key: "e", hintKey: "E" },
  link: { key: "k", hintKey: "K" },
};

export interface ShortcutEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
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
    if (binding.key !== key) continue;
    if (Boolean(binding.shift) !== e.shiftKey) continue;
    return id;
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
