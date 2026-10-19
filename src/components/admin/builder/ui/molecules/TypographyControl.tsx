// Molecule: full typography editor block (font family, unified size,
// weight, style, line-height, letter-spacing, transform, decoration).
// Font size is a single value applied identically on desktop / tablet / mobile.
import { useRef, useState } from "react";
import type { Device, WidgetTypography } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { PropField } from "../atoms/PropField";
import { FontPicker } from "@/components/admin/settings/FontPicker";
import { normalizeTypographyGapPx } from "@/lib/builder/liveTypography";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";

interface Props {
  value: WidgetTypography | undefined;
  device: Device;
  onChange: (next: WidgetTypography) => void;
}

/**
 * Długość CSS zapisana napisem (`letterSpacing`, `lineHeight`): liczba - także
 * ułamkowa i ujemna - z opcjonalną jednostką. Renderer (`typographyCss.ts`)
 * wstawia napis do CSS dosłownie, więc panel musi czytać liczbę w całości:
 * odsiewanie samych cyfr robiło z „0.5px" wartość „05", a z interlinii „1.5"
 * (mnożnik) - „15 px".
 */
const CSS_LENGTH = /^\s*(-?(?:\d+\.?\d*|\.\d+))\s*([a-z%]*)\s*$/i;

interface CssLengthField {
  /** Tekst pola: sama liczba albo - dla zapisu, który nie jest liczbą
   * z jednostką (`normal`, `var(...)`) - napis dosłowny, który rysuje strona. */
  text: string;
  /** Jednostka podpisana przy polu (pusta = brak jednostki do pokazania). */
  unit: string;
  /** Jednostka dopisywana przy edycji - ta sama, którą renderer już dostaje. */
  writeUnit: string;
}

/**
 * @param unitless jednostka liczby zapisanej BEZ jednostki: interlinia „1.5"
 *   to mnożnik (zostaje bez jednostki), światło „0" to długość w px.
 */
function readCssLength(value: unknown, unitless: string): CssLengthField {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return { text: "", unit: "px", writeUnit: "px" };
  const m = CSS_LENGTH.exec(raw);
  if (!m) return { text: raw, unit: "", writeUnit: "px" };
  const unit = m[2].toLowerCase() || unitless;
  return { text: m[1], unit, writeUnit: unit };
}

/**
 * Wpis pola długości: cyfry z JEDNYM separatorem dziesiętnym (przecinek = kropka)
 * i - gdy pole na to pozwala - minusem na początku. Stany pośrednie („-", „1.")
 * zostają, żeby dało się dopisać kolejne znaki - żyją jednak tylko w szkicu
 * pola (`completeDecimal` decyduje, co trafia do dokumentu).
 */
function sanitizeDecimal(raw: string, allowNegative: boolean): string {
  const negative = allowNegative && raw.trim().startsWith("-");
  const [whole = "", ...fraction] = raw
    .replace(",", ".")
    .replace(/[^0-9.]/g, "")
    .split(".");
  const body = fraction.length > 0 ? `${whole}.${fraction.join("")}` : whole;
  return negative ? `-${body}` : body;
}

/**
 * Liczba gotowa do zapisu albo `undefined` dla stanu pośredniego. „-", „." i
 * „-." nie mają cyfry, a „1." kończy się separatorem - jako „-px", „1.px" czy
 * interlinię „2." przeglądarka odrzuca deklarację i strona rysuje wartość
 * domyślną, choć panel pokazuje wpis.
 */
const completeDecimal = (text: string): string | undefined =>
  /\d/.test(text) ? text.replace(/\.$/, "") : undefined;

/** Krok strzałki od bieżącej liczby (także ułamkowej), bez ogona binarnego. */
const stepFrom = (current: string, delta: number): number =>
  Math.round(((Number.parseFloat(current) || 0) + delta) * 1000) / 1000;

/** Pola ułamkowe, których wpis przechodzi przez szkic. */
type DecimalKey =
  | "lineHeight"
  | "letterSpacing"
  | "titleDescriptionGapPx"
  | "fontSize"
  | "fontSizeMobile"
  | "descriptionFontSize"
  | "descriptionFontSizeMobile";

/** Szkic pola ułamkowego: dosłowny wpis i jednostka z początku edycji. */
interface DecimalDraft {
  text: string;
  unit: string;
}

/** Wiązanie pola ułamkowego z `renderSizeInput`. */
interface DecimalBinding {
  text: string;
  unit: string;
  onType: (raw: string) => void;
  onStep: (next: string) => void;
  onBlur: () => void;
}

