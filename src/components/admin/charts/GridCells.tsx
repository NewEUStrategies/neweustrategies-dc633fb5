// KOMÓRKI SIATKI DANYCH - liczba ze szkicem i etykieta. Wspólne dla siatki
// wykresu (blok CMS, arkusz widgetu) i siatki mapy.
//
// LICZBA MA SZKIC, NIE WARTOŚĆ. Pole sterowane samą liczbą zjadało znaki
// w trakcie pisania: po „1," pokazywało z powrotem „1", a „-" kasowało
// komórkę, więc ułamka ani liczby ujemnej nie dało się wpisać inaczej niż
// wklejeniem. Komórka trzyma więc NAPIS i zatwierdza go dopiero przy
// opuszczeniu (blur), Enterze, Tabie albo wklejeniu - przez
// `parseImportedCell`, czyli tą samą regułą co import pliku i schowek:
// „1 234,5", „12,5%", „−3" i „7 p" (flaga Eurostatu) dają tę samą liczbę
// bez względu na drogę.
//
// WPIS, KTÓRY LICZBĄ NIE JEST, NIE ZAMIENIA SIĘ W LUKĘ. Do PR2 „abc" dawało
// po cichu `null` - wykres tracił punkt, a redaktor nie wiedział, dlaczego.
// Teraz komórka zostaje z wpisem, dostaje `aria-invalid` i zdanie, a treść
// trzyma poprzednią liczbę, dopóki wpis nie zostanie poprawiony albo
// wyczyszczony. Puste pole i jawny brak danych („:" Eurostatu) są LUKĄ.
//
// WKLEJENIE ZAKRESU (schowek z więcej niż jedną komórką) nie trafia do pola:
// komórka oddaje tabelę siatce razem ze swoimi współrzędnymi (kotwica),
// a siatka zapisuje ją jednym `onChange`. Pojedyncza wartość wkleja się
// w pole i od razu zatwierdza.
import { useId, useRef, useState } from "react";
import {
  clipboardPayloadOf,
  readClipboardTable,
  type ClipboardTable,
} from "@/lib/charts/clipboardTable";
import type { GridAnchor } from "@/lib/charts/gridModel";
import { cn } from "@/lib/utils";
import { gridCellAttrs, handleGridKey, isMenuKey } from "./gridKeyboard";
import { formatCellNumber, gridCellCls, readCellDraft } from "./gridCellValue";

interface CommonCellProps {
  row: number;
  col: number;
  /** Nazwa dostępna komórki - dla wartości „{kategoria} - {seria}". */
  label: string;
  /** Zakres ze schowka wklejony w tę komórkę (kotwica = jej współrzędne). */
  onTablePaste: (table: ClipboardTable, anchor: GridAnchor) => void;
  /** Klawisz menu kontekstowego albo Shift+F10 - menu wiersza lub kolumny. */
  onOpenMenu?: () => void;
  placeholder?: string;
  className?: string;
}

interface NumberCellProps extends CommonCellProps {
  value: number | null;
  /** Konwencja wyświetlania liczby (język dokumentu). */
  lang: "pl" | "en";
  /** Zdanie dla wpisu, który liczbą nie jest. */
  invalidText: string;
  onCommit: (value: number | null) => void;
}

