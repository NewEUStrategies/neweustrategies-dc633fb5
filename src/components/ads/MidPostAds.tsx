// Wstrzykuje reklamy typu `mid_post` w środek treści wpisu -
// po N-tym paragrafie zgodnie z konfiguracją placement.config.paragraph.
// Renderuje React do dynamicznie utworzonych kontenerów wewnątrz articleRef
// (poprzez createPortal) - bez modyfikowania samego HTML treści.
import { useEffect, useMemo, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useAdPlacements, type AdContentContext } from "@/lib/ads/queries";
import { AdSlotView } from "@/components/AdSlot";
import type { AdPageType, AdPlacementWithSlot } from "@/lib/ads/types";

interface Props {
  articleRef: RefObject<HTMLDivElement | null>;
  pageType: AdPageType;
  pageId: string;
  /** Klucz przebudowy gdy treść / język się zmienia. */
  scanKey?: string | number;
  /** Kontekst treści dla targetingu slotów (slugi kategorii/tagów posta). */
  content?: AdContentContext;
}

interface Mount {
  el: HTMLDivElement;
  placement: AdPlacementWithSlot;
}

const HOST_ATTR = "data-ad-mid-host";

// Twardy sufit wstrzyknięć mid-post na jeden artykuł. Konfiguracja placementów
// jest nieograniczona po stronie CMS, więc bez capa artykuł mógł dostać dowolną
// liczbę śródtekstowych reklam (audyt UX: presja monetyzacyjna). Dwie
// najwcześniejsze (wg config.paragraph) wygrywają; reszta jest pomijana.
const MAX_MID_POST_ADS = 2;

// Pojemniki, w których akapit NIE należy do głównego toku artykułu: cytat,
// figura z podpisem, pozycja listy, komórka tabeli, ramka boczna, szczegóły
// i formularz.
//
// DLACZEGO TA LISTA, A NIE `:scope > p`. Wybór miejsca wstawki liczył wcześniej
// WSZYSTKIE `<p>` w drzewie, a host lądował rodzeństwem trafionego akapitu -
// więc cytat z dwóch akapitów potrafił dostać reklamę w środku, formalnie
// wewnątrz `<blockquote>`, czyli w obrębie cudzej wypowiedzi. Kanoniczne
// `:scope > p` zamyka to, ale zabiera wstawki KAŻDEMU artykułowi owiniętemu
// dodatkowym `<div>` (a takie wychodzą z buildera bloków). Dlatego kryterium
// jest odwrotne: akapit należy do głównego toku, dopóki nie siedzi w żadnym
// z tych pojemników - dowolnie głęboko zagnieżdżone `<div>`-y nadal działają.
const NON_FLOW_CONTAINERS = "blockquote, figure, li, td, th, table, aside, details, form";

export function MidPostAds({ articleRef, pageType, pageId, scanKey, content }: Props) {
  const { data } = useAdPlacements("mid_post", pageType, pageId, content);
  const [mounts, setMounts] = useState<Mount[]>([]);

  const sorted = useMemo(() => {
    if (!data) return [];
    return [...data]
      .sort((a, b) => {
        const ap = Number((a.config as { paragraph?: number }).paragraph ?? 4);
        const bp = Number((b.config as { paragraph?: number }).paragraph ?? 4);
        return ap - bp;
      })
      .slice(0, MAX_MID_POST_ADS);
  }, [data]);

  useEffect(() => {
    const root = articleRef.current;
    if (!root || sorted.length === 0) {
      setMounts([]);
      return;
    }

    // Sprzątanie poprzednich hostów (gdyby były).
    root.querySelectorAll(`[${HOST_ATTR}]`).forEach((n) => n.remove());

    // Pojemnika szukamy tylko WEWNĄTRZ artykułu: `closest` idzie w górę bez
    // końca, więc bez tego warunku artykuł osadzony np. w `<form>` strony
    // straciłby wszystkie wstawki naraz.
    const inNonFlowContainer = (p: Element) => {
      const container = p.closest(NON_FLOW_CONTAINERS);
      return container !== null && container !== root && root.contains(container);
    };

    const paragraphs = Array.from(root.querySelectorAll<HTMLParagraphElement>("p")).filter(
      (p) => p.closest(`[${HOST_ATTR}]`) === null && !inNonFlowContainer(p),
    );

    const next: Mount[] = [];
    sorted.forEach((placement) => {
      const after = Math.max(
        1,
        Number((placement.config as { paragraph?: number }).paragraph ?? 4),
      );
      const target = paragraphs[Math.min(after - 1, paragraphs.length - 1)];
      if (!target || !target.parentNode) return;
      const host = document.createElement("div");
      host.setAttribute(HOST_ATTR, placement.id);
      host.className = "my-8";
      target.parentNode.insertBefore(host, target.nextSibling);
      next.push({ el: host, placement });
    });
    setMounts(next);

    return () => {
      next.forEach((m) => m.el.remove());
    };
  }, [articleRef, sorted, scanKey]);

  if (mounts.length === 0) return null;

  return <>{mounts.map((m) => createPortal(<AdSlotView placement={m.placement} />, m.el))}</>;
}
