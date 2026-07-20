// Molecule: pasek wyszukiwania w treści JEDNEJ rozmowy (wzorzec WhatsApp).
// Renderowany pod nagłówkiem okna czatu; wyniki w wysuwanym panelu pod
// inputem, klik przewija wątek do wiadomości (ChatWindow dociąga starsze
// strony, jeśli trafienie wypadło poza załadowane okno historii).
import "@/lib/i18n-chat";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Search, X } from "lucide-react";
import { SearchSnippet } from "@/components/search/SearchSnippet";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { relTime, type ChatLang } from "@/lib/chat/time";
import {
  MESSAGE_SEARCH_MIN_CHARS,
  useMessageSearch,
  type MessageSearchHit,
} from "@/lib/chat/useMessageSearch";
import { cn } from "@/lib/utils";

export interface MessageSearchBarProps {
  conversationId: string;
  lang: ChatLang;
  /** Nazwa autora trafienia (nickname per rozmowa wygrywa z profilem). */
  resolveAuthorName: (senderId: string) => string;
  onJump: (hit: MessageSearchHit) => void;
  onClose: () => void;
  className?: string;
}

export function MessageSearchBar({
  conversationId,
  lang,
  resolveAuthorName,
  onJump,
  onClose,
  className,
}: MessageSearchBarProps) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const debounced = useDebouncedValue(q, 200);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const active = debounced.trim().length >= MESSAGE_SEARCH_MIN_CHARS;
  const hitsQ = useMessageSearch(debounced, conversationId);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const hits = hitsQ.data ?? [];
  const total = Number(hits[0]?.total_count ?? 0);

  return (
    <div className={cn("relative border-b border-border/60 bg-card/80 px-2 py-1.5", className)}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            // Escape zamyka tylko pasek - nie okno docka (stopPropagation).
            if (e.key === "Escape") {
              e.stopPropagation();
              onClose();
            }
          }}
          placeholder={t("chat.search.inConversation")}
          aria-label={t("chat.search.inConversation")}
          className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-8 text-[13px] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="button"
          onClick={onClose}
          className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t("chat.search.close")}
          title={t("chat.search.close")}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {active && (
        <div className="absolute inset-x-2 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-border/60 bg-popover shadow-lg">
          {hitsQ.isLoading ? (
            <div className="flex items-center gap-2 px-3 py-2.5 text-[12px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {t("chat.search.searching")}
            </div>
          ) : hitsQ.isError ? (
            <p className="px-3 py-2.5 text-[12px] text-muted-foreground">
              {t("chat.search.error")}
            </p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-2.5 text-[12px] text-muted-foreground">
              {t("chat.search.noResults", { q: debounced.trim() })}
            </p>
          ) : (
            <>
              <p
                className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                aria-live="polite"
              >
                {t("chat.search.results", { count: total })}
              </p>
              <ul className="pb-1">
                {hits.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      onClick={() => onJump(hit)}
                      className="w-full px-3 py-2 text-left transition-colors hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none"
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[11px] font-semibold">
                          {resolveAuthorName(hit.sender_id)}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {relTime(hit.created_at, lang)}
                        </span>
                      </span>
                      <SearchSnippet
                        text={hit.snippet ?? ""}
                        className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
