// Slide-up reklamowy przyklejony do dołu viewportu. Pojawia się po opóźnieniu,
// można go zamknąć (per-sesja, sessionStorage). Honoruje zgodę marketingową
// poprzez AdSlotView.
import { useEffect, useState } from "react";
import { X } from "@/lib/lucide-shim";
import { AdSlotView } from "@/components/AdSlot";
import { useAdPlacements } from "@/lib/ads/queries";
import type { AdPageType } from "@/lib/ads/types";
import { useTranslation } from "react-i18next";

interface Props {
  pageType: AdPageType;
  pageId?: string | null;
}

const STORAGE_PREFIX = "ad_slideup_dismissed:";

export function FooterSlideup({ pageType, pageId }: Props) {
  const { data } = useAdPlacements("footer_slideup", pageType, pageId);
  const { t } = useTranslation();
  const [visibleId, setVisibleId] = useState<string | null>(null);

  const placement = data?.[0];

  useEffect(() => {
    if (!placement) return;
    const cfg = placement.config as { delay_ms?: number; dismissible?: boolean };
    const dismissible = cfg.dismissible ?? true;
    if (dismissible) {
      try {
        if (sessionStorage.getItem(STORAGE_PREFIX + placement.id) === "1") return;
      } catch {
        // ignore storage errors
      }
    }
    const delay = Math.max(0, Number(cfg.delay_ms ?? 3000));
    const handle = setTimeout(() => setVisibleId(placement.id), delay);
    return () => clearTimeout(handle);
  }, [placement]);

  if (!placement || visibleId !== placement.id) return null;

  const cfg = placement.config as { dismissible?: boolean };
  const dismissible = cfg.dismissible ?? true;

  const dismiss = () => {
    try {
      sessionStorage.setItem(STORAGE_PREFIX + placement.id, "1");
    } catch {
      // ignore
    }
    setVisibleId(null);
  };

  return (
    <div
      role="complementary"
      aria-label={t("ads.slideupLabel", { defaultValue: "Reklama" })}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur shadow-2xl animate-in slide-in-from-bottom"
    >
      <div className="relative mx-auto max-w-6xl px-4 py-3 flex items-center justify-center">
        <AdSlotView placement={placement} />
        {dismissible && (
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("ads.dismiss", { defaultValue: "Zamknij reklamę" })}
            className="absolute top-1 right-2 p-1.5 text-muted-foreground hover:text-foreground transition"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
