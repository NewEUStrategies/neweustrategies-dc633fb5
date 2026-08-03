// Atom prezentacyjny: lista podpowiedzi @wzmianek (role="listbox").
//
// Wydzielona z `MentionTextarea`, żeby komentarze i pola "wiadomość"
// w widgetach formularzy renderowały DOKŁADNIE tę samą listę.
import { useTranslation } from "react-i18next";
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

export function MentionSuggestionList({
  listId,
  suggestions,
  isFetching,
  highlight,
  onHighlight,
  onChoose,
}: MentionSuggestionListProps) {
  const { t } = useTranslation();
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
            onMouseEnter={() => onHighlight(i)}
            className={`flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm ${
              i === highlight ? "bg-accent text-accent-foreground" : "hover:bg-muted"
            }`}
          >
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
          </li>
        ))
      )}
    </ul>
  );
}
