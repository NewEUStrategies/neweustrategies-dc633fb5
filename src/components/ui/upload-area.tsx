// GLOBALNY STANDARD OBSZARU WGRYWANIA PLIKÓW (upload area).
//
// PO CO TO ISTNIEJE. Platforma miała kilkanaście niezależnych „miejsc na plik"
// i każde wyglądało inaczej: przerywana ramka 1 px w `EventImageDropzone`,
// przerywana ramka 2 px w imporcie leadów CRM, zwykły przycisk `Wgraj` w
// `ImageSlot`, `<label>` z ukrytym inputem w uploaderze fontów, a w menedżerze
// mediów wyłącznie obrys całego kanwasu. Rozjechały się nie tylko style -
// rozjechały się AFORDANCJE: część pól przyjmowała upuszczony plik, część
// wyłącznie kliknięcie, część nie mówiła wprost, co wolno wgrać. Użytkownik
// uczył się każdego pola od nowa.
//
// Ten komponent jest jedyną warstwą prezentacji takich obszarów. Wnosi:
//   1. jeden układ (przerywana ramka + klaster ikon + tytuł + opis + CTA),
//   2. jedną afordancję: klik w dowolne miejsce obszaru ORAZ upuszczenie pliku,
//   3. jeden stan zajętości (spinner w CTA + `aria-busy`) i jedno miejsce na błąd,
//   4. jeden kontrakt: `onFiles(File[])` - walidacja MIME/rozmiaru zostaje po
//      stronie wywołującego, bo limity są różne (10 MB obraz, 300 MB audio),
//   5. jeden filtr, którego przeglądarka NIE robi: plik UPUSZCZONY jest
//      sprawdzany względem `accept` (okno systemowe filtruje samo, upuszczenie
//      nie filtruje nic), a odrzucone pliki wracają do wywołującego przez
//      `onRejectedFiles` - żeby odmowa nie była ciszą.
//
// CZEGO TEN KOMPONENT NIE ROBI: nie wysyła bajtów i nie zna Supabase. Ścieżka
// uploadu mediów ma własny, opisany kontrakt (`src/lib/media/upload.ts`) i to
// on zostaje autorytetem - tutaj jest wyłącznie powłoka interakcji.
import * as React from "react";
import { Loader2, UploadCloud } from "lucide-react";

import { Button } from "@/components/ui/button";
import { matchesAccept } from "@/lib/media/acceptMatch";
import { cn } from "@/lib/utils";

/**
 * Ikona klastra. Typ jest STRUKTURALNY, nie `LucideIcon`: platforma renderuje
 * ikony przez `@/lib/lucide-shim` (przełącznik pakietu Lucide / Font Awesome),
 * a tamten alias to `React.FC<IconProps>` - inny nominalnie, zgodny w użyciu.
 * Oba pasują tutaj, więc obszar wgrywania nie wymusza porzucenia przełącznika.
 */
export type UploadAreaIcon = React.ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

