// Molekuła: FloatingTextarea + podpowiedzi @wzmianek (typeahead). Drop-in dla
// kompozytora komentarza - kontroluje wartość (string) i wykrywa token „@..."
// pod kursorem czystymi funkcjami z @/lib/mentions/parse, po czym podpowiada
// osoby z tenant-owego RPC (useMentionSuggestions). Wybór wstawia „@slug ".
//
// Dostępność: wzorzec combobox + listbox (ARIA 1.2). Textarea niesie
// role="combobox", aria-expanded, aria-controls i aria-activedescendant; lista
// to role="listbox" z role="option". Nawigacja klawiaturą: ↑/↓ zmienia
// zaznaczenie, Enter/Tab wybiera, Esc zamyka do następnej zmiany treści.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { FloatingTextarea } from "@/components/ui/floating-input";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  applyMentionSelection,
  findActiveMentionQuery,
  type ActiveMention,
} from "@/lib/mentions/parse";
import {
  useMentionSuggestions,
  type MentionSuggestion,
} from "@/lib/mentions/useMentionSuggestions";
import { ensureI18n } from "@/lib/i18n-mentions";

ensureI18n();

interface MentionTextareaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  lang: "pl" | "en";
  rows?: number;
  maxLength?: number;
  id?: string;
  autoFocus?: boolean;
}

export function MentionTextarea({
  label,
  value,
  onChange,
  lang,
  rows = 4,
  maxLength,
  id,
  autoFocus,
}: MentionTextareaProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  // Esc chowa listę aż do kolejnej zmiany treści (bez natrętnego reopen).
  const [dismissed, setDismissed] = useState(false);

  const active = useMemo<ActiveMention | null>(
    () => findActiveMentionQuery(value, caret),
    [value, caret],
  );
  // Debounce tylko częściowego query; brak aktywnej wzmianki wyłącza RPC natychmiast.
  const debouncedQuery = useDebouncedValue(active?.query ?? "", 160);
  const queryForHook = active ? debouncedQuery : null;
  const { data: suggestions = [], isFetching } = useMentionSuggestions(queryForHook, lang);

  const open = !dismissed && active !== null && (suggestions.length > 0 || isFetching);

  // Reset podświetlenia, gdy zmienia się zestaw podpowiedzi.
  useEffect(() => {
    setHighlight(0);
  }, [queryForHook, suggestions.length]);

  function syncCaret(el: HTMLTextAreaElement) {
    setCaret(el.selectionStart ?? el.value.length);
  }

  function choose(s: MentionSuggestion) {
    if (!active) return;
    const next = applyMentionSelection(value, active, s.slug);
    onChange(next.value);
    setDismissed(false);
    // Po re-renderze przywróć fokus i kursor za wstawioną wzmianką.
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
      setCaret(next.caret);
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open || suggestions.length === 0) {
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setDismissed(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      const picked = suggestions[highlight];
      if (picked) {
        e.preventDefault();
        choose(picked);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDismissed(true);
    }
  }

  const activeOptionId = open && suggestions[highlight] ? `${listId}-opt-${highlight}` : undefined;

  return (
    <div className="relative">
      <FloatingTextarea
        ref={ref}
        id={id}
        label={label}
        value={value}
        rows={rows}
        maxLength={maxLength}
        lang={lang}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        onChange={(e) => {
          onChange(e.target.value);
          setDismissed(false);
          syncCaret(e.target);
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={(e) => syncCaret(e.currentTarget)}
        onClick={(e) => syncCaret(e.currentTarget)}
        onSelect={(e) => syncCaret(e.currentTarget)}
      />
      {open && (
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
                  choose(s);
                }}
                onMouseEnter={() => setHighlight(i)}
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
      )}
    </div>
  );
}
