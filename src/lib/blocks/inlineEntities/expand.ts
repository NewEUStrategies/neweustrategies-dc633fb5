// Dekorator PO sanityzacji: zamienia odwołania `<span data-nes-entity="id">`
// w statyczny, interaktywny znacznik (awatar 6 px + nazwa z linią pod spodem).
//
// Kontrakt SSR / hydratacji:
//   * funkcja jest czysta i deterministyczna - ten sam dokument i język dają
//     bajt w bajt ten sam HTML na serwerze i w przeglądarce, więc hydratacja
//     `dangerouslySetInnerHTML` nie ma czego poprawiać;
//   * cała interakcja (karta po najechaniu / fokusie / tapnięciu) jest
//     dopinana później przez delegację zdarzeń (`InlineEntityCards`), więc
//     artykuł nie hydratuje ani jednego komponentu per encja.
//
// Core Web Vitals:
//   * CLS - awatar ma jawne `width`/`height` i `aspect-square`, a jego rozmiar
//     jest w `em` (skaluje się z tekstem, liczony przy pierwszym layoucie);
//     karta jest nakładką `position: fixed`, nie przesuwa treści;
//   * LCP - awatary są `loading="lazy"` + `decoding="async"` + `fetchpriority=low`
//     i ładują serwerowo zmniejszony wariant (1x/2x/3x), nie oryginał;
//   * INP - żadnych nasłuchów per element.
//
// Wstawiany markup powstaje TUTAJ, z escapowanych danych rejestru, dlatego
// dekorator działa na HTML-u, który przeszedł już sanitizer (tak samo jak
// `expandFootnotes` i `decorateCmsStatusIcons`) - `button` nie jest na liście
// dozwolonych tagów sanitizera SSR i nie musi być.

import { buildAvatarSrc, buildAvatarSrcSet } from "@/lib/cropSizes";
import {
  inlineEntityDisplayName,
  inlineEntityInitials,
  type InlineEntity,
  type InlineEntityRegistry,
} from "./model";
import { INLINE_ENTITY_ATTR } from "./registry";

/** Bok awatara w tekście (CSS px przy 18 px tekstu) - baza dla wariantów obrazu. */
export const INLINE_AVATAR_PX = 24;

// Klasy są literałami, żeby Tailwind je wygenerował (skan `src/lib/**`).
// Kanwa edytora używa tych samych stałych - WYSIWYG z publikacją.
export const INLINE_ENTITY_CLASSES = {
  root: "nes-ie not-prose",
  trigger:
    "group/nes-ie mx-[0.08em] inline-flex max-w-full cursor-pointer items-center gap-[0.3em] rounded-[0.3em] border-0 bg-transparent p-0 align-middle font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  static:
    "group/nes-ie mx-[0.08em] inline-flex max-w-full items-center gap-[0.3em] align-middle font-medium",
  avatar:
    "m-0 inline-block aspect-square h-[1.2em] w-[1.2em] shrink-0 rounded-[6px] object-cover ring-1 ring-foreground/15 transition-[box-shadow] duration-150 ease-out group-aria-expanded/nes-ie:ring-brand/60",
  initials:
    "m-0 inline-flex aspect-square h-[1.2em] w-[1.2em] shrink-0 items-center justify-center rounded-[6px] bg-muted text-[0.5em] font-semibold leading-none tracking-tight text-muted-foreground ring-1 ring-foreground/15 group-aria-expanded/nes-ie:ring-brand/60",
  name: "min-w-0 border-b-[1.5px] border-foreground/25 pb-[0.06em] leading-none transition-colors duration-150 ease-out group-hover/nes-ie:border-foreground/50 group-aria-expanded/nes-ie:border-brand",
} as const;

/** Atrybut wyzwalacza, po którym delegacja zdarzeń rozpoznaje encję. */
export const INLINE_ENTITY_TRIGGER_ATTR = "data-nes-ie-trigger";

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Awatar (obraz albo inicjały) jako HTML - wspólny dla tekstu i testów. */
export function inlineEntityAvatarHtml(entity: InlineEntity): string {
  const src = entity.image?.src;
  if (!src) {
    return `<span class="${INLINE_ENTITY_CLASSES.initials}" aria-hidden="true">${escapeText(inlineEntityInitials(entity))}</span>`;
  }
  const resolved = buildAvatarSrc(src, INLINE_AVATAR_PX);
  const srcset = buildAvatarSrcSet(src, INLINE_AVATAR_PX);
  const srcsetAttr = srcset ? ` srcset="${escapeAttr(srcset)}"` : "";
  return `<img class="${INLINE_ENTITY_CLASSES.avatar}" src="${escapeAttr(resolved)}"${srcsetAttr} width="${INLINE_AVATAR_PX}" height="${INLINE_AVATAR_PX}" alt="" loading="lazy" decoding="async" fetchpriority="low">`;
}

