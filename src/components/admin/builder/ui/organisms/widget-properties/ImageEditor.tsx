// Organism: image widget editor (light/dark variants + preview + alt + link).
//
// Prezentacja obrazka (podpis, wariant, dopasowanie, proporcje) NIE jest tu
// przepisywana ręcznie: pola mieszkają w `WIDGET_SCHEMAS.image` (jedyne źródło
// prawdy dla etykiet, opcji i tłumaczeń EN) i są rysowane tą samą molekułą
// `SchemaFieldControl`, co reszta panelu. Wcześniej ten edytor przesłaniał cały
// blok schematu, więc cztery ustawienia obsługiwane przez renderer
// (mediaWidgets.tsx) były w panelu nieosiągalne.
//
// NATURALNY ROZMIAR PLIKU (`srcIntrinsic` / `srcDarkIntrinsic`, napis "WxH") to
// wartość MIERZONA, nie wpisywana: renderer dokłada z niej obrazowi bez ramki
// atrybuty `width`/`height` (Lighthouse `unsized-images`). Dlatego nie jest
// polem schematu ani wpisem `IMAGE_EDITOR_HANDLED_KEYS` - edytor pokazuje ją
// tylko jako podpowiedź pod slotem.
//
// POMIAR I ZAPIS NIE MIESZKAJĄ W EDYTORZE. Robi to hak
// `useImageIntrinsicCapture` (reguły, kiedy mierzy i kiedy zapisuje, są w jego
// nagłówku), a trzyma go panel właściwości NAD zakładkami: edytor siedzi w
// zakładce "Treść", która po PRZEJŚCIU NA INNĄ ZAKŁADKĘ jest odmontowywana, więc
// pomiar trzymany tutaj gubił wynik, gdy redaktor otworzył "Styl" albo
// "Zaawansowane", i nie ruszał po zaznaczeniu obrazu, dopóki "Treść" nie była
// widoczna. Edytor dostaje od panelu dwa zapisy idące przez pomiar (`capture`:
// zmiana pliku slotu i ustawienie, od którego zależy użycie rozmiaru) i tylko
// je wywołuje. Renderowany bez panelu (testy edytora, bramka wierności
// ustawień) uruchamia ten sam hak sam.
//
// ZNANE OGRANICZENIE (szczegóły w nagłówku haka): wynik pomiaru przepada, gdy
// redaktor ODZNACZY widget albo zaznaczy inny, zanim pomiar wróci - treść
// zostaje wtedy z nowym adresem i pustym rozmiarem (znacznik bez atrybutów, jak
// przed tą funkcją), stan naprawia kolejne zaznaczenie, a do tego czasu
// podpowiedź pod slotem mówi, że wymiary nie są zapisane. Samo przełączenie
// zakładki panelu wyniku nie gubi.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sun, Moon, Image as ImageIcon } from "lucide-react";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { WIDGET_SCHEMAS, type SchemaField } from "@/lib/builder/schemas";
import { useBuilderLabel } from "@/lib/builder/labelsEn";
import {
  intrinsicSlotUse,
  type ImageFileSlot,
  type SiteLogoSettings,
} from "@/lib/admin/imageIntrinsicUse";
import { resolveSetting, siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { PropField } from "../../atoms";
import { SchemaFieldControl } from "../../molecules/SchemaFieldControl";
import { ImageSlot } from "./ImageSlot";
import { useImageIntrinsicCapture, type ImageIntrinsicCapture } from "./useImageIntrinsicCapture";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
  /**
   * Zapisy idące przez pomiar rozmiaru, trzymane przez panel właściwości (żyją
   * także wtedy, gdy zakładka z edytorem jest zamknięta). Bez nich edytor
   * prowadzi pomiar sam i wtedy liczą się `widgetId` oraz `isGlobal`.
   */
  capture?: ImageIntrinsicCapture;
  /** Jak `widgetId` haka `useImageIntrinsicCapture` - tylko dla edytora bez `capture`. */
  widgetId?: string;
  /** Jak `isGlobal` haka `useImageIntrinsicCapture` - tylko dla edytora bez `capture`. */
  isGlobal?: boolean;
}

/** `"1200x675"` -> `"1200 × 675 px"` (podpowiedź pod slotem, bez tłumaczenia). */
const sizeHint = (size: string) => `${size.replace("x", " × ")} px`;

/** Pola schematu obrazka rysowane przez ten edytor (kolejność = kolejność w UI). */
const PRESENTATION_KEYS = ["caption", "variant", "objectFit", "ratio"] as const;

const PRESENTATION_FIELDS: ReadonlyArray<SchemaField> = PRESENTATION_KEYS.map((key) =>
  (WIDGET_SCHEMAS.image ?? []).find((f) => f.key === key),
).filter((f): f is SchemaField => f !== undefined);

/**
 * Klucze treści, które ImageEditor obsługuje SAM. Panel (`WidgetProperties`)
 * używa tego zbioru, żeby dorenderować pola schematu spoza listy zamiast je
 * po cichu zjeść - patrz `CUSTOM_EDITOR_HANDLED_KEYS`.
 */
