// Atom: pole tekstowe rozmowy w klubie - @wzmianki z podpowiedziami
// i wysyłka skrótem.
//
// DLACZEGO NIE `MentionTextarea`. Tamto pole ma pływającą etykietę i stałą
// wysokość czterech linii - pasuje do kompozytora odpowiedzi na stronie wątku,
// a w karcie strumienia rozpychałoby kartę, zanim ktokolwiek zacznie pisać.
// Tutaj pole startuje od JEDNEJ linii i rośnie z treścią do ~sześciu (potem
// przewija się w środku), jak komentarz w serwisie społecznościowym dla
// profesjonalistów. Logikę wzmianek (token pod kursorem, klawiatura, ARIA
// combobox) bierze ze współdzielonego `useMentionAutocomplete` - ta sama, co
// w każdym innym polu z wzmiankami.
//
// ZAKRES KLUBU. `clubId` zawęża podpowiedzi do rozmowy w tym klubie: obok
// publicznego katalogu (autorzy, eksperci, firmy) pojawiają się członkowie
// TEGO klubu, za bramką `can_see_members` po stronie bazy.
//
// KLAWIATURA. Enter zostaje nową linią (pole deliberacji, nie czat - patrz
// `threadComposer.ts`). Ctrl/Cmd+Enter wysyła, ale TYLKO przy zamkniętej
// liście podpowiedzi: przy otwartej Enter wybiera osobę, a Escape zamyka
// listę (to robi hook). Własny `onKeyDown` wołającego (np. autoformat list)
// dostaje zdarzenie dopiero wtedy, gdy lista go nie skonsumowała.
//
// LISTA PODPOWIEDZI nie jest portalem - stoi pod polem w `relative`. Dlatego
// to pole NIGDY nie może stać w `ClubFeedText` (`overflow: clip` ucięłoby listę).
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
  type MutableRefObject,
} from "react";
import { MentionSuggestionList } from "@/components/mentions/MentionSuggestionList";
import { useMentionAutocomplete } from "@/lib/mentions/useMentionAutocomplete";
import type { MentionSuggestionScope } from "@/lib/mentions/useMentionSuggestions";
import { clubComposerKeyIntent } from "@/lib/clubs/threadComposer";
import { cn } from "@/lib/utils";

/** Liczba linii, do której pole rośnie, zanim zacznie przewijać się w środku. */
const DEFAULT_MAX_ROWS = 6;

function px(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface ClubMentionFieldProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  lang: "pl" | "en";
  /** Klub rozmowy - podpowiedzi obejmują wtedy członków tego klubu. */
  clubId: string | null;
  /** Nazwa pola dla czytnika ekranu (pole nie ma widocznej etykiety). */
  label: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  /** Ctrl/Cmd+Enter przy zamkniętej liście podpowiedzi. */
  onSubmit?: () => void;
  /** Dodatkowa obsługa klawiszy - tylko gdy lista podpowiedzi jej nie zjadła. */
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  textareaRef?: MutableRefObject<HTMLTextAreaElement | null>;
  /** Wysokość startowa w liniach (domyślnie jedna). */
  rows?: number;
  maxRows?: number;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
  textareaClassName?: string;
  testId?: string;
}

export function ClubMentionField({
  id,
  value,
  onChange,
  lang,
  clubId,
  label,
  placeholder,
  maxLength,
  disabled = false,
  onSubmit,
  onKeyDown,
  onPaste,
  textareaRef,
  rows = 1,
  maxRows = DEFAULT_MAX_ROWS,
  invalid = false,
  describedBy,
  className,
  textareaClassName,
  testId,
}: ClubMentionFieldProps) {
  const ownRef = useRef<HTMLTextAreaElement | null>(null);
  // Zakres jako STABILNY obiekt - nowy literał co render nic by nie zepsuł
  // (hook czyta samo `clubId`), ale stabilność nic nie kosztuje.
  const scope = useMemo<MentionSuggestionScope | null>(
    () => (clubId !== null && clubId !== "" ? { clubId } : null),
    [clubId],
  );
  const mention = useMentionAutocomplete({
    value,
    onChange,
    lang,
    enabled: !disabled,
    textareaRef: ownRef,
    scope,
  });
  const { setTextarea } = mention;

  // Jeden uchwyt dla trzech właścicieli: hooka wzmianek (kursor, fokus po
  // wyborze), auto-wzrostu i wołającego (fokus po rozwinięciu sekcji).
  const attach = useCallback(
    (node: HTMLTextAreaElement | null) => {
      setTextarea(node);
      if (textareaRef !== undefined) textareaRef.current = node;
    },
    [setTextarea, textareaRef],
  );

  // AUTO-WZROST. Wysokość liczona z treści po każdej zmianie wartości, przed
  // malowaniem - pole nie mruga o linię. Sufit to `maxRows` linii plus
  // wcięcia i obramowanie; powyżej pole przewija się w środku. Gdy element
  // jest ukryty (`scrollHeight` = 0, np. zwinięta sekcja), zostawiamy wysokość
  // przeglądarce - inaczej po rozwinięciu pole miałoby zero pikseli.
  useLayoutEffect(() => {
    const node = ownRef.current;
    if (node === null || typeof window === "undefined") return;
    node.style.height = "auto";
    if (node.scrollHeight === 0) {
      node.style.height = "";
      return;
    }
    const style = window.getComputedStyle(node);
    const border = px(style.borderTopWidth) + px(style.borderBottomWidth);
    const padding = px(style.paddingTop) + px(style.paddingBottom);
    const line = px(style.lineHeight) || 20;
    const ceiling = line * maxRows + padding + border;
    const natural = node.scrollHeight + border;
    node.style.height = `${Math.min(natural, ceiling)}px`;
    node.style.overflowY = natural > ceiling ? "auto" : "hidden";
  }, [value, maxRows]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (!mention.open && onSubmit !== undefined) {
      if (clubComposerKeyIntent(event, false) === "submit") {
        event.preventDefault();
        onSubmit();
        return;
      }
    }
    mention.textareaProps.onKeyDown(event);
    if (event.defaultPrevented || mention.open) return;
    onKeyDown?.(event);
  };

  return (
    <div className={cn("relative min-w-0", className)}>
      <textarea
        id={id}
        ref={attach}
        value={value}
        rows={rows}
        maxLength={maxLength}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-keyshortcuts={onSubmit !== undefined ? "Control+Enter Meta+Enter" : undefined}
        data-testid={testId}
        {...mention.textareaProps}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        onChange={(event) => {
          onChange(event.target.value);
          mention.handleValueChange(event.target);
        }}
        className={cn(
          // `.input` niesie ramkę, fokus i kolory obu motywów - te same, co
          // każde pole serwisu. Wysokość i typografia są klubowe: 13 px treści,
          // jedna linia na start, bez uchwytu zmiany rozmiaru (rośnie sama).
          "input block min-h-10 w-full resize-none py-2 text-sm leading-5 [overflow-wrap:anywhere]",
          textareaClassName,
        )}
      />
      {mention.open ? (
        <MentionSuggestionList
          listId={mention.listId}
          suggestions={mention.suggestions}
          isFetching={mention.isFetching}
          highlight={mention.highlight}
          onHighlight={mention.setHighlight}
          onChoose={mention.choose}
        />
      ) : null}
    </div>
  );
}
