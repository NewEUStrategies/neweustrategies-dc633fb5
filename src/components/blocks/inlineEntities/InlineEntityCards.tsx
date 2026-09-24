// Nakładka kart encji inline dla opublikowanego artykułu.
//
// Znaczniki encji są statycznym HTML-em z SSR (`expandInlineEntities`), więc
// ten komponent NICZEGO nie renderuje przy SSR ani przy pierwszym renderze
// klienta - zero rozjazdów hydratacji, zero kosztu dla artykułów bez encji
// (BlocksRenderer montuje go leniwie tylko wtedy, gdy encje są w treści).
//
// Interakcja (jedna delegacja zdarzeń na kontenerze artykułu, nie N nasłuchów):
//   * mysz - najechanie otwiera, zjechanie zamyka z opóźnieniem (most nad
//     szczeliną między nazwą a kartą), klik „przypina" kartę;
//   * dotyk - tapnięcie przełącza, tapnięcie poza kartą zamyka;
//   * klawiatura - fokus z klawiatury otwiera, Tab wchodzi do linków karty,
//     Tab z ostatniego linku wraca do tekstu za encją, Escape zamyka i oddaje
//     fokus nazwie.
//
// Karta ma `position: fixed` w portalu - nie przesuwa treści (CLS = 0)
// i nie jest przycinana przez `overflow` kontenerów układu wpisu.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useIsomorphicLayoutEffect } from "@/lib/react/useIsomorphicLayoutEffect";
import type { InlineEntity, InlineEntityLang } from "@/lib/blocks/inlineEntities/model";
import { INLINE_ENTITY_TRIGGER_ATTR } from "@/lib/blocks/inlineEntities/expand";
import { cn } from "@/lib/utils";
import { InlineEntityCardView } from "./InlineEntityCardView";
import {
  CARD_WIDTH_PX,
  cardDomId,
  computeCardPlacement,
  EDGE_PADDING_PX,
  entityProfileHref,
  type CardPlacement,
} from "./cardGeometry";

const CLOSE_DELAY_MS = 140;
const TRIGGER_SELECTOR = `[${INLINE_ENTITY_TRIGGER_ATTR}]`;
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type OpenedBy = "hover" | "focus" | "click";

interface OpenState {
  id: string;
  trigger: HTMLElement;
  by: OpenedBy;
}

interface Placement extends CardPlacement {
  ready: boolean;
}

interface Props {
  entities: readonly InlineEntity[];
  lang: InlineEntityLang;
  containerRef: RefObject<HTMLElement | null>;
}

function useHoverDevice(): boolean {
  const [hover, setHover] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    setHover(mq.matches);
    const onChange = (event: MediaQueryListEvent) => setHover(event.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return hover;
}

function focusableIn(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/** Pierwszy element fokusowalny za `from` w kolejności dokumentu (poza kartą). */
function nextFocusableAfter(from: HTMLElement, card: HTMLElement | null): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !card?.contains(el),
  );
  const index = all.indexOf(from);
  return index >= 0 ? (all[index + 1] ?? null) : null;
}

function matchesFocusVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    // Silniki bez `:focus-visible` (stare WebKit / jsdom) - traktujemy fokus
    // jak klawiaturowy: lepiej pokazać kartę niż zgubić ją czytnikowi ekranu.
    return true;
  }
}