export function NumberCell({
  value,
  lang,
  invalidText,
  onCommit,
  row,
  col,
  label,
  onTablePaste,
  onOpenMenu,
  placeholder = "-",
  className,
}: NumberCellProps) {
  const shown = formatCellNumber(value, lang);
  const [draft, setDraft] = useState(shown);
  const [seen, setSeen] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const messageId = useId();
  // Napis ostatnio zatwierdzony. Enter zatwierdza i przenosi fokus, a utrata
  // fokusu zatwierdza drugi raz - jeszcze ze starą wartością w domknięciu,
  // więc bez tej pamięci ta sama zmiana szłaby do historii dwa razy.
  const committed = useRef<string | null>(null);

  // Wartość zmieniona Z ZEWNĄTRZ (cofnięcie, wklejenie zakresu, import)
  // wymienia szkic - chyba że szkic już mówi to samo (wpisane „12,5" po
  // zatwierdzeniu zostaje „12,5", a nie przeskakuje na zapis kanoniczny).
  if (seen !== value) {
    setSeen(value);
    const r = readCellDraft(draft);
    if (!r.ok || r.value !== value) {
      setDraft(shown);
      setInvalid(false);
    }
  }

  const commitText = (text: string) => {
    if (committed.current === text) return;
    const r = readCellDraft(text);
    if (!r.ok) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    committed.current = text;
    if (r.value !== value) onCommit(r.value);
  };

  const dirty = (() => {
    const r = readCellDraft(draft);
    return !r.ok || r.value !== value;
  })();

  return (
    <>
      <input
        {...gridCellAttrs(row, col)}
        className={cn(gridCellCls, "text-right", className)}
        inputMode="decimal"
        value={draft}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? messageId : undefined}
        title={invalid ? invalidText : undefined}
        onChange={(e) => {
          committed.current = null;
          setDraft(e.target.value);
          if (invalid) setInvalid(false);
        }}
        onBlur={() => commitText(draft)}
        onKeyDown={(e) => {
          // Ctrl+Z przy NIEZATWIERDZONYM szkicu cofa sam szkic - to jest
          // ostatnia edycja. Zdarzenie nie idzie wtedy dalej, do historii
          // bloku albo buildera, bo cofnęłoby DRUGĄ zmianę naraz.
          if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
            if (dirty) {
              e.preventDefault();
              e.stopPropagation();
              committed.current = null;
              setDraft(shown);
              setInvalid(false);
            }
            return;
          }
          if (onOpenMenu && isMenuKey(e)) {
            e.preventDefault();
            onOpenMenu();
            return;
          }
          handleGridKey(e, () => commitText(draft));
        }}
        onPaste={(e) => {
          const table = readClipboardTable(clipboardPayloadOf(e));
          if (table !== null) {
            e.preventDefault();
            onTablePaste(table, { row, col });
            return;
          }
          const text = e.clipboardData?.getData("text/plain") ?? "";
          if (text === "") return;
          // Pojedyncza wartość: wpis w miejscu zaznaczenia i od razu zapis.
          e.preventDefault();
          const input = e.currentTarget;
          const from = input.selectionStart ?? draft.length;
          const to = input.selectionEnd ?? draft.length;
          const next = draft.slice(0, from) + text.trim() + draft.slice(to);
          committed.current = null;
          setDraft(next);
          commitText(next);
        }}
      />
      {invalid && (
        <span
          id={messageId}
          className="mt-0.5 block max-w-[10rem] text-[10px] leading-tight"
          style={{ color: "var(--chart-negative-text)" }}
        >
          {invalidText}
        </span>
      )}
    </>
  );
}

interface TextCellProps extends CommonCellProps {
  value: string;
  onChange: (value: string) => void;
  /** Filtr wpisu - arkusz widgetu zamienia średnik i złamanie wiersza (format `csv.ts`). */
  sanitize?: (raw: string) => string;
}

/**
 * Etykieta kategorii albo nazwa serii. Zapis idzie na bieżąco (napis nie ma
 * stanu pośredniego, który trzeba by chronić), a wklejenie zakresu - jak
 * w komórce liczby - trafia do siatki od tej komórki.
 */
export function TextCell({
  value,
  onChange,
  sanitize,
  row,
  col,
  label,
  onTablePaste,
  onOpenMenu,
  placeholder,
  className,
}: TextCellProps) {
  return (
    <input
      {...gridCellAttrs(row, col)}
      className={cn(gridCellCls, className)}
      value={value}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => onChange(sanitize ? sanitize(e.target.value) : e.target.value)}
      onKeyDown={(e) => {
        if (onOpenMenu && isMenuKey(e)) {
          e.preventDefault();
          onOpenMenu();
          return;
        }
        handleGridKey(e);
      }}
      onPaste={(e) => {
        const table = readClipboardTable(clipboardPayloadOf(e));
        if (table === null) return;
        e.preventDefault();
        onTablePaste(table, { row, col });
      }}
    />
  );
}
