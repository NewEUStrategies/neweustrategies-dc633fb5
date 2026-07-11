// Decides where a "Save for later" click persists and reflects the saved state,
// so the article rail's save button is no longer a localStorage-only dead end.
//
//   logged-in + personalization on   -> DB (user_bookmarks), shows in
//                                        /reading-list and /profile/bookmarks
//   guest + allowGuests               -> localStorage fallback (best-effort,
//                                        same device only - no guest sync exists)
//   guest + !allowGuests              -> login popup (same nudge reading-list uses)
//   feature off / no entity id        -> localStorage fallback (unchanged behavior)
//
// Guest entries honour the admin's `guestExpirationDays` TTL: every item is
// stamped with `savedAt`, expired items are pruned from localStorage on read,
// and the post-login merge (anonMerge) applies the same cutoff.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { useBookmarks, useToggleBookmark, type BookmarkEntityType } from "@/hooks/useBookmarks";
import { usePersonalizedSettings, safeReadingListPath } from "@/hooks/usePersonalizedSettings";
import { openLoginPopup } from "@/lib/loginPopupBus";

const LS_KEY = "lovable:saved-articles";
const DAY_MS = 86_400_000;

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

// Drop guest entries older than the admin-configured TTL. Entries without a
// numeric `savedAt` (hand-edited / corrupted) are kept - they get re-stamped
// on the next write. maxAgeDays <= 0 disables expiration.
function pruneExpired(list: SavedItem[], maxAgeDays: number): SavedItem[] {
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) return list;
  const cutoff = Date.now() - maxAgeDays * DAY_MS;
  return list.filter((s) => typeof s.savedAt !== "number" || s.savedAt >= cutoff);
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
  const navigate = useNavigate();
  const settings = usePersonalizedSettings();
  const { data: bookmarks } = useBookmarks();
  const toggleBookmark = useToggleBookmark();

  // DB persistence is used only for a signed-in user with a real entity id and
  // the personalization system switched on; everything else falls back to the
  // per-device localStorage list.
  const canUseDb = !!user && !!entityId && settings.enabled;
  const guestTtlDays = settings.guestExpirationDays;

  const [localSaved, setLocalSaved] = useState(false);
  useEffect(() => {
    if (canUseDb || typeof window === "undefined" || !url) return;
    const all = readLocal();
    const fresh = pruneExpired(all, guestTtlDays);
    if (fresh.length !== all.length) {
      // Enforce the TTL at the storage level too, so /reading-list and the
      // post-login merge see the same pruned list.
      try {
        window.localStorage.setItem(LS_KEY, JSON.stringify(fresh));
      } catch {
        /* private mode / storage unavailable - ignore */
      }
    }
    setLocalSaved(fresh.some((s) => s.url === url));
  }, [canUseDb, url, guestTtlDays]);

  const dbSaved =
    canUseDb &&
    (bookmarks ?? []).some((b) => b.entity_type === entityType && b.entity_id === entityId);

  const savedMsg = lang === "en" ? "Added to saved" : "Dodano do zapisanych";
  const removedMsg = lang === "en" ? "Removed from saved" : "Usunięto z zapisanych";
  const errorMsg = lang === "en" ? "Could not save" : "Nie udało się zapisać";
  const openListLabel = lang === "en" ? "Open list" : "Otwórz listę";
  // Admin-configurable target for "reading list" links (validated internal
  // path, falls back to the built-in /reading-list route).
  const readingListTarget = safeReadingListPath(settings);

  const savedToast = useCallback(() => {
    toast.success(savedMsg, {
      action: {
        label: openListLabel,
        onClick: () => {
          void navigate({ to: readingListTarget });
        },
      },
    });
  }, [savedMsg, openListLabel, readingListTarget, navigate]);

  const toggleLocal = useCallback(() => {
    if (typeof window === "undefined" || !url) return;
    const list = pruneExpired(readLocal(), guestTtlDays);
    const exists = list.some((s) => s.url === url);
    const next = exists
      ? list.filter((s) => s.url !== url)
      : [
          { url, title, savedAt: Date.now() },
          // Re-stamp legacy entries missing a timestamp so they age from now on.
          ...list.map((s) => (typeof s.savedAt === "number" ? s : { ...s, savedAt: Date.now() })),
        ].slice(0, 200);
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(next));
      setLocalSaved(!exists);
      if (exists) toast.success(removedMsg);
      else savedToast();
    } catch {
      /* private mode / storage unavailable - ignore */
    }
  }, [url, title, guestTtlDays, removedMsg, savedToast]);

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
            if (!settings.popupNotification) return;
            if (next) savedToast();
            else toast.success(removedMsg);
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
    savedToast,
    removedMsg,
    errorMsg,
  ]);

  return { isSaved: canUseDb ? dbSaved : localSaved, toggle };
}