export const IMAGE_EDITOR_HANDLED_KEYS: ReadonlySet<string> = new Set<string>([
  "src",
  "srcDark",
  "alt",
  "widthPx",
  "maxWidthPx",
  "heightPx",
  "align",
  "href",
  "useSiteLogo",
  ...PRESENTATION_KEYS,
]);

/**
 * Wybór logo witryny stoi PRZED slotami plików, bo je unieważnia: gdy jest
 * ustawiony, renderer bierze grafikę z Opcji motywu i ignoruje własne URL-e.
 * Wcześniej ten klucz istniał tylko w rendererze - jedyną drogą do podstawienia
 * logo był przypadek (alt zawierający słowo "logo").
 */
const SITE_LOGO_FIELD: SchemaField | undefined = (WIDGET_SCHEMAS.image ?? []).find(
  (f) => f.key === "useSiteLogo",
);

export function ImageEditor({ c, lang, setContent, capture, widgetId, isGlobal }: Props) {
  const { t } = useTranslation();
  const bl = useBuilderLabel();
  const src = typeof c.src === "string" ? c.src : "";
  const srcDark = typeof c.srcDark === "string" ? c.srcDark : "";
  const srcIntrinsic = typeof c.srcIntrinsic === "string" ? c.srcIntrinsic : "";
  const srcDarkIntrinsic = typeof c.srcDarkIntrinsic === "string" ? c.srcDarkIntrinsic : "";
  const altPl = typeof c.alt_pl === "string" ? c.alt_pl : "";
  const altEn = typeof c.alt_en === "string" ? c.alt_en : "";
  const href = typeof c.href === "string" ? c.href : "";
  const widthPx = typeof c.widthPx === "number" ? c.widthPx : Number(c.widthPx) || 0;
  const maxWidthPx = typeof c.maxWidthPx === "number" ? c.maxWidthPx : Number(c.maxWidthPx) || 0;
  const heightPx = typeof c.heightPx === "number" ? c.heightPx : Number(c.heightPx) || 0;
  const align = (typeof c.align === "string" ? c.align : "center") as "left" | "center" | "right";
  const [previewMode, setPreviewMode] = useState<"light" | "dark">("light");

  // Logo motywu z TEGO SAMEGO cache'u ustawień, z którego rysuje podgląd na
  // kanwie (bez własnego pobrania): od niego zależy, czy renderer narysuje
  // własny plik widgetu, czyli czy podpowiedź o braku wymiarów ma sens.
  const { data: siteSettings } = useQuery({ ...siteSettingsQueryOptions, enabled: false });
  const siteLogo = resolveSetting<{ logo?: SiteLogoSettings }>(
    siteSettings,
    "theme_options",
    {},
  ).logo;

  // Pomiar trzyma panel (`capture`); edytor bez panelu uruchamia hak sam.
  const ownCapture = useImageIntrinsicCapture({
    enabled: !capture,
    c,
    setContent,
    widgetId,
    isGlobal,
  });
  const { changeSlot, setRenderOption } = capture ?? ownCapture;

  const darkHint = t("builder.imageEditor.slotDarkHint");
  // Podpowiedź pod slotem: zapisany rozmiar albo - gdy renderer by go użył, a w
  // treści go nie ma - informacja, że wymiary nie są zapisane: pomiar trwa, nie
  // udał się, plik nie ma własnej proporcji (SVG) albo wynik przepadł (patrz
  // "ZNANE OGRANICZENIE" w nagłówku). Slot, którego rozmiaru renderer nie użyje,
  // zostaje bez tej informacji - tam brak wymiarów niczego nie zmienia.
  const usedNow = intrinsicSlotUse((key) => c[key], siteLogo);
  const sizeNote = (slot: ImageFileSlot, stored: string): string =>
    stored ? sizeHint(stored) : usedNow[slot] ? t("builder.imageEditor.sizeNotStored") : "";
  const lightSizeNote = sizeNote("src", srcIntrinsic);
  const darkSizeNote = sizeNote("srcDark", srcDarkIntrinsic);

  return (
    <div className="space-y-4">
      {/* Preview on prepared backgrounds */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("builder.imageEditor.preview")}
          </span>
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setPreviewMode("light")}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] ${previewMode === "light" ? "bg-brand text-brand-foreground" : "bg-background hover:bg-muted"}`}
            >
              <Sun className="w-3 h-3" /> Light
            </button>
            <button
              type="button"
              onClick={() => setPreviewMode("dark")}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] ${previewMode === "dark" ? "bg-brand text-brand-foreground" : "bg-background hover:bg-muted"}`}
            >
              <Moon className="w-3 h-3" /> Dark
            </button>
          </div>
        </div>
        <div
          className="rounded-md border border-border flex items-center justify-center p-4 min-h-[120px]"
          style={{ background: previewMode === "dark" ? "#0b0b0e" : "#ffffff" }}
        >
          {(() => {
            const shown = previewMode === "dark" ? srcDark || src : src || srcDark;
            if (!shown) {
              return (
                <div className="flex flex-col items-center gap-1 text-[11px] text-muted-foreground">
                  <ImageIcon className="w-5 h-5 opacity-50" />
                  {t("builder.imageEditor.noImage")}
                </div>
              );
            }
            return <img src={shown} alt="" className="max-h-32 max-w-full object-contain" />;
          })()}
        </div>
      </div>

      {SITE_LOGO_FIELD ? (
        <SchemaFieldControl
          field={SITE_LOGO_FIELD}
          lang={lang}
          content={c}
          setContent={setRenderOption}
        />
      ) : null}

      <ImageSlot
        label={t("builder.imageEditor.slotLight")}
        icon={<Sun className="w-3.5 h-3.5" />}
        value={src}
        onChange={(v) => changeSlot("src", v)}
        hint={lightSizeNote || undefined}
      />

      <ImageSlot
        label={t("builder.imageEditor.slotDark")}
        icon={<Moon className="w-3.5 h-3.5" />}
        value={srcDark}
        onChange={(v) => changeSlot("srcDark", v)}
        hint={darkSizeNote ? `${darkHint} · ${darkSizeNote}` : darkHint}
      />

      <div className="pt-2 border-t border-border space-y-2">
        <PropField label={t("builder.imageEditor.width")} hint={t("builder.imageEditor.widthHint")}>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                step={1}
                value={widthPx || ""}
                placeholder="auto"
                onChange={(e) =>
                  setContent(
                    "widthPx",
                    e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)),
                  )
                }
                className="h-8 text-xs w-24"
              />
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {widthPx > 0 ? `${widthPx}px` : "auto"}
              </span>
            </div>
            <Slider
              min={0}
              max={1200}
              step={10}
              value={[widthPx || 0]}
              onValueChange={(v) => setContent("widthPx", v[0] ?? 0)}
              className="w-full"
            />
            <div className="flex justify-between text-[9px] text-muted-foreground">
              <span>0 (auto)</span>
              <span>1200px</span>
            </div>
          </div>
        </PropField>
        <PropField
          label={t("builder.imageEditor.maxWidth")}
          hint={t("builder.imageEditor.maxWidthHint")}
        >
          <Input
            type="number"
            min={0}
            step={1}
            value={maxWidthPx || ""}
            placeholder={t("builder.imageEditor.maxWidthPh")}
            onChange={(e) =>
              setContent(
                "maxWidthPx",
                e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)),
              )
            }
            className="h-8 text-xs"
          />
        </PropField>
        <PropField
          label={t("builder.imageEditor.height")}
          hint={t("builder.imageEditor.heightHint")}
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                step={1}
                value={heightPx || ""}
                placeholder="auto"
                onChange={(e) =>
                  setContent(
                    "heightPx",
                    e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)),
                  )
                }
                className="h-8 text-xs w-24"
              />
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {heightPx > 0 ? `${heightPx}px` : "auto"}
              </span>
            </div>
            <Slider
              min={0}
              max={400}
              step={2}
              value={[heightPx || 0]}
              onValueChange={(v) => setContent("heightPx", v[0] ?? 0)}
              className="w-full"
            />
            <div className="flex justify-between text-[9px] text-muted-foreground">
              <span>0 (auto)</span>
              <span>400px</span>
            </div>
          </div>
        </PropField>
        <PropField label={t("builder.imageEditor.align")}>
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            {(["left", "center", "right"] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setContent("align", a)}
                className={`px-2 py-1 text-[11px] ${align === a ? "bg-brand text-brand-foreground" : "bg-background hover:bg-muted"}`}
              >
                {a === "left"
                  ? t("builder.common.left")
                  : a === "center"
                    ? t("builder.common.center")
                    : t("builder.common.right")}
              </button>
            ))}
          </div>
        </PropField>
      </div>

      <div className="pt-2 border-t border-border space-y-2">
        <PropField label="Alt (PL)">
          <Input
            value={altPl}
            onChange={(e) => setContent("alt_pl", e.target.value)}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label="Alt (EN)">
          <Input
            value={altEn}
            onChange={(e) => setContent("alt_en", e.target.value)}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label={t("builder.imageEditor.link")}>
          <Input
            value={href}
            placeholder="https://..."
            onChange={(e) => setContent("href", e.target.value)}
            className="h-8 text-xs"
          />
        </PropField>
      </div>

      <section className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-2">
        <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {bl("Wygląd")}
        </h4>
        {PRESENTATION_FIELDS.map((field) => (
          <SchemaFieldControl
            key={field.key}
            field={field}
            lang={lang}
            content={c}
            setContent={setRenderOption}
          />
        ))}
      </section>
      <div className="text-[10px] text-muted-foreground">
        {t("builder.imageEditor.activeLang", { lang: lang.toUpperCase() })}
      </div>
    </div>
  );
}
