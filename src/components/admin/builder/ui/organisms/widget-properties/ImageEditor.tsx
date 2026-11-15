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
// jako podpowiedź pod slotem i zapisuje sam:
//   - przy ZMIANIE pliku: stary rozmiar jest zerowany w tym samym kroku cofania
//     co nowy adres, a nowy plik mierzony;
//   - raz po ZAZNACZENIU widgetu (istniejąca treść sprzed tej funkcji), o ile
//     to nie instancja widgetu globalnego i TYLKO dla slotu, którego rozmiaru
//     publiczny renderer użyje (`intrinsicSlotUse`): obraz w ramce i widget,
//     którego własny plik zastępuje logo motywu, nie są ani mierzone, ani
//     zapisywane. Samo kliknięcie nie może dokładać kroku "cofnij" bez
//     widocznego skutku ani uruchamiać autozapisu dla wartości, którą render
//     odrzuca;
//   - gdy redaktor PRZEŁĄCZY ustawienie tak, że renderer zacznie rozmiaru
//     używać ("Proporcje" na auto, wyłączone "Użyj logo witryny") - efekt po
//     zaznaczeniu nie uruchomi się drugi raz dla tego samego widgetu. Zmianę
//     samego altu (słowo "logo") dogania dopiero kolejne zaznaczenie.
// Pomiar NIGDY nie jest efektem zależnym od adresu ani od zapisanej wartości:
// cofnięcie przywraca starszy adres albo pusty rozmiar, efekt zapisałby wtedy
// ponownie, a każdy zapis czyści stos "ponów".
//
// PLIK BEZ WŁASNEJ PROPORCJI (werdykt `noRatio` pomiaru, np. SVG bez `viewBox`)
// ZERUJE rozmiar zapisany dla slotu: to rozmiar zastępczy przeglądarki albo
// rozmiar pliku, który stał pod tym adresem wcześniej, i jego atrybuty zmieniają
// kształt obrazu na stałe. Zerowanie idzie tymi samymi ścieżkami co zapis
// rozmiaru (zmiana pliku, zaznaczenie, przełączone ustawienie) i pod tymi samymi
// warunkami - zaznaczenie nie pisze do slotu, którego renderer nie użyje.
// Pomiar NIEUDANY (plik niedostępny, limit czasu) niczego nie zmienia.
//
// ZNANE OGRANICZENIE. Wynik pomiaru zapisuje EDYTOR ZAZNACZONEGO widgetu. Gdy
// redaktor odznaczy widget albo zaznaczy inny, zanim pomiar nowego pliku wróci
// (okno to czas pobrania obrazu), wynik przepada i treść zostaje z nowym
// adresem i pustym rozmiarem - strona renderuje wtedy znacznik bez atrybutów,
// dokładnie jak przed tą funkcją. Wyniku nie dopisujemy po fakcie do widgetu,
// którego redaktor już nie edytuje: taki zapis szedłby przez historię buildera
// poza jego działaniem (osobny krok "cofnij" bez widocznego skutku, wyczyszczony
// stos "ponów", przerwana seria edycji innego widgetu). Stan naprawia kolejne
// zaznaczenie widgetu (pomiar rusza od nowa, bo rozmiaru brak), a do tego czasu
// podpowiedź pod slotem mówi, że wymiary nie są zapisane. Instancji widgetu
// globalnego zaznaczenie nie mierzy, więc tam rozmiar wraca dopiero przy
// kolejnej zmianie pliku albo ustawienia - podpowiedź pokazuje to tak samo.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sun, Moon, Image as ImageIcon } from "lucide-react";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { WIDGET_SCHEMAS, type SchemaField } from "@/lib/builder/schemas";
import { useBuilderLabel } from "@/lib/builder/labelsEn";
import {
  IMAGE_FILE_SLOTS,
  intrinsicSlotUse,
  type ImageFileSlot,
  type SiteLogoSettings,
} from "@/lib/admin/imageIntrinsicUse";
import { measureIntrinsicSize } from "@/lib/media/measureIntrinsicSize";
import { resolveSetting, siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { PropField } from "../../atoms";
import { SchemaFieldControl } from "../../molecules/SchemaFieldControl";
import { ImageSlot } from "./ImageSlot";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
  /**
   * Identyfikator edytowanego widgetu: zmiana = zaznaczono inny obraz, więc
   * jego pliki są mierzone raz (patrz nagłówek pliku). Bez identyfikatora
   * pomiar biegnie tylko przy montażu edytora.
   */
  widgetId?: string;
  /**
   * Instancja widgetu globalnego: samo zaznaczenie nie może niczego zapisać -
   * zapis instancji wypycha jej (być może nieaktualną) migawkę do wspólnego
   * rekordu. Rozmiar jest wtedy mierzony dopiero przy realnej edycji: zmianie
   * pliku albo ustawienia, które włącza użycie rozmiaru (`setRenderOption`).
   */
  isGlobal?: boolean;
}

/** Slot pliku i klucz treści z jego naturalnym rozmiarem. */
type FileSlot = ImageFileSlot;
const INTRINSIC_KEY = { src: "srcIntrinsic", srcDark: "srcDarkIntrinsic" } as const;

/**
 * Stan BIEŻĄCY edytora dla kodu, który działa poza renderem (wynik pomiaru,
 * obsługa zdarzeń): treść z propsa plus `pending` - zapisy już wysłane, których
 * rodzic nie oddał jeszcze propsem. Każdy render zaczyna od pustego `pending`.
 */
