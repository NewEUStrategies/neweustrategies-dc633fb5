// Reguły edytora bloków kampanii - to, co kreator treści robi z dokumentem
// e-maila, wyjęte z komponentu.
//
// PO CO. Kampania jedzie do CAŁEJ listy i nie da się jej odwołać. Pomyłki tego
// edytora są ciche:
//
//   * DUPLIKAT bloku musi być głęboką kopią z NOWYM identyfikatorem. Kopia
//     płytka dzieli obiekty tekstu z oryginałem, więc edycja jednego bloku
//     zmienia drugi - redaktor poprawia nagłówek i psuje sobie kopię, której
//     w tym momencie nie widzi. Powtórzony identyfikator to z kolei dwa bloki,
//     które zaznaczają się i patchują razem.
//   * KLUCZ DOBORU WPISÓW decyduje, kiedy podgląd pyta serwer o „najnowsze
//     wpisy". Za wąski - podgląd pokazuje stare wpisy po zmianie kategorii.
//     Za szeroki - każde naciśnięcie klawisza w nagłówku sekcji strzela
//     zapytaniem do bazy.
//   * LIMITY: liczba wpisów 1-10 i najwyżej 10 ręcznie wybranych. Wartość poza
//     zakresem nie wywala się - renderuje mail z pustą albo przerośniętą listą.
import {
  createEmailBlock,
  type EmailBlock,
  type EmailBlockType,
  type EmailDoc,
  type EmailPostListBlock,
} from "@/lib/newsletter/emailDoc";

/** Najwyżej tyle wpisów w bloku „najnowsze wpisy" - i w trybie ręcznym. */
export const MAX_POST_LIST_ITEMS = 10;
/** Domyślna liczba wpisów, gdy pole wyczyszczono. */
export const DEFAULT_POST_COUNT = 3;
/** Domyślna wysokość odstępu, gdy pole wyczyszczono. */
export const DEFAULT_SPACER_SIZE = 24;

/** Klucze etykiet bloków - napisy żyją w słowniku, nie w tablicy obok bramki i18n. */
export const BLOCK_LABEL_KEYS: Readonly<Record<EmailBlockType, string>> = {
  heading: "adminNewsletter.blocks.heading",
  paragraph: "adminNewsletter.blocks.paragraph",
  image: "adminNewsletter.blocks.image",
  button: "adminNewsletter.blocks.button",
  "post-list": "adminNewsletter.blocks.postList",
  quote: "adminNewsletter.blocks.quote",
  divider: "adminNewsletter.blocks.divider",
  spacer: "adminNewsletter.blocks.spacer",
  "footer-note": "adminNewsletter.blocks.footerNote",
};

/** Klucz etykiety bloku; typ nieznany palecie oddaje `null` (podpis schodzi na nazwę typu). */
export function blockLabelKey(type: EmailBlockType): string | null {
  return BLOCK_LABEL_KEYS[type] ?? null;
}

export function appendBlock(blocks: readonly EmailBlock[], block: EmailBlock): EmailBlock[] {
  return [...blocks, block];
}

export function updateBlock(blocks: readonly EmailBlock[], updated: EmailBlock): EmailBlock[] {
  return blocks.map((b) => (b.id === updated.id ? updated : b));
}

export function removeBlock(blocks: readonly EmailBlock[], id: string): EmailBlock[] {
  return blocks.filter((b) => b.id !== id);
}

/**
 * Kopia bloku ląduje ZARAZ ZA oryginałem i dostaje nowy identyfikator.
 *
 * Klon jest GŁĘBOKI (round-trip przez JSON - `EmailBlock` to czysty JSON):
 * kopia płytka dzieliłaby obiekty `{ pl, en }` z oryginałem, więc edycja
 * jednego bloku zmieniałaby drugi.
 *
 * Oddaje też identyfikator kopii, żeby wywołujący mógł ją od razu zaznaczyć.
 */
export function duplicateBlock(
  blocks: readonly EmailBlock[],
  id: string,
): { blocks: EmailBlock[]; copyId: string } | null {
  const idx = blocks.findIndex((b) => b.id === id);
  if (idx < 0) return null;
  const source = blocks[idx]!;
  const copy = {
    ...(JSON.parse(JSON.stringify(source)) as EmailBlock),
    id: createEmailBlock(source.type).id,
  };
  const next = [...blocks];
  next.splice(idx + 1, 0, copy);
  return { blocks: next, copyId: copy.id };
}

/**
 * Przestawia blok pod inny. `null` znaczy „nic się nie zmienia" - wywołujący nie
 * powinien wtedy dotykać dokumentu, bo każdy zapis to nowy stan formularza.
 */
export function reorderBlocks(
  blocks: readonly EmailBlock[],
  activeId: string,
  overId: string | null,
): EmailBlock[] | null {
  if (overId === null || activeId === overId) return null;
  const from = blocks.findIndex((b) => b.id === activeId);
  const to = blocks.findIndex((b) => b.id === overId);
  if (from < 0 || to < 0) return null;
  const next = [...blocks];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** Pola bloku „najnowsze wpisy", które wpływają na DOBÓR wpisów. */
export interface PostListSelector {
  id: string;
  mode: EmailPostListBlock["mode"];
  count: number;
  categorySlug: string | null;
  postIds: string[];
}

/**
 * Klucz doboru wpisów dla podglądu.
 *
 * Bierze WYŁĄCZNIE pola zmieniające to, KTÓRE wpisy trafią do maila. Nagłówek
 * sekcji, układ i przełącznik zapowiedzi są celowo pominięte - inaczej każde
 * naciśnięcie klawisza w nagłówku strzelałoby zapytaniem do bazy.
 */
export function postListSelectors(doc: EmailDoc): PostListSelector[] {
  return doc.blocks
    .filter((b): b is EmailPostListBlock => b.type === "post-list")
    .map((b) => ({
      id: b.id,
      mode: b.mode,
      count: b.count,
      categorySlug: b.categorySlug,
      postIds: b.postIds,
    }));
}

/** Liczba wpisów przycięta do 1-10; śmieci schodzą na domyślne 3. */
export function clampPostCount(raw: string | number): number {
  const n = Number(raw);
  if (!n) return DEFAULT_POST_COUNT;
  return Math.min(MAX_POST_LIST_ITEMS, Math.max(1, n));
}

/** Wysokość odstępu; śmieci schodzą na domyślne 24 px. */
export function spacerSize(raw: string | number): number {
  return Number(raw) || DEFAULT_SPACER_SIZE;
}

/**
 * Przełącza wpis na liście ręcznego wyboru. Dołożenie ponad limit jest UCINANE,
 * a nie odrzucane po cichu na poziomie zapisu.
 */
export function togglePostId(selected: readonly string[], id: string): string[] {
  return selected.includes(id)
    ? selected.filter((x) => x !== id)
    : [...selected, id].slice(0, MAX_POST_LIST_ITEMS);
}

/** Puste pole tekstowe zapisuje NULL, nie pusty napis - „brak" to nie „nic". */
export function nullIfEmpty(value: string): string | null {
  return value || null;
}
