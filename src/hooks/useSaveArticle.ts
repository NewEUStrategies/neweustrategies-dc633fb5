// Decides where a "Save for later" click persists and reflects the saved state,
// so the article rail's save button is no longer a localStorage-only dead end.
//
//   logged-in + personalization on   -> DB (user_bookmarks), shows in
//                                        /reading-list and /profile/bookmarks
//   guest + allowGuests               -> localStorage fallback (best-effort,
//                                        same device only - no guest sync exists)
//   guest + !allowGuests              -> login popup (same nudge reading-list uses)
//   feature off / no entity id        -> localStorage fallback (unchanged behavior)
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useBookmarks, useToggleBookmark, type BookmarkEntityType } from "@/hooks/useBookmarks";
import { usePersonalizedSettings } from "@/hooks/usePersonalizedSettings";
import { openLoginPopup } from "@/lib/loginPopupBus";

const LS_KEY = "lovable:saved-articles";

type SavedItem = { url: string; title: string; savedAt: number };

function readLocal(): SavedItem[] {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SavedItem[]) : [];
  } catch {
    return [];
  }
}

interface Options {
  entityId?: string;
  entityType?: BookmarkEntityType;
  url: string;
  title: string;
  lang: "pl" | "en";
}

interface SaveState {
  isSaved: boolean;
  toggle: () => void;
}

export function useSaveArticle({
  entityId,
  entityType = "post",
  url,
  title,
  lang,
}: Options): SaveState {
  const { user } = useAuth();
  const settings = usePersonalizedSettings();
  const { data: bookmarks } = useBookmarks();
  const toggleBookmark = useToggleBookmark();

  // DB persistence is used only for a signed-in user with a real entity id and
  // the personalization system switched on; everything else falls back to the
  // per-device localStorage list.
  const canUseDb = !!user && !!entityId && settings.enabled;

  const [localSaved, setLocalSaved] = useState(false);
  useEffect(() => {
    if (canUseDb || typeof window === "undefined" || !url) return;
    setLocalSaved(readLocal().some((s) => s.url === url));
  }, [canUseDb, url]);

  const dbSaved =
    canUseDb &&
    (bookmarks ?? []).some((b) => b.entity_type === entityType && b.entity_id === entityId);

  const savedMsg = lang === "en" ? "Added to saved" : "Dodano do zapisanych";
  const removedMsg = lang === "en" ? "Removed from saved" : "Usunięto z zapisanych";
  const errorMsg = lang === "en" ? "Could not save" : "Nie udało się zapisać";

  const toggleLocal = useCallback(() => {
    if (typeof window === "undefined" || !url) return;
    const list = readLocal();
    const exists = list.some((s) => s.url === url);
    const next = exists
      ? list.filter((s) => s.url !== url)
      : [{ url, title, savedAt: Date.now() }, ...list].slice(0, 200);
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(next));
      setLocalSaved(!exists);
      toast.success(exists ? removedMsg : savedMsg);
    } catch {
      /* private mode / storage unavailable - ignore */
    }
  }, [url, title, savedMsg, removedMsg]);

  const toggle = useCallback(() => {
    // Guest hitting a gated save: nudge to sign in (mirrors /reading-list).
    if (!user && settings.enabled && !settings.allowGuests) {
      openLoginPopup({
        title: settings.restrictedTitle,
        description: settings.restrictedDescription,
      });
      return;
    }
    if (canUseDb && entityId) {
      const next = !dbSaved;
      toggleBookmark.mutate(
        { entityType, entityId, on: next },
        {
          onSuccess: () => {
            if (settings.popupNotification) toast.success(next ? savedMsg : removedMsg);
          },
          onError: () => toast.error(errorMsg),
        },
      );
      return;
    }
    toggleLocal();
  }, [
    user,
    settings.enabled,
    settings.allowGuests,
    settings.popupNotification,
    settings.restrictedTitle,
    settings.restrictedDescription,
    canUseDb,
    entityId,
    entityType,
    dbSaved,
    toggleBookmark,
    toggleLocal,
    savedMsg,
    removedMsg,
    errorMsg,
  ]);

  return { isSaved: canUseDb ? dbSaved : localSaved, toggle };
}