export function TypographyControl({ value, onChange }: Props) {
  const { t } = useTranslation();
  const v = value ?? {};
  const set = (patch: Partial<WidgetTypography>) => {
    const next = { ...v, ...patch } as WidgetTypography;
    for (const key of Object.keys(next) as Array<keyof WidgetTypography>) {
      if (next[key] === undefined || next[key] === "") delete next[key];
    }
    onChange(next);
  };

  // Szkic pól ułamkowych (wzorzec `ClampedNumberInput`): pole pokazuje dosłowny
  // wpis, dokument dostaje tylko liczbę kompletną, a opuszczenie pola zdejmuje
  // szkic - pole pokazuje znowu to, co rysuje strona.
  const [drafts, setDrafts] = useState<Partial<Record<DecimalKey, DecimalDraft>>>({});
  const dropDraft = (key: DecimalKey) =>
    setDrafts((d) => (d[key] ? { ...d, [key]: undefined } : d));

  const bindDecimal = (
    key: DecimalKey,
    stored: CssLengthField,
    allowNegative: boolean,
    write: (num: string | undefined, unit: string) => void,
  ): DecimalBinding => {
    const draft = drafts[key];
    // Jednostka trzyma się całej edycji: wyczyszczenie interlinii „1.5" i wpis
    // „1.6" zostaje mnożnikiem, a nie interlinią 1.6 px (pusty zapis to px).
    const unit = draft?.unit ?? stored.writeUnit;
    const commit = (text: string) => {
      if (text === "") {
        write(undefined, unit);
        return;
      }
      const num = completeDecimal(text);
      if (num !== undefined) write(num, unit);
    };
    return {
      text: draft?.text ?? stored.text,
      unit: draft?.unit ?? stored.unit,
      onType: (raw) => {
        const text = sanitizeDecimal(raw, allowNegative);
        setDrafts((d) => ({ ...d, [key]: { text, unit } }));
        commit(text);
      },
      // Krok strzałki to liczba kompletna - zapis wprost i bez szkicu: przycisk
      // krokowy nie zawsze dostaje fokus, więc blur pola mógłby go nie zdjąć.
      onStep: (next) => {
        dropDraft(key);
        commit(next);
      },
      onBlur: () => dropDraft(key),
    };
  };

  // Rozmiary są rozdzielone na desktop (desktop + tablet) i mobile, żeby
  // redakcja mogła ustawić np. 34px na desktopie i 26px na telefonie.
  // Odczyt jak w CSS - liczba z jednostką - a nie same cyfry: „16.5px” było
  // polem „165” (strzałka zapisywała 166px), a „1.5rem” - polem „15 px”.
  // Edycja zachowuje jednostkę zapisu (nowa wartość - w px).
  type ResponsiveSizeKey = "fontSize" | "descriptionFontSize";
  // Edycja rozmiaru desktopu: czy telefon idzie za desktopem i co ta edycja
  // ostatnio zapisała. Decyzja zapada RAZ, przy pierwszym zapisie edycji -
  // liczona przy każdym zapisie od nowa myliła stan pośredni ze świadomym
  // wyborem: Backspace do pustego pola przypinał telefonowi pierwszą cyfrę
  // starej wartości („24” -> „2” -> „” -> „32” dawało telefonowi 2px), a krok
  // strzałki przez rozmiar telefonu (14 -> 15 -> 16 przy telefonie 16)
  // „przyklejał” telefon do desktopu. Edycja trwa do wyjścia z pola i dopóki
  // dokument trzyma to, co sama zapisała - inna zmiana (pole telefonu, cofnij)
  // kończy ją, a przyciski krokowe nie zawsze dostają fokus, więc samo wyjście
  // z pola nie wystarcza. Ref, a nie stan: decyzja niczego nie rysuje.
  const sizeEdits = useRef<
    Partial<Record<ResponsiveSizeKey, { follows: boolean; desktop?: string; mobile?: string }>>
  >({});
  const bindSize = (key: ResponsiveSizeKey, device: "desktop" | "mobile") => {
    const cur = v[key];
    const desktop = cur?.desktop ?? cur?.tablet;
    const stored = device === "desktop" ? desktop : cur?.mobile;
    const draftKey: DecimalKey = device === "desktop" ? key : `${key}Mobile`;
    const binding = bindDecimal(draftKey, readCssLength(stored, "px"), false, (num, unit) => {
      const size = num === undefined ? undefined : `${num}${unit}`;
      if (device === "desktop") {
        const edit = sizeEdits.current[key];
        const ongoing = edit && edit.desktop === desktop && edit.mobile === cur?.mobile;
        // Telefon idzie za desktopem, gdy na początku edycji nie miał własnego
        // rozmiaru (pusty albo równy desktopowi). Własny rozmiar telefonu
        // zostaje nietknięty przez całą edycję.
        const follows = ongoing
          ? edit.follows
          : cur?.mobile === undefined || cur.mobile === desktop;
        const mobile = follows ? size : cur?.mobile;
        // Wyczyszczenie desktopu, za którym telefon szedł, czyści też telefon -
        // inaczej pusty stan pośredni zostawiał telefonowi starą wartość.
        const next: WidgetTypography[ResponsiveSizeKey] =
          size !== undefined
            ? { desktop: size, tablet: size, ...(mobile ? { mobile } : {}) }
            : mobile
              ? { mobile }
              : undefined;
        sizeEdits.current[key] = { follows, desktop: next?.desktop, mobile: next?.mobile };
        set({ [key]: next });
        return;
      }
      const base = desktop ? { desktop, tablet: cur?.tablet ?? desktop } : undefined;
      if (size === undefined) {
        set({ [key]: base });
        return;
      }
      set({ [key]: { ...(base ?? {}), mobile: size } });
    });
    if (device === "mobile") return binding;
    return {
      ...binding,
      onBlur: () => {
        binding.onBlur();
        delete sizeEdits.current[key];
      },
    };
  };
  const titleSize = bindSize("fontSize", "desktop");
  const titleSizeMobile = bindSize("fontSize", "mobile");
  const descSize = bindSize("descriptionFontSize", "desktop");
  const descSizeMobile = bindSize("descriptionFontSize", "mobile");

  const renderSizeInput = (
    current: string,
    setter: (raw: string) => void,
    ariaLabel: string,
    placeholder = "16",
    unitLabel = "px",
    step = 1,
    decimal?: Pick<DecimalBinding, "onStep" | "onBlur">,
  ) => {
    const stepTo = decimal?.onStep ?? setter;
    return (
      <div className="relative">
        <Input
          value={current}
          inputMode={decimal ? "decimal" : "numeric"}
          placeholder={placeholder}
          aria-label={ariaLabel}
          onChange={(e) => setter(e.target.value)}
          onBlur={decimal?.onBlur}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              stepTo(String(stepFrom(current, step)));
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              const next = stepFrom(current, -step);
              stepTo(next >= 0 ? String(next) : "");
            }
          }}
          className="h-8 text-xs pr-12"
        />
        <span className="pointer-events-none absolute right-7 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
          {unitLabel}
        </span>
        <div className="absolute right-0 top-0 h-8 w-6 flex flex-col border-l border-border">
          <button
            type="button"
            tabIndex={-1}
            aria-label={t("builder.stepper.increase")}
            onClick={() => stepTo(String(stepFrom(current, step)))}
            className="flex-1 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition"
          >
            <ChevronUp className="w-3 h-3" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label={t("builder.stepper.decrease")}
            onClick={() => {
              const next = stepFrom(current, -step);
              stepTo(next >= 0 ? String(next) : "");
            }}
            className="flex-1 flex items-center justify-center border-t border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition"
          >
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>
      </div>
    );
  };

  // Interlinia i światło: pole pokazuje liczbę i jednostkę, które dostaje CSS,
  // a edycja zapisuje napis z TĄ SAMĄ jednostką (nowa wartość - w px).
  const lineHeight = bindDecimal(
    "lineHeight",
    readCssLength(v.lineHeight, ""),
    false,
    (num, unit) => set({ lineHeight: num === undefined ? undefined : `${num}${unit}` }),
  );
  // Zwężenie liter (wartość ujemna) jest w typografii nagłówków normą.
  const letterSpacing = bindDecimal(
    "letterSpacing",
    readCssLength(v.letterSpacing, "px"),
    true,
    (num, unit) => set({ letterSpacing: num === undefined ? undefined : `${num}${unit}` }),
  );

  // Odstęp tytuł-opis: odczyt TĄ SAMĄ funkcją co renderer - liczba albo
  // starszy napis „12px", domknięte do 0-200. Zapis zawsze liczbą, a puste
  // pole to „brak odstępu", jak w rendererze.
  const gapPx = normalizeTypographyGapPx(v.titleDescriptionGapPx);
  const gap = bindDecimal(
    "titleDescriptionGapPx",
    { text: gapPx === undefined ? "" : String(gapPx), unit: "px", writeUnit: "px" },
    false,
    (num) =>
      set({ titleDescriptionGapPx: num === undefined ? undefined : normalizeTypographyGapPx(num) }),
  );

  return (
    <div className="space-y-2">
      <PropField label={t("builder.typographyControl.fontFamily")}>
        <FontPicker value={v.fontFamily} onChange={(stack) => set({ fontFamily: stack })} />
      </PropField>

      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {t("builder.typographyControl.desktopGroup")}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <PropField label={t("builder.typographyControl.titleSize")}>
          {renderSizeInput(
            titleSize.text,
            titleSize.onType,
            t("builder.typographyControl.titleSizeAria"),
            "16",
            titleSize.unit,
            1,
            titleSize,
          )}
        </PropField>
        <PropField label={t("builder.typographyControl.descSize")}>
          {renderSizeInput(
            descSize.text,
            descSize.onType,
            t("builder.typographyControl.descSizeAria"),
            "16",
            descSize.unit,
            1,
            descSize,
          )}
        </PropField>
      </div>

      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {t("builder.typographyControl.mobileGroup")}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <PropField label={t("builder.typographyControl.titleSizeMobile")}>
          {renderSizeInput(
            titleSizeMobile.text,
            titleSizeMobile.onType,
            t("builder.typographyControl.titleSizeMobileAria"),
            "26",
            titleSizeMobile.unit,
            1,
            titleSizeMobile,
          )}
        </PropField>
        <PropField label={t("builder.typographyControl.descSizeMobile")}>
          {renderSizeInput(
            descSizeMobile.text,
            descSizeMobile.onType,
            t("builder.typographyControl.descSizeMobileAria"),
            "14",
            descSizeMobile.unit,
            1,
            descSizeMobile,
          )}
        </PropField>
      </div>

      <PropField label={t("builder.typographyControl.gap")}>
        {renderSizeInput(
          gap.text,
          gap.onType,
          t("builder.typographyControl.gapAria"),
          "16",
          gap.unit,
          4,
          gap,
        )}
      </PropField>

      <PropField label={t("builder.spacing.align")}>
        <div className="inline-flex rounded border border-border bg-muted/30 p-0.5 w-full">
          {(
            [
              { v: "left", Icon: AlignLeft, label: t("builder.common.left") },
              { v: "center", Icon: AlignCenter, label: t("builder.common.center") },
              { v: "right", Icon: AlignRight, label: t("builder.common.right") },
              { v: "justify", Icon: AlignJustify, label: t("builder.typographyControl.justify") },
            ] as const
          ).map(({ v: val, Icon, label }) => {
            const active = v.textAlign === val;
            return (
              <button
                key={val}
                type="button"
                title={label}
                onClick={() => set({ textAlign: active ? undefined : val })}
                className={`flex-1 inline-flex items-center justify-center h-7 text-[11px] rounded transition ${
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            );
          })}
        </div>
      </PropField>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={t("builder.typographyControl.weight")}>
          <Select
            value={v.fontWeight ?? "__unset"}
            onValueChange={(w) => set({ fontWeight: w === "__unset" ? undefined : w })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="-" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__unset">-</SelectItem>
              {["300", "400", "500", "600", "700", "800", "900"].map((w) => (
                <SelectItem key={w} value={w}>
                  {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropField>
        <PropField label={t("builder.shape.style")}>
          <Select
            value={v.fontStyle ?? "normal"}
            onValueChange={(s) => set({ fontStyle: s as "normal" | "italic" })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">{t("builder.typographyControl.styleNormal")}</SelectItem>
              <SelectItem value="italic">{t("builder.typographyControl.styleItalic")}</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={t("builder.typographyControl.lineHeight")}>
          {renderSizeInput(
            lineHeight.text,
            lineHeight.onType,
            t("builder.typographyControl.lineHeightAria"),
            "24",
            lineHeight.unit,
            1,
            lineHeight,
          )}
        </PropField>
        <PropField label={t("builder.typographyControl.letterSpacing")}>
          {renderSizeInput(
            letterSpacing.text,
            letterSpacing.onType,
            t("builder.typographyControl.letterSpacingAria"),
            "0",
            letterSpacing.unit,
            1,
            letterSpacing,
          )}
        </PropField>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={t("builder.typographyControl.textTransform")}>
          <Select
            value={v.textTransform ?? "none"}
            onValueChange={(t) =>
              set({
                textTransform: t as "none" | "uppercase" | "lowercase" | "capitalize",
              })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("builder.typographyControl.ttNone")}</SelectItem>
              <SelectItem value="uppercase">{t("builder.typographyControl.ttUpper")}</SelectItem>
              <SelectItem value="lowercase">{t("builder.typographyControl.ttLower")}</SelectItem>
              <SelectItem value="capitalize">
                {t("builder.typographyControl.ttCapitalize")}
              </SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <PropField label={t("builder.typographyControl.decoration")}>
          <Select
            value={v.textDecoration ?? "none"}
            onValueChange={(t) =>
              set({
                textDecoration: t as "none" | "underline" | "line-through",
              })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("builder.common.none")}</SelectItem>
              <SelectItem value="underline">
                {t("builder.typographyControl.decUnderline")}
              </SelectItem>
              <SelectItem value="line-through">
                {t("builder.typographyControl.decLineThrough")}
              </SelectItem>
            </SelectContent>
          </Select>
        </PropField>
      </div>
    </div>
  );
}
