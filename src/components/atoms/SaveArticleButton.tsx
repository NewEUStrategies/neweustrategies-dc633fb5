// Atom "Zapisz na później" - JEDEN przycisk zapisu artykułu dla całej platformy.
//
// Wcześniej pasek czytania (ReadingHeader) miał własną kopię logiki: pisał
// wprost do user_bookmarks przez useToggleBookmark i wypychał gościa na
// /login, podczas gdy panel czytania (FloatingShareBar) używa useSaveArticle -
// z ustawieniami personalizacji, fallbackiem localStorage dla gości, TTL i
// popupem logowania. Efekt: ten sam artykuł mógł pokazywać dwa różne stany
// „zapisano". Ten atom zamyka zapis w jednym miejscu, więc każdy pasek i panel
// czyta i zapisuje TĘ SAMĄ prawdę.
//
// Wielotenantowość: ścieżka bazodanowa idzie przez useSaveArticle ->
// useToggleBookmark -> public.user_bookmarks, gdzie tenant_id ma
// `NOT NULL DEFAULT current_tenant_id()`, a polityki RLS bramkują SELECT/
// INSERT/DELETE po `tenant_id = current_tenant_id()` (migracja
// 20260724110000_harden_user_bookmarks_tenant_scope.sql). Klient świadomie NIE
// podaje tenant_id - wypełnia go baza w kontekście tenanta żądania.
import { useEffect, useState } from "react";
import { Bookmark, BookmarkCheck } from "@/lib/lucide-shim";
import { useSaveArticle } from "@/hooks/useSaveArticle";
import type { BookmarkEntityType } from "@/hooks/useBookmarks";
import { cn } from "@/lib/utils";

type Lang = "pl" | "en";

/**
 * "icon"     - kwadratowy przycisk ikonowy (paski: czytania, mobilny).
 * "labelled" - pełna szerokość z etykietą (panele, arkusze, sidebar).
 */
type SaveArticleButtonVariant = "icon" | "labelled";

const COPY = {
  pl: {
    save: "Zapisz na później",
    saved: "Zapisano",
    remove: "Usuń z zapisanych",
  },
  en: {
    save: "Save for later",
    saved: "Saved",
    remove: "Remove from saved",
  },
} as const;

interface Props {
  /** Tytuł artykułu - trafia do listy zapisanych gościa. */
  title: string;
  lang: Lang;
  /** Identyfikator wpisu/strony; bez niego zapis idzie tylko do localStorage. */
  entityId?: string;
  entityType?: BookmarkEntityType;
  /**
   * Adres artykułu. Pominięty = czytany z `window.location` po montażu, żeby
   * SSR i hydratacja renderowały identyczny znacznik.
   */
  url?: string;
  variant?: SaveArticleButtonVariant;
  className?: string;
}

export function SaveArticleButton({
  title,
  lang,
  entityId,
  entityType = "post",
  url,
  variant = "icon",
  className,
}: Props) {
  const t = COPY[lang];
  const [href, setHref] = useState(url ?? "");

  // Ten sam sposób ustalania adresu co w FloatingShareBar: przy nawigacji
  // wpis->wpis poddrzewo bywa reużyte, więc adres odświeżamy też przy zmianie
  // artykułu, a nie tylko na montażu.
  useEffect(() => {
    if (url) {
      setHref(url);
      return;
    }
    if (typeof window !== "undefined") setHref(window.location.href);
  }, [url, entityId, title]);

  const { isSaved, toggle } = useSaveArticle({ entityId, entityType, url: href, title, lang });
  const label = isSaved ? t.remove : t.save;
  const Icon = isSaved ? BookmarkCheck : Bookmark;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={isSaved}
      aria-label={label}
      title={label}
      data-save-article
      data-saved={isSaved ? "true" : "false"}
      className={cn(
        "inline-flex shrink-0 items-center justify-center transition active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
        variant === "icon"
          ? cn(
              "h-7 w-7 rounded-md",
              isSaved ? "text-brand" : "text-foreground hover:text-brand hover:bg-muted",
            )
          : cn(
              "h-11 w-full gap-1.5 rounded-[5px] text-[12px] font-semibold tracking-tight",
              isSaved
                ? "border border-brand/40 bg-brand/10 text-brand"
                : "border border-border bg-background text-foreground hover:bg-muted",
            ),
        className,
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          variant === "icon" ? "h-4 w-4" : "h-[15px] w-[15px]",
          "transition-transform",
          isSaved && variant === "icon" ? "scale-110" : "",
        )}
      />
      {variant === "labelled" && <span>{isSaved ? t.saved : t.save}</span>}
    </button>
  );
}
