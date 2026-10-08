// Slide-up reklamowy przyklejony do dołu viewportu. Pojawia się po opóźnieniu,
// można go zamknąć (per-sesja, sessionStorage). Honoruje zgodę marketingową
// poprzez AdSlotView, a przez koordynator nakładek nie nakłada się na popupy
// (jedna nakładka naraz + wspólny budżet przerwań).
//
// POZA BOOTEM (P3.8). Pozycji `footer_slideup` nie grzeje SSR, więc zapytanie
// szło w efekcie hydratacji: GET + preflight w oknie bootu każdej strony
// z paskiem, choć pasek i tak czeka `delay_ms` i slot koordynatora. Zapytanie
// jest uzbrajane dopiero przy pierwszej interakcji albo w punkcie ciszy
// (wspólny zatrzask `interactionOrQuiet.ts`), a opóźnienie paska zamontowanego
// w bocie liczy się od STARTU NAWIGACJI, nie od danych - pasek pokazuje się
// po max(zatrzask, `delay_ms`), a nie po zatrzask + `delay_ms`. Pasek
// zamontowany po otwarciu zatrzasku (nawigacja SPA) czeka `delay_ms` od danych,
// jak dotąd.
import { useEffect, useRef, useState } from "react";
import { X } from "@/lib/lucide-shim";
import { AdSlotView } from "@/components/AdSlot";
import { useAdPlacements } from "@/lib/ads/queries";
import {
  isInteractionOrQuietOpen,
  useInteractionOrQuiet,
} from "@/lib/performance/interactionOrQuiet";
import type { AdPageType } from "@/lib/ads/types";
import { useTranslation } from "react-i18next";
import { requestOverlaySlot, cancelOverlayRequest } from "@/lib/overlayCoordinator";
import { sinceNavigationStart } from "@/components/popups/sinceNavigationStart";

interface Props {
  pageType: AdPageType;
  pageId?: string | null;
}

const STORAGE_PREFIX = "ad_slideup_dismissed:";

export function FooterSlideup({ pageType, pageId }: Props) {
  const armed = useInteractionOrQuiet();
  // Montaż w bocie (zatrzask jeszcze zamknięty) = opóźnienie od startu nawigacji.
  const [bootMount] = useState(() => !isInteractionOrQuietOpen());
  const { data } = useAdPlacements("footer_slideup", pageType, pageId, undefined, armed);
  const { t } = useTranslation();
  const [visibleId, setVisibleId] = useState<string | null>(null);
  const releaseSlotRef = useRef<(() => void) | null>(null);

  const placement = data?.[0];

  useEffect(() => {
    if (!placement) return;
    const slotId = `footer-slideup:${placement.id}`;
    const cfg = placement.config as { delay_ms?: number; dismissible?: boolean };
    const dismissible = cfg.dismissible ?? true;
    if (dismissible) {
      try {
        if (sessionStorage.getItem(STORAGE_PREFIX + placement.id) === "1") return;
      } catch {
        // ignore storage errors
      }
    }
    let disposed = false;
    // Pasek z bootu: od startu nawigacji (w dokumencie prerenderowanym - od
    // aktywacji, `sinceNavigationStart`), nie od chwili, w której przyszły dane.
    const delay = Math.max(
      0,
      Number(cfg.delay_ms ?? 3000) - (bootMount ? sinceNavigationStart() : 0),
    );
    const handle = setTimeout(() => {
      // Ask the coordinator for a slot: a non-modal slide-up still counts as an
      // interruption, must not appear on top of a popup, and shares the budget.
      // Lowest priority (-1) so any pending popup wins.
      void requestOverlaySlot(slotId, { marketing: true, priority: -1 }).then((release) => {
        if (disposed) {
          release();
          return;
        }
        releaseSlotRef.current = release;
        setVisibleId(placement.id);
      });
    }, delay);
    return () => {
      disposed = true;
      clearTimeout(handle);
      cancelOverlayRequest(slotId);
      releaseSlotRef.current?.();
      releaseSlotRef.current = null;
    };
  }, [placement, bootMount]);

  if (!placement || visibleId !== placement.id) return null;

  const cfg = placement.config as { dismissible?: boolean };
  const dismissible = cfg.dismissible ?? true;

  const dismiss = () => {
    try {
      sessionStorage.setItem(STORAGE_PREFIX + placement.id, "1");
    } catch {
      // ignore
    }
    releaseSlotRef.current?.();
    releaseSlotRef.current = null;
    setVisibleId(null);
  };

  return (
    // Pasek NIE jest punktem orientacyjnym.
    //
    // Do 08.2026 miał własne `role="complementary"` z etykietą
    // `ads.slideupLabel`, a `AdSlotView` -> `AdContainer` w środku dokładał
    // drugi region o tej samej nazwie („Reklama"): jedna reklama dawała dwa
    // nierozróżnialne, ZAGNIEŻDŻONE punkty orientacyjne (axe: `landmark-unique`
    // i `landmark-complementary-is-top-level`). Zagnieżdżenie sugeruje
    // strukturę, której nie ma, więc jest gorsze niż brak regionu.
    //
    // Z dwóch regionów zostaje TEN WEWNĘTRZNY: to on opisuje samą kreację i to
    // on niesie nazwę strefy („Reklama - pasek dolny"), więc pasek nie ma czego
    // dodać poza pozycjonowaniem i przyciskiem zamknięcia (ten ma własną nazwę
    // dostępną). Etykieta paska przestała być używana i zeszła ze słownika
    // w obu językach; `data-ad-slideup` zostaje jako stabilny uchwyt.
    <div
      data-ad-slideup=""
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur shadow-2xl animate-in slide-in-from-bottom"
    >
      <div className="relative mx-auto max-w-6xl px-4 py-3 flex items-center justify-center">
        <AdSlotView placement={placement} />
        {dismissible && (
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("ads.dismiss")}
            className="absolute top-1 right-2 p-1.5 text-muted-foreground hover:text-foreground transition"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