export default function InlineEntityCards({ entities, lang, containerRef }: Props) {
  const isHoverDevice = useHoverDevice();
  const [open, setOpen] = useState<OpenState | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<number | null>(null);
  const openRef = useRef<OpenState | null>(null);
  openRef.current = open;

  const byId = useRef(new Map<string, InlineEntity>());
  byId.current = new Map(entities.map((entity) => [entity.id, entity]));

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const close = useCallback(() => {
    clearCloseTimer();
    setOpen(null);
    setPlacement(null);
  }, [clearCloseTimer]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimer.current = window.setTimeout(close, CLOSE_DELAY_MS);
  }, [clearCloseTimer, close]);

  const openFor = useCallback(
    (trigger: HTMLElement, by: OpenedBy) => {
      const id = trigger.getAttribute(INLINE_ENTITY_TRIGGER_ATTR);
      if (!id || !byId.current.has(id)) return;
      clearCloseTimer();
      const current = openRef.current;
      if (current && current.trigger === trigger) {
        // Ta sama encja: klik „przypina" kartę otwartą najechaniem.
        if (by === "click" && current.by !== "click") setOpen({ ...current, by: "click" });
        return;
      }
      setPlacement(null);
      setOpen({ id, trigger, by });
    },
    [clearCloseTimer],
  );

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  // Delegacja zdarzeń na kontenerze artykułu.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const triggerOf = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof Element)) return null;
      const el = target.closest<HTMLElement>(TRIGGER_SELECTOR);
      return el && root.contains(el) ? el : null;
    };

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !isHoverDevice) return;
      const trigger = triggerOf(event.target);
      if (trigger) openFor(trigger, "hover");
    };
    const onPointerOut = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const trigger = triggerOf(event.target);
      if (!trigger) return;
      const related = event.relatedTarget;
      if (related instanceof Node && trigger.contains(related)) return;
      if (openRef.current?.by === "hover") scheduleClose();
    };
    const onClick = (event: MouseEvent) => {
      const trigger = triggerOf(event.target);
      if (!trigger) return;
      event.preventDefault();
      const current = openRef.current;
      if (current?.trigger === trigger && current.by === "click") {
        close();
        return;
      }
      openFor(trigger, "click");
    };
    const onFocusIn = (event: FocusEvent) => {
      const trigger = triggerOf(event.target);
      // Tylko fokus z klawiatury otwiera - klik myszą obsługuje `click`.
      if (trigger && matchesFocusVisible(trigger)) openFor(trigger, "focus");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.shiftKey) return;
      const current = openRef.current;
      if (!current || event.target !== current.trigger) return;
      const first = focusableIn(cardRef.current)[0];
      if (!first) return;
      event.preventDefault();
      clearCloseTimer();
      first.focus();
    };

    root.addEventListener("pointerover", onPointerOver);
    root.addEventListener("pointerout", onPointerOut);
    root.addEventListener("click", onClick);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("pointerover", onPointerOver);
      root.removeEventListener("pointerout", onPointerOut);
      root.removeEventListener("click", onClick);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("keydown", onKeyDown);
    };
  }, [containerRef, isHoverDevice, openFor, scheduleClose, close, clearCloseTimer]);

  // Stan ARIA wyzwalacza żyje w statycznym HTML-u, więc ustawiamy go w DOM.
  useEffect(() => {
    if (!open) return;
    const { trigger, id } = open;
    trigger.setAttribute("aria-expanded", "true");
    trigger.setAttribute("aria-controls", cardDomId(id));
    return () => {
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-controls");
    };
  }, [open]);

  // Escape, klik/tap poza kartą, utrata fokusu - tylko gdy karta jest otwarta.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const { trigger } = open;
      close();
      trigger.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (cardRef.current?.contains(target) || open.trigger.contains(target)) return;
      close();
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node)) return;
      if (cardRef.current?.contains(next) || open.trigger.contains(next)) return;
      if (open.by !== "click") close();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [open, close]);

  // Pomiar przed malowaniem: karta jest niewidoczna (`visibility`), dopóki nie
  // stoi w docelowym miejscu - czytelnik nigdy nie widzi jej w złej pozycji.
  const measure = useCallback(() => {
    const current = openRef.current;
    const card = cardRef.current;
    if (!current || !card) return;
    if (!current.trigger.isConnected) {
      close();
      return;
    }
    const rect = current.trigger.getBoundingClientRect();
    const next = computeCardPlacement(rect, card.offsetHeight, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    setPlacement((prev) =>
      prev &&
      prev.ready &&
      prev.left === next.left &&
      prev.top === next.top &&
      prev.width === next.width &&
      prev.flipUp === next.flipUp
        ? prev
        : { ...next, ready: true },
    );
  }, [close]);

  useIsomorphicLayoutEffect(() => {
    if (open) measure();
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const onMove = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    window.addEventListener("resize", onMove, { passive: true });
    window.addEventListener("scroll", onMove, { passive: true, capture: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, { capture: true });
    };
  }, [open, measure]);

  if (!open || typeof document === "undefined") return null;
  const entity = byId.current.get(open.id);
  if (!entity) return null;

  const onCardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const items = focusableIn(cardRef.current);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      open.trigger.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      const next = nextFocusableAfter(open.trigger, cardRef.current);
      close();
      (next ?? open.trigger).focus();
    }
  };

  const ready = Boolean(placement?.ready);
  return createPortal(
    <div
      className="fixed z-[90]"
      data-nes-ie-popover=""
      onKeyDown={onCardKeyDown}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") clearCloseTimer();
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse" && openRef.current?.by === "hover") scheduleClose();
      }}
      style={{
        left: placement?.left ?? EDGE_PADDING_PX,
        top: placement?.top ?? EDGE_PADDING_PX,
        width: placement?.width ?? CARD_WIDTH_PX,
        visibility: ready ? "visible" : "hidden",
      }}
    >
      <InlineEntityCardView
        ref={cardRef}
        entity={entity}
        lang={lang}
        id={cardDomId(entity.id)}
        profileHref={entityProfileHref(entity)}
        className={cn(
          // Animacja klatkowa startuje przy wstawieniu elementu, a pozycja jest
          // ustalana przed pierwszym malowaniem - ruch zawsze biegnie od nazwy
          // (z góry pod nią, z dołu nad nią). Zamknięcie jest natychmiastowe:
          // decyzja o wyjściu już zapadła. `prefers-reduced-motion` = bez ruchu.
          "animate-in fade-in-0 zoom-in-95 duration-200 ease-out motion-reduce:animate-none",
          // Karta wyższa od ekranu przewija się sama - linki zawsze osiągalne.
          "max-h-[calc(100dvh-1rem)] overflow-y-auto overscroll-contain",
          placement?.flipUp ? "slide-in-from-bottom-1" : "slide-in-from-top-1",
        )}
      />
    </div>,
    document.body,
  );
}
