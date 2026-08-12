// Atom prezentacyjny: lista podpowiedzi @wzmianek (role="listbox").
//
// Wydzielona z `MentionTextarea`, żeby komentarze i pola "wiadomość"
// w widgetach formularzy renderowały DOKŁADNIE tę samą listę.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useMentionProfile } from "@/lib/mentions/useMentionProfile";
import type { MentionSuggestion } from "@/lib/mentions/useMentionSuggestions";
import { ensureI18n } from "@/lib/i18n-mentions";

ensureI18n();

export interface MentionSuggestionListProps {
  listId: string;
  suggestions: MentionSuggestion[];
  isFetching: boolean;
  highlight: number;
  onHighlight: (index: number) => void;
  onChoose: (s: MentionSuggestion) => void;
}

/** Wizytówka osoby pod pozycją listy - podgląd PRZED wstawieniem wzmianki. */
function SuggestionPreview({ slug, lang }: { slug: string; lang: "pl" | "en" }) {
  const { data, isPending } = useMentionProfile(slug, lang, true);
  if (isPending) return <p className="text-xs text-muted-foreground">...</p>;
  if (!data) return <p className="text-xs text-muted-foreground">@{slug}</p>;
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-muted-foreground">
          {data.avatarUrl ? (
            <img src={data.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            data.name.slice(0, 2).toLocaleUpperCase()
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{data.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[data.jobTitle, data.company].filter(Boolean).join(" - ") || `@${slug}`}
          </p>
        </div>
      </div>
      {data.bio ? (
        <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{data.bio}</p>
      ) : null}
    </div>
  );
}

export function MentionSuggestionList({
  listId,
  suggestions,
  isFetching,
  highlight,
  onHighlight,
  onChoose,
}: MentionSuggestionListProps) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const [previewSlug, setPreviewSlug] = useState<string | null>(null);
  return (
    <ul
      id={listId}
      role="listbox"
      aria-label={t("mentions.listLabel")}
      className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-auto rounded-[8px] border border-border bg-popover p-1 shadow-lg"
    >
      {isFetching && suggestions.length === 0 ? (
        <li className="px-3 py-2 text-sm text-muted-foreground" aria-disabled>
          {t("mentions.loading")}
        </li>
      ) : (
        suggestions.map((s, i) => (
          <li
            key={s.slug}
            id={`${listId}-opt-${i}`}
            role="option"
            aria-selected={i === highlight}
            // onMouseDown zamiast onClick: wybór PRZED blur textarei.
            onMouseDown={(e) => {
              e.preventDefault();
              onChoose(s);
            }}
            onMouseEnter={() => {
              onHighlight(i);
              setPreviewSlug(s.slug);
            }}
            onMouseLeave={() => setPreviewSlug((cur) => (cur === s.slug ? null : cur))}
            className={`flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm ${
              i === highlight ? "bg-accent text-accent-foreground" : "hover:bg-muted"
            }`}
          >
            <HoverCard open={previewSlug === s.slug} openDelay={250}>
              <HoverCardTrigger asChild>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    aria-hidden
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[10px] font-medium text-muted-foreground"
                  >
                    {s.avatarUrl ? (
                      <img src={s.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      s.name.slice(0, 2).toUpperCase()
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{s.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      @{s.slug}
                      {s.subtitle ? ` - ${s.subtitle}` : ""}
                    </span>
                  </span>
                </span>
              </HoverCardTrigger>
              <HoverCardContent side="right" align="start" className="w-72">
                <SuggestionPreview slug={s.slug} lang={lang} />
              </HoverCardContent>
            </HoverCard>
          </li>
        ))
      )}
    </ul>
  );
}
