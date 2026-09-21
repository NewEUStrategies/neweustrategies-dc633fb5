// Atom prezentacyjny: lista podpowiedzi @wzmianek (role="listbox").
//
// Wydzielona z `MentionTextarea`, żeby komentarze i pola "wiadomość"
// w widgetach formularzy renderowały DOKŁADNIE tę samą listę.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Building2 } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useMentionProfile } from "@/lib/mentions/useMentionProfile";
import type { MentionSuggestion } from "@/lib/mentions/useMentionSuggestions";
import { MentionPersonCard, type MentionTagLabels } from "@/components/mentions/MentionTag";
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

/**
 * Wizytówka pod pozycją listy - podgląd PRZED wstawieniem wzmianki.
 *
 * Nicku tu nie ma: podgląd ma odpowiedzieć „kto to jest", a `@slug` na to
 * pytanie nie odpowiada. Gdy profilu nie da się pobrać, mówimy to wprost.
 * Organizacja nie ma profilu osoby - pokazujemy to, co przyszło z podpowiedzi.
 */
function SuggestionPreview({
  suggestion,
  lang,
  labels,
  loadingLabel,
}: {
  suggestion: MentionSuggestion;
  lang: "pl" | "en";
  labels: MentionTagLabels;
  loadingLabel: string;
}) {
  const { data, isPending } = useMentionProfile(
    suggestion.kind === "person" ? suggestion.slug : null,
    lang,
    suggestion.kind === "person",
  );
  if (suggestion.kind === "org") {
    return (
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-primary/10 text-primary"
        >
          {suggestion.avatarUrl ? (
            <img src={suggestion.avatarUrl} alt="" className="h-full w-full object-contain" />
          ) : (
            <Building2 className="h-5 w-5" />
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{suggestion.name}</p>
          {suggestion.subtitle ? (
            <p className="truncate text-xs text-muted-foreground">{suggestion.subtitle}</p>
          ) : null}
        </div>
      </div>
    );
  }
  if (isPending) return <p className="text-xs text-muted-foreground">{loadingLabel}</p>;
  if (!data) return <p className="text-xs text-muted-foreground">{labels.noProfile}</p>;
  return <MentionPersonCard person={data} labels={labels} />;
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
  const labels: MentionTagLabels = {
    noProfile: t("mentions.noProfile"),
    viewProfile: t("mentions.viewProfile"),
    verified: t("mentions.verified"),
    viewOrg: t("mentions.viewOrg"),
  };
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
                    ) : s.kind === "org" ? (
                      <Building2 className="h-3.5 w-3.5" />
                    ) : (
                      s.name.slice(0, 2).toUpperCase()
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{s.name}</span>
                    {s.subtitle ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {s.subtitle}
                      </span>
                    ) : null}
                  </span>
                </span>
              </HoverCardTrigger>
              <HoverCardContent side="right" align="start" className="w-72">
                <SuggestionPreview
                  suggestion={s}
                  lang={lang}
                  labels={labels}
                  loadingLabel={t("mentions.loading")}
                />
              </HoverCardContent>
            </HoverCard>
          </li>
        ))
      )}
    </ul>
  );
}
