// Live bridge between the CMS "Na czasie" pane and the real site Header.
//
// While the admin panel is mounted, it publishes the current (unsaved) ticker
// config as a "draft". Header.tsx subscribes and — if a draft is present —
// renders that config instead of the persisted one, so changes in source,
// selection, order, colors etc. reflect immediately in the live header.
import { useEffect, useState } from "react";
import type { TickerConfig } from "@/lib/views/headerTickerQuery";

const EVENT = "cms:ticker-draft";

type Draft = TickerConfig | null;

type DraftWindow = Window & { __cmsTickerDraft?: Draft };

function getWin(): DraftWindow | null {
  return typeof window === "undefined" ? null : (window as DraftWindow);
}

export function publishTickerDraft(cfg: TickerConfig): void {
  const w = getWin();
  if (!w) return;
  w.__cmsTickerDraft = cfg;
  w.dispatchEvent(new CustomEvent<Draft>(EVENT, { detail: cfg }));
}

export function clearTickerDraft(): void {
  const w = getWin();
  if (!w) return;
  w.__cmsTickerDraft = null;
  w.dispatchEvent(new CustomEvent<Draft>(EVENT, { detail: null }));
}

export function useTickerDraft(): Draft {
  const [draft, setDraft] = useState<Draft>(() => getWin()?.__cmsTickerDraft ?? null);
  useEffect(() => {
    const w = getWin();
    if (!w) return;
    const onEvt = (e: Event): void => {
      const detail = (e as CustomEvent<Draft>).detail ?? null;
      setDraft(detail);
    };
    w.addEventListener(EVENT, onEvt);
    // Sync once in case a draft was published before mount.
    setDraft(w.__cmsTickerDraft ?? null);
    return () => w.removeEventListener(EVENT, onEvt);
  }, []);
  return draft;
}