export interface UploadAreaProps {
  /**
   * Nagłówek obszaru, np. „Wgraj materiał". Tekst pochodzi z i18n wywołującego.
   * `ReactNode`, bo część pól stawia przy nazwie ikonę rodzaju pliku - nazwę
   * obszaru i tak składa `aria-labelledby`, więc dostępność tego nie traci.
   */
  title: React.ReactNode;
  /** Zdanie pod tytułem: co wolno wgrać i jaki jest limit. `\n` łamie wiersz. */
  description: string;
  /** Etykieta przycisku otwierającego wybór pliku (CTA). */
  ctaLabel: string;
  /**
   * Ikony klastra: JEDNA, DWIE albo TRZY (nadmiar jest obcinany). Jedna stoi
   * prosto, dwie i trzy układają się w wachlarz rozchodzący się przy najechaniu.
   * Domyślnie chmurka uploadu - obszar bez ikon nie istnieje.
   */
  icons?: readonly UploadAreaIcon[];
  /** Odebrane pliki: z pickera albo z upuszczenia. Nigdy nie jest pustą listą. */
  onFiles: (files: File[]) => void;
  /**
   * Wartość atrybutu `accept` dla `<input type="file">` (jawna lista MIME).
   * Obszar egzekwuje ją TAKŻE przy upuszczeniu - przeglądarka tego nie robi.
   */
  accept?: string;
  /**
   * Pliki odrzucone przez `accept` przy upuszczeniu. Bez tego wywołania
   * odrzucenie byłoby CISZĄ: użytkownik upuszcza plik i nic się nie dzieje.
   * Wywołujący zna własną kopię komunikatu, więc to on ją pokazuje.
   */
  onRejectedFiles?: (files: File[]) => void;
  /** Czy picker przyjmuje wiele plików naraz. */
  multiple?: boolean;
  disabled?: boolean;
  /** Trwa wysyłka: CTA dostaje spinner, obszar przestaje przyjmować pliki. */
  busy?: boolean;
  /** Etykieta CTA na czas wysyłki (domyślnie zostaje `ctaLabel`). */
  busyLabel?: string;
  /** Komunikat błędu pod obszarem - renderowany z `role="alert"`. */
  error?: string | null;
  /**
   * `id` węzła z błędem. Rodzic, który sam wskazuje na komunikat
   * (`aria-describedby` na własnym kontenerze - tak robi formularz kariery),
   * podaje tu swój identyfikator zamiast zgadywać wygenerowany.
   */
  errorId?: string;
  /** Dodatkowa podpowiedź pod CTA (np. rekomendowane wymiary). */
  hint?: React.ReactNode;
  /** Podgląd zastępujący klaster ikon, gdy plik jest już wybrany. */
  preview?: React.ReactNode;
  /** Dodatkowe akcje obok CTA (np. „Usuń", „Wybierz z biblioteki"). */
  actions?: React.ReactNode;
  /** Treść dopięta pod obszarem, wciąż w jego kolumnie (np. pole z adresem URL). */
  footer?: React.ReactNode;
  /**
   * `sm` - wariant do paneli bocznych i wąskich kolumn (mniejszy padding,
   * mniejszy klaster). Identyczny język wizualny, inna gęstość.
   */
  size?: "sm" | "md";
  className?: string;
  /** `id` ukrytego inputu - do powiązania z zewnętrzną etykietą. */
  inputId?: string;
  /** Dostępna nazwa ukrytego inputu (domyślnie `ctaLabel`). */
  inputLabel?: string;
  /** Nazwa pola - dla formularzy wysyłanych natywnie. */
  name?: string;
  "data-testid"?: string;
  /** `data-testid` ukrytego pola pliku - testy i E2E celują w sam picker. */
  inputTestId?: string;
}

/** Czy przeciągane dane w ogóle niosą pliki (a nie np. element listy mediów). */
function carriesFiles(transfer: DataTransfer | null): boolean {
  if (transfer === null) return false;
  // `types` jest w Safari `DOMStringList`, w reszcie `ReadonlyArray<string>`;
  // `Array.from` obsługuje oba bez rozgałęzienia.
  return Array.from(transfer.types).includes("Files");
}

/**
 * Czy kliknięcie padło w element, który sam coś robi (CTA, link, pole).
 *
 * `audio`/`video` SĄ NA TEJ LIŚCIE I TO NIE JEST OSTROŻNOŚĆ NA ZAPAS. Natywne
 * kontrolki odtwarzacza żyją w shadow DOM elementu medialnego, więc kliknięcie
 * w „play" bąbelkuje do obszaru jako kliknięcie w `<audio>`. Bez tego wpisu
 * próba odsłuchania wgranego pliku w polu audio wpisu OTWIERAŁA OKNO WYBORU
 * PLIKU (zgłoszenie Codeksa P2 do `AudioPicker`, który renderuje
 * `<audio controls>` w podglądzie obszaru).
 */
function hitsInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest(
      "button, a, input, select, textarea, label, audio, video, summary, [role='button'], [contenteditable='true']",
    ) !== null
  );
}

