// Współdzielona logika typeahead @wzmianek (bez warstwy prezentacji pola).
//
// Używana przez `MentionTextarea` (komentarze) oraz przez pole "wiadomość"
// w widgetach formularzy - dzięki temu zachowanie klawiatury, ARIA i wybór
// podpowiedzi są IDENTYCZNE w obu miejscach.
//
// Dostępność: wzorzec combobox + listbox (ARIA 1.2). Hook zwraca gotowe
// `textareaProps` (role/aria-*) oraz handlery klawiatury i kursora.
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
} from "react";
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

export interface UseMentionAutocompleteOptions {
  value: string;
  onChange: (next: string) => void;
  lang: "pl" | "en";
  /** Wyłączenie całkowicie wygasza RPC i listę (pole bez wzmianek). */
  enabled?: boolean;
  /** Ref do textarei; hook nadal utrzymuje własny (wewnętrzny) uchwyt. */
  textareaRef?: MutableRefObject<HTMLTextAreaElement | null>;
}

export interface MentionTextareaAriaProps {
  role: "combobox";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
  "aria-autocomplete": "list";
  "aria-activedescendant": string | undefined;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onKeyUp: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onClick: (e: { currentTarget: HTMLTextAreaElement }) => void;
  onSelect: (e: { currentTarget: HTMLTextAreaElement }) => void;
}

export interface UseMentionAutocompleteResult {
  open: boolean;
  listId: string;
  suggestions: MentionSuggestion[];
  isFetching: boolean;
  highlight: number;
  setHighlight: (index: number) => void;
  choose: (s: MentionSuggestion) => void;
  /** Podpiąć w onChange textarei (aktualizuje pozycję kursora i reset Esc). */
  handleValueChange: (el: HTMLTextAreaElement) => void;
  /** Ref-callback do textarei (spina ref wewnętrzny z zewnętrznym). */
  setTextarea: (el: HTMLTextAreaElement | null) => void;
  textareaProps: MentionTextareaAriaProps;
}

export function useMentionAutocomplete({
  value,
  onChange,
  lang,
  enabled = true,
  textareaRef,
}: UseMentionAutocompleteOptions): UseMentionAutocompleteResult {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  // Esc chowa listę aż do kolejnej zmiany treści (bez natrętnego reopen).
  const [dismissed, setDismissed] = useState(false);

  const active = useMemo<ActiveMention | null>(
    () => (enabled ? findActiveMentionQuery(value, caret) : null),
    [enabled, value, caret],
  );
  // Debounce tylko częściowego query; brak aktywnej wzmianki wyłącza RPC natychmiast.
  const debouncedQuery = useDebouncedValue(active?.query ?? "", 160);
  const queryForHook = active ? debouncedQuery : null;
  const { data: suggestions = [], isFetching } = useMentionSuggestions(queryForHook, lang);

  const open = enabled && !dismissed && active !== null && (suggestions.length > 0 || isFetching);

  // Reset podświetlenia, gdy zmienia się zestaw podpowiedzi.
  useEffect(() => {
    setHighlight(0);
  }, [queryForHook, suggestions.length]);

  const syncCaret = useCallback((el: HTMLTextAreaElement) => {
    setCaret(el.selectionStart ?? el.value.length);
  }, []);

  const setTextarea = useCallback(
    (el: HTMLTextAreaElement | null) => {
      ref.current = el;
      if (textareaRef) textareaRef.current = el;
    },
    [textareaRef],
  );

  const choose = useCallback(
    (s: MentionSuggestion) => {
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
    },
    [active, onChange, value],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
    },
    [choose, highlight, open, suggestions],
  );

  const handleValueChange = useCallback(
    (el: HTMLTextAreaElement) => {
      setDismissed(false);
      syncCaret(el);
    },
    [syncCaret],
  );

  const activeOptionId = open && suggestions[highlight] ? `${listId}-opt-${highlight}` : undefined;

  return {
    open,
    listId,
    suggestions,
    isFetching,
    highlight,
    setHighlight,
    choose,
    handleValueChange,
    setTextarea,
    textareaProps: {
      role: "combobox",
      "aria-expanded": open,
      "aria-controls": open ? listId : undefined,
      "aria-autocomplete": "list",
      "aria-activedescendant": activeOptionId,
      onKeyDown: handleKeyDown,
      onKeyUp: (e) => syncCaret(e.currentTarget),
      onClick: (e) => syncCaret(e.currentTarget),
      onSelect: (e) => syncCaret(e.currentTarget),
    },
  };
}