interface Latest {
  c: WidgetNode["content"];
  pending: Map<string, Json>;
  setContent: (k: string, v: Json) => void;
  siteLogo: SiteLogoSettings;
}

const readLatest = (now: Latest, key: string): unknown =>
  now.pending.has(key) ? now.pending.get(key) : now.c[key];
const readText = (now: Latest, key: string): string => {
  const value = readLatest(now, key);
  return typeof value === "string" ? value : "";
};
/** Które sloty renderer zasili rozmiarem z treści - przy bieżącym stanie edytora. */
const slotUse = (now: Latest) => intrinsicSlotUse((key) => readLatest(now, key), now.siteLogo);

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

export function ImageEditor({ c, lang, setContent, widgetId, isGlobal = false }: Props) {
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
  // własny plik widgetu, czyli czy jego rozmiar jest do czegokolwiek potrzebny.
  const { data: siteSettings } = useQuery({ ...siteSettingsQueryOptions, enabled: false });
  const siteLogo = resolveSetting<{ logo?: SiteLogoSettings }>(
    siteSettings,
    "theme_options",
    {},
  ).logo;

  // Stan BIEŻĄCY dla wyników pomiaru, które wracają asynchronicznie: wynik
  // wolno zapisać tylko wtedy, gdy slot nadal wskazuje zmierzony plik.
  const latest = useRef<Latest>({ c, pending: new Map(), setContent, siteLogo });
  useEffect(() => {
    latest.current = { c, pending: new Map(), setContent, siteLogo };
  });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * Mierzy plik slotu i zapisuje rozmiar, jeśli różni się od zapisanego. Plik
   * bez własnej proporcji (`noRatio`) zapisuje rozmiar PUSTY, czyli zeruje
   * wartość zapisaną wcześniej; pomiar nieudany niczego nie zapisuje.
   * `onlyIfUsed`: pomiar wywołany zaznaczeniem albo przełączeniem ustawienia -
   * wynik przepada, gdy renderer w międzyczasie przestał rozmiaru używać.
   */
  const capture = useCallback((slot: FileSlot, url: string, onlyIfUsed = false) => {
    if (!url) return;
    void measureIntrinsicSize(url).then(({ size, noRatio }) => {
      const now = latest.current;
      const key = INTRINSIC_KEY[slot];
      if (
        !alive.current ||
        !(size || noRatio) ||
        readText(now, slot) !== url ||
        readText(now, key) === size
      ) {
        return;
      }
      if (onlyIfUsed && !slotUse(now)[slot]) return;
      now.pending.set(key, size);
      now.setContent(key, size);
    });
  }, []);

  /** Zmiana pliku slotu: nowy adres, wyzerowany stary rozmiar, pomiar nowego. */
  const changeSlot = (slot: FileSlot, value: string) => {
    const now = latest.current;
    const key = INTRINSIC_KEY[slot];
    setContent(slot, value);
    // Ten sam krok cofania co adres (zapisy jednego widgetu się zwijają), więc
    // "cofnij" przywraca stary plik RAZEM z jego rozmiarem.
    if (readText(now, key)) setContent(key, "");
    now.pending.set(slot, value);
    now.pending.set(key, "");
    capture(slot, value);
  };

  /**
   * Zapis ustawienia, od którego zależy, czy renderer użyje rozmiaru własnego
   * pliku ("Użyj logo witryny", "Proporcje"). Gdy zmiana WŁĄCZA użycie slotu
   * (zdjęta ramka, wyłączone logo witryny), jego plik jest mierzony od razu.
   * To edycja redaktora, nie zaznaczenie, więc dotyczy też instancji widgetu
   * globalnego - rozmiar wpada w ten sam krok cofania co zmiana ustawienia.
   */
  const setRenderOption = (k: string, v: Json) => {
    const now = latest.current;
    const before = slotUse(now);
    setContent(k, v);
    now.pending.set(k, v);
    const after = slotUse(now);
    for (const slot of IMAGE_FILE_SLOTS) {
      if (!before[slot] && after[slot]) capture(slot, readText(now, slot), true);
    }
  };

  // Treść sprzed tej funkcji (i wklejona poza edytorem) nie ma rozmiaru - mierzymy
  // ją raz, gdy redaktor zaznaczy widget, ale tylko tam, gdzie renderer rozmiaru
  // użyje. Zależność to WYŁĄCZNIE tożsamość widgetu, nigdy adres ani zapisana
  // wartość (patrz nagłówek pliku).
  useEffect(() => {
    if (isGlobal) return;
    const now = latest.current;
    const used = slotUse(now);
    for (const slot of IMAGE_FILE_SLOTS) {
      if (used[slot]) capture(slot, readText(now, slot), true);
    }
  }, [widgetId, isGlobal, capture]);

  const darkHint = t("builder.imageEditor.slotDarkHint");
  // Podpowiedź pod slotem: zapisany rozmiar albo - gdy renderer by go użył, a w
  // treści go nie ma - informacja, że wymiary nie są zapisane: pomiar trwa, nie
  // udał się, plik nie ma własnej proporcji (SVG) albo wynik przepadł (patrz
  // "ZNANE OGRANICZENIE" w nagłówku). Slot, którego rozmiaru renderer nie użyje,
  // zostaje bez tej informacji - tam brak wymiarów niczego nie zmienia.
  const usedNow = intrinsicSlotUse((key) => c[key], siteLogo);
  const sizeNote = (slot: FileSlot, stored: string): string =>
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