export function UploadArea({
  title,
  description,
  ctaLabel,
  icons = [UploadCloud],
  onFiles,
  onRejectedFiles,
  accept,
  multiple = false,
  disabled = false,
  busy = false,
  busyLabel,
  error = null,
  errorId,
  hint,
  preview,
  actions,
  footer,
  size = "md",
  className,
  inputId,
  inputLabel,
  name,
  "data-testid": testId,
  inputTestId,
}: UploadAreaProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  // Licznik wejść/wyjść: `dragleave` leci TAKŻE przy przejściu nad dzieckiem,
  // więc sam boolean migałby ramką na każdej ikonie w środku.
  const dragDepth = React.useRef(0);
  const titleId = React.useId();
  const descriptionId = React.useId();
  const generatedErrorId = React.useId();
  const alertId = errorId ?? generatedErrorId;

  const locked = disabled || busy;

  const openPicker = (): void => {
    if (locked) return;
    inputRef.current?.click();
  };

  /**
   * @param enforceAccept - `true` dla upuszczenia (przeglądarka nie filtruje),
   *   `false` dla okna systemowego (tam `accept` zadziałał już wcześniej,
   *   a użytkownik mógł świadomie wybrać „wszystkie pliki" - wtedy decyduje
   *   walidacja wywołującego, tak jak przed ujednoliceniem).
   */
  const emit = (files: FileList | File[] | null, enforceAccept: boolean): void => {
    if (files === null) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    if (!enforceAccept) {
      onFiles(list);
      return;
    }
    const passed = list.filter((file) => matchesAccept(file, accept));
    const rejected = list.filter((file) => !matchesAccept(file, accept));
    if (rejected.length > 0) onRejectedFiles?.(rejected);
    if (passed.length > 0) onFiles(passed);
  };

  const resetDrag = (): void => {
    dragDepth.current = 0;
    setDragOver(false);
  };

  const compact = size === "sm";

  /**
   * KLASTER ZNOSI KAŻDĄ LICZBĘ IKON, NIE TYLKO JEDNĄ I TRZY.
   *
   * Pierwsza wersja miała `icons.length === 3 ? wachlarz : pojedynczy kafel`,
   * więc pole, które podało DWIE ikony (a tak robi połowa powierzchni:
   * `[Obraz, Upload]`, `[Budynek, Upload]`, `[Dokument, Upload]`), renderowało
   * po cichu WYŁĄCZNIE PIERWSZĄ. Druga ikona znikała bez śladu w typach i bez
   * błędu - klasyczna cicha strata, którą widać dopiero na ekranie.
   */
  const tiles = icons.slice(0, 3);
  const tileBase = cn(
    "bg-background grid place-items-center rounded-xl shadow-lg ring-1 ring-border transition duration-500 relative",
    compact ? "size-10" : "size-12",
  );
  const tileClass = (index: number, count: number): string => {
    // Kafel środkowy (albo jedyny) stoi prosto; boczne rozchodzą się na boki.
    const side =
      count === 1
        ? "center"
        : count === 2
          ? index === 0
            ? "left"
            : "right"
          : ["left", "center", "right"][index];
    if (side === "left") {
      return cn(
        tileBase,
        "left-2.5 top-1.5 -rotate-6",
        !locked &&
          "group-hover:-translate-x-5 group-hover:-rotate-12 group-hover:-translate-y-0.5 group-hover:duration-200",
      );
    }
    if (side === "right") {
      return cn(
        tileBase,
        "right-2.5 top-1.5 rotate-6",
        !locked &&
          "group-hover:translate-x-5 group-hover:rotate-12 group-hover:-translate-y-0.5 group-hover:duration-200",
      );
    }
    return cn(tileBase, "z-10", !locked && "group-hover:-translate-y-0.5 group-hover:duration-200");
  };

  return (
    // JEDEN KORZEŃ, ŚWIADOMIE. Wcześniej obszar miał opakowanie trzymające
    // `max-w`, a `className` schodziło do środka - więc klasa układu podana
    // przez wywołującego (`md:col-span-2` w oknie pasma wydarzenia, `mx-auto`
    // w dialogach importu) lądowała na elemencie, który NIE JEST dzieckiem
    // siatki rodzica, i nie robiła nic. Teraz wszystko stoi na jednym węźle,
    // a `tailwind-merge` pozwala wywołującemu nadpisać także `max-w`.
    <div
      data-slot="upload-area"
      data-drag-over={dragOver ? "true" : undefined}
      data-busy={busy ? "true" : undefined}
      data-testid={testId}
      role="group"
      aria-labelledby={titleId}
      aria-describedby={error === null || error === "" ? descriptionId : alertId}
      aria-busy={busy || undefined}
      aria-disabled={disabled || undefined}
      className={cn(
        "bg-background border-border text-center",
        "border-2 border-dashed rounded-xl w-full",
        compact ? "p-6" : "max-w-[620px] p-14",
        "group transition duration-500 hover:duration-200",
        locked
          ? "cursor-not-allowed opacity-60"
          : "cursor-pointer hover:border-border/80 hover:bg-muted/50",
        dragOver && !locked && "border-primary bg-primary/5",
        error !== null && error !== "" && "border-destructive/60",
        className,
      )}
      onClick={(event) => {
        // CTA (i każdy inny sterownik w środku) obsługuje się sam - bez tego
        // warunku kliknięcie w przycisk otwierałoby picker DWA razy.
        if (hitsInteractive(event.target)) return;
        openPicker();
      }}
      onDragEnter={(event) => {
        if (locked || !carriesFiles(event.dataTransfer)) return;
        event.preventDefault();
        // Obszar PRZEJMUJE gest. Bez zatrzymania bąbelkowania rodzic, który
        // też słucha upuszczenia (kanwa mediów, dialog biblioteki), podświetla
        // się razem z obszarem - a przy `drop` wgrałby ten sam plik DRUGI RAZ.
        event.stopPropagation();
        dragDepth.current += 1;
        setDragOver(true);
      }}
      onDragOver={(event) => {
        if (locked || !carriesFiles(event.dataTransfer)) return;
        // Bez `preventDefault` przeglądarka OTWIERA upuszczony plik zamiast
        // oddać go stronie - to nie jest kosmetyka, tylko warunek działania.
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (locked || !carriesFiles(event.dataTransfer)) return;
        event.stopPropagation();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragOver(false);
      }}
      onDrop={(event) => {
        if (locked || !carriesFiles(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        resetDrag();
        emit(event.dataTransfer.files, true);
      }}
    >
      <div className="flex justify-center isolate">
        {preview !== undefined && preview !== null
          ? preview
          : tiles.map((Icon, index) => (
              <div key={index} className={tileClass(index, tiles.length)}>
                <Icon
                  className={cn(compact ? "w-5 h-5" : "w-6 h-6", "text-muted-foreground")}
                  aria-hidden="true"
                />
              </div>
            ))}
      </div>

      <p id={titleId} className={cn("text-foreground font-medium", compact ? "mt-4" : "mt-6")}>
        {title}
      </p>
      <p id={descriptionId} className="text-sm text-muted-foreground mt-1 whitespace-pre-line">
        {description}
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={locked}
          aria-describedby={descriptionId}
          className="shadow-sm active:shadow-none"
          onClick={openPicker}
        >
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {busy ? (busyLabel ?? ctaLabel) : ctaLabel}
        </Button>
        {actions}
      </div>

      {hint !== undefined && hint !== null && (
        <div className="mt-2 text-xs text-muted-foreground">{hint}</div>
      )}
      {error !== null && error !== "" && (
        <p id={alertId} role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {footer !== undefined && footer !== null && <div className="mt-4 text-left">{footer}</div>}

      {/* UKRYTE POLE PLIKU STOI NA KOŃCU OBSZARU. Kolejność nie jest
            kosmetyczna: pola formularzy bywają wyszukiwane „pierwszy `input`
            w kontenerze etykiety", a picker wpięty na początku przechwytywałby
            takie zapytania zamiast widocznej kontrolki (adres URL). */}
      <input
        ref={inputRef}
        id={inputId}
        name={name}
        type="file"
        data-testid={inputTestId}
        className="sr-only"
        tabIndex={-1}
        aria-label={inputLabel ?? ctaLabel}
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          emit(event.target.files, false);
          // Bez resetu wybranie TEGO SAMEGO pliku po nieudanej wysyłce nie
          // wyemitowałoby `change` i obszar wyglądałby na zepsuty.
          event.target.value = "";
        }}
      />
    </div>
  );
}
