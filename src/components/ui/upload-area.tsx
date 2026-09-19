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
//      stronie wywołującego, bo limity są różne (10 MB obraz, 300 MB audio).
//
// CZEGO TEN KOMPONENT NIE ROBI: nie wysyła bajtów i nie zna Supabase. Ścieżka
// uploadu mediów ma własny, opisany kontrakt (`src/lib/media/upload.ts`) i to
// on zostaje autorytetem - tutaj jest wyłącznie powłoka interakcji.
import * as React from "react";
import { Loader2, UploadCloud } from "lucide-react";

import { Button } from "@/components/ui/button";
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
   * Ikony klastra. Trzy układają się w wachlarz (jak w standardzie), jedna
   * stoi prosto. Domyślnie chmurka uploadu - obszar bez ikon nie istnieje.
   */
  icons?: readonly UploadAreaIcon[];
  /** Odebrane pliki: z pickera albo z upuszczenia. Nigdy nie jest pustą listą. */
  onFiles: (files: File[]) => void;
  /** Wartość atrybutu `accept` dla `<input type="file">` (jawna lista MIME). */
  accept?: string;
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

/** Czy kliknięcie padło w element, który sam coś robi (CTA, link, pole). */
function hitsInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest("button, a, input, select, textarea, label, [role='button']") !== null;
}

export function UploadArea({
  title,
  description,
  ctaLabel,
  icons = [UploadCloud],
  onFiles,
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

  const emit = (files: FileList | null): void => {
    if (files === null || files.length === 0) return;
    onFiles(Array.from(files));
  };

  const resetDrag = (): void => {
    dragDepth.current = 0;
    setDragOver(false);
  };

  const compact = size === "sm";

  return (
    <div className={cn("w-full", compact ? "max-w-none" : "max-w-[620px]")}>
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
          compact ? "p-6" : "p-14",
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
          emit(event.dataTransfer.files);
        }}
      >
        <div className="flex justify-center isolate">
          {preview !== undefined && preview !== null ? (
            preview
          ) : icons.length === 3 ? (
            <>
              <div
                className={cn(
                  "bg-background grid place-items-center rounded-xl relative left-2.5 top-1.5 -rotate-6 shadow-lg ring-1 ring-border transition duration-500",
                  compact ? "size-10" : "size-12",
                  !locked &&
                    "group-hover:-translate-x-5 group-hover:-rotate-12 group-hover:-translate-y-0.5 group-hover:duration-200",
                )}
              >
                {React.createElement(icons[0], {
                  className: cn(compact ? "w-5 h-5" : "w-6 h-6", "text-muted-foreground"),
                  "aria-hidden": "true",
                })}
              </div>
              <div
                className={cn(
                  "bg-background grid place-items-center rounded-xl relative z-10 shadow-lg ring-1 ring-border transition duration-500",
                  compact ? "size-10" : "size-12",
                  !locked && "group-hover:-translate-y-0.5 group-hover:duration-200",
                )}
              >
                {React.createElement(icons[1], {
                  className: cn(compact ? "w-5 h-5" : "w-6 h-6", "text-muted-foreground"),
                  "aria-hidden": "true",
                })}
              </div>
              <div
                className={cn(
                  "bg-background grid place-items-center rounded-xl relative right-2.5 top-1.5 rotate-6 shadow-lg ring-1 ring-border transition duration-500",
                  compact ? "size-10" : "size-12",
                  !locked &&
                    "group-hover:translate-x-5 group-hover:rotate-12 group-hover:-translate-y-0.5 group-hover:duration-200",
                )}
              >
                {React.createElement(icons[2], {
                  className: cn(compact ? "w-5 h-5" : "w-6 h-6", "text-muted-foreground"),
                  "aria-hidden": "true",
                })}
              </div>
            </>
          ) : (
            <div
              className={cn(
                "bg-background grid place-items-center rounded-xl shadow-lg ring-1 ring-border transition duration-500",
                compact ? "size-10" : "size-12",
                !locked && "group-hover:-translate-y-0.5 group-hover:duration-200",
              )}
            >
              {icons[0] !== undefined &&
                React.createElement(icons[0], {
                  className: cn(compact ? "w-5 h-5" : "w-6 h-6", "text-muted-foreground"),
                  "aria-hidden": "true",
                })}
            </div>
          )}
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
            emit(event.target.files);
            // Bez resetu wybranie TEGO SAMEGO pliku po nieudanej wysyłce nie
            // wyemitowałoby `change` i obszar wyglądałby na zepsuty.
            event.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