/**
 * Znacznik jednej encji. `interactive: false` (odwołanie wewnątrz linku) daje
 * wersję bez przycisku - interaktywny element w `<a>` byłby nieprawidłowy
 * i nieosiągalny z klawiatury.
 */
export function inlineEntityMarkup(entity: InlineEntity, interactive: boolean): string {
  const id = escapeAttr(entity.id);
  const name = `<span class="${INLINE_ENTITY_CLASSES.name}">${escapeText(inlineEntityDisplayName(entity))}</span>`;
  const avatar = inlineEntityAvatarHtml(entity);
  const inner = interactive
    ? `<button type="button" class="${INLINE_ENTITY_CLASSES.trigger}" ${INLINE_ENTITY_TRIGGER_ATTR}="${id}" aria-haspopup="dialog" aria-expanded="false">${avatar}${name}</button>`
    : `<span class="${INLINE_ENTITY_CLASSES.static}">${avatar}${name}</span>`;
  return `<span class="${INLINE_ENTITY_CLASSES.root}" data-nes-ie="${id}" data-nes-ie-kind="${entity.kind}">${inner}</span>`;
}

const TAG_SPLIT_RE = /(<[^>]+>)/g;
const ENTITY_OPEN_RE = /^<span\b[^>]*\bdata-nes-entity="([^"]+)"[^>]*>$/i;
const SPAN_OPEN_RE = /^<span\b/i;
const SPAN_CLOSE_RE = /^<\/span\s*>$/i;
const ANCHOR_OPEN_RE = /^<a\b/i;
const ANCHOR_CLOSE_RE = /^<\/a\s*>$/i;
const BUTTON_OPEN_RE = /^<button\b/i;
const BUTTON_CLOSE_RE = /^<\/button\s*>$/i;

/**
 * Rozwija odwołania w SANITYZOWANYM HTML-u. Odwołanie do encji spoza rejestru
 * zostaje nietknięte (czytelnik widzi tekst zastępczy), więc brak danych nigdy
 * nie psuje akapitu.
 */
export function expandInlineEntities(html: string, registry: InlineEntityRegistry): string {
  if (!html || !html.includes(INLINE_ENTITY_ATTR)) return html;
  const parts = html.split(TAG_SPLIT_RE);
  let out = "";
  // Głębokość elementów interaktywnych, w których przycisk byłby nieprawidłowy.
  let interactiveDepth = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part.startsWith("<")) {
      out += part;
      continue;
    }
    if (ANCHOR_OPEN_RE.test(part) || BUTTON_OPEN_RE.test(part)) interactiveDepth += 1;
    else if (ANCHOR_CLOSE_RE.test(part) || BUTTON_CLOSE_RE.test(part))
      interactiveDepth = Math.max(0, interactiveDepth - 1);

    const open = ENTITY_OPEN_RE.exec(part);
    const entity = open ? registry[open[1]] : undefined;
    if (!open || !entity) {
      out += part;
      continue;
    }
    // Pomijamy całą zawartość odwołania aż do jego domknięcia (liczymy
    // zagnieżdżone spany - wklejka z zewnątrz potrafi owinąć tekst w <span>).
    let depth = 1;
    let j = i + 1;
    for (; j < parts.length && depth > 0; j += 1) {
      const inner = parts[j];
      if (SPAN_OPEN_RE.test(inner)) depth += 1;
      else if (SPAN_CLOSE_RE.test(inner)) depth -= 1;
    }
    if (depth !== 0) {
      // Niedomknięte odwołanie (uszkodzony HTML) - zostawiamy bez zmian.
      out += part;
      continue;
    }
    out += inlineEntityMarkup(entity, interactiveDepth === 0);
    i = j - 1;
  }
  return out;
}
