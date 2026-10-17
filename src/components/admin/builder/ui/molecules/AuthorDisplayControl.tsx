// Molekuła: prezentacja autora - JEDNA kontrolka dla WSZYSTKICH widgetów.
//
// Wcześniej każdy edytor rysował własny wariant tego ustawienia: post-lista
// miała trójstanowy `Select`, slider ten sam `Select` plus dwa pola rozmiaru,
// lista z oceną goły checkbox, a widgety schematowe wyłącznie „Pokaż autora”.
// Rozmiar czcionki i zdjęcia dało się zmienić WYŁĄCZNIE w sliderze.
//
// Ta molekuła zamyka cały kontrakt (`@/lib/builder/authorDisplay`) w jednym
// miejscu i jest wpinana zarówno w edytory niestandardowe, jak i w zakładkę
// „Treść” widgetów schematowych. Czyta stan TYM SAMYM rezolwerem, którego używa
// renderer, więc panel nie może obiecać ustawienia, którego widget nie honoruje
// (pilnuje tego bramka wierności ustawień).
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";
import { RotateCcw } from "@/lib/lucide-shim";
import type { Json, WidgetContent } from "@/lib/builder/types";
import {
  AUTHOR_AVATAR_SIZE_PX_DEFAULT,
  AUTHOR_AVATAR_SIZE_PX_MAX,
  AUTHOR_AVATAR_SIZE_PX_MIN,
  AUTHOR_DISPLAY_KEYS,
  AUTHOR_NAME_SIZE_PX_DEFAULT,
  AUTHOR_NAME_SIZE_PX_MAX,
  AUTHOR_NAME_SIZE_PX_MIN,
  authorVisibilityPatch,
  defaultAuthorLabel,
  resolveAuthorDisplay,
  type AuthorDisplayDefaults,
} from "@/lib/builder/authorDisplay";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { NumberInput, PropField } from "../atoms";

interface Props {
  c: WidgetContent;
  /** Język EDYTOWANEJ treści - decyduje, którą etykietę (`_pl`/`_en`) zapisujemy. */
  lang: "pl" | "en";
  setContent: (key: string, value: Json) => void;
  /** Baseline widgetu, gdy różni się od globalnego (12 px / 20 px, oba widoczne). */
  defaults?: AuthorDisplayDefaults;
  /**
   * Widget nie renderuje zdjęcia (np. metadane wpisu w wariancie tekstowym).
   * Oś awatara znika z panelu, ale kontrakt treści zostaje bez zmian.
   */
  avatarSupported?: boolean;
}

export function AuthorDisplayControl({
  c,
  lang,
  setContent,
  defaults,
  avatarSupported = true,
}: Props) {
  const { t } = useTranslation();
  const display = resolveAuthorDisplay(c, lang, defaults);

  // Widoczność zapisujemy ZAWSZE parą (kanoniczne + historyczne klucze), żeby
  // dokument pozostał czytelny dla starszych rendererów - patrz komentarz przy
  // `authorVisibilityPatch`.
  const setVisibility = (showName: boolean, showAvatar: boolean): void => {
    for (const [key, value] of Object.entries(authorVisibilityPatch(showName, showAvatar))) {
      setContent(key, value as Json);
    }
  };

  // Etykiety wyciągnięte przed JSX: ta sama treść opisuje pole wizualnie
  // (PropField) i dla czytnika ekranu (aria-label), więc nie mogą się rozjechać.
  const nameSizeLabel = t("builder.authorDisplay.nameSize");
  const avatarSizeLabel = t("builder.authorDisplay.avatarSize");
  const labelTextLabel = t("builder.authorDisplay.labelText");

  // Pole pokazuje WPISANĄ wartość, a nie przyciętą do zakresu: przy wpisywaniu
  // „11” pierwsza cyfra (1) zamieniała się na 8, kolejna dawała „81” -> 24 px.
  // Renderer i tak przycina (rezolwer), a pole nie przeskakuje pod palcami.
  const typed = (key: string, resolved: number): number => {
    const raw = c[key];
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    return Number.isFinite(n) && String(raw).trim() !== "" ? n : resolved;
  };

  const labelKey = `${AUTHOR_DISPLAY_KEYS.label}_${lang}`;
  const labelValue = typeof c[labelKey] === "string" ? (c[labelKey] as string) : "";

  return (
    <div className="space-y-2" data-author-display-control={display.mode}>
      <label className="flex cursor-pointer items-center justify-between gap-2 py-1">
        <span className="text-xs">{t("builder.authorDisplay.showName")}</span>
        <Switch
          checked={display.showName}
          onCheckedChange={(v) => setVisibility(v, display.showAvatar)}
        />
      </label>

      {avatarSupported && (
        <label className="flex cursor-pointer items-center justify-between gap-2 py-1">
          <span className="text-xs">{t("builder.authorDisplay.showAvatar")}</span>
          <Switch
            checked={display.showAvatar}
            onCheckedChange={(v) => setVisibility(display.showName, v)}
          />
        </label>
      )}

      {display.showName && (
        <label className="flex cursor-pointer items-center justify-between gap-2 py-1">
          <span className="text-xs">{t("builder.authorDisplay.relativeToTitle")}</span>
          <Switch
            checked={display.relativeToTitle ?? true}
            onCheckedChange={(value) => setContent(AUTHOR_DISPLAY_KEYS.relativeToTitle, value)}
          />
        </label>
      )}

      {/* Pole rozmiaru jest widoczne ZAWSZE: wpisana wartość ma być od razu
          widać w kanwie i podglądzie, więc wpisanie jej przełącza byline na
          rozmiar stały (dosłowny na każdym urządzeniu), a wyczyszczenie pola
          wraca do „tytuł minus 2 px”. W trybie tytułu pole mówi, jaki rozmiar
          obowiązuje tam, gdzie karta nie ma tytułu. */}
      {display.showName && (
        <PropField
          label={nameSizeLabel}
          hint={display.relativeToTitle ? t("builder.authorDisplay.nameSizeHint") : undefined}
        >
          <NumberInput
            ariaLabel={nameSizeLabel}
            value={typed(AUTHOR_DISPLAY_KEYS.nameSizePx, display.nameSizePx)}
            min={AUTHOR_NAME_SIZE_PX_MIN}
            max={AUTHOR_NAME_SIZE_PX_MAX}
            placeholder={String(AUTHOR_NAME_SIZE_PX_DEFAULT)}
            suffix="px"
            onChange={(v) => {
              const typed = typeof v === "number";
              setContent(AUTHOR_DISPLAY_KEYS.nameSizePx, typed ? v : AUTHOR_NAME_SIZE_PX_DEFAULT);
              setContent(AUTHOR_DISPLAY_KEYS.relativeToTitle, !typed);
            }}
          />
        </PropField>
      )}

      {avatarSupported && display.showAvatar && (
        <PropField label={avatarSizeLabel}>
          <NumberInput
            ariaLabel={avatarSizeLabel}
            value={typed(AUTHOR_DISPLAY_KEYS.avatarSizePx, display.avatarSizePx)}
            min={AUTHOR_AVATAR_SIZE_PX_MIN}
            max={AUTHOR_AVATAR_SIZE_PX_MAX}
            placeholder={String(AUTHOR_AVATAR_SIZE_PX_DEFAULT)}
            suffix="px"
            onChange={(v) => {
              // Wpisany rozmiar jest dosłowny (także 20 px); wyczyszczenie pola
              // wraca do kontraktu domyślnego 20 / 24 px.
              const typed = typeof v === "number";
              setContent(
                AUTHOR_DISPLAY_KEYS.avatarSizePx,
                typed ? v : AUTHOR_AVATAR_SIZE_PX_DEFAULT,
              );
              setContent(AUTHOR_DISPLAY_KEYS.avatarSizeExact, typed);
            }}
          />
        </PropField>
      )}

      {/* Etykieta ma sens WYŁĄCZNIE bez zdjęcia: wtedy byline to sam tekst
          „Autor: Imię Nazwisko” / „By: First Last” i potrzebuje wprowadzenia. */}
      {display.showName && !display.showAvatar && (
        <PropField label={labelTextLabel} hint={t("builder.authorDisplay.labelHint")}>
          <Input
            aria-label={labelTextLabel}
            value={labelValue}
            placeholder={defaultAuthorLabel(lang)}
            onChange={(e) => setContent(labelKey, e.target.value)}
            className="h-8 text-xs"
          />
        </PropField>
      )}

      <Button
        variant="ghost"
        type="button"
        className="inline-flex items-center gap-1 text-[10px] text-muted-foreground transition hover:text-foreground"
        onClick={() => {
          setVisibility(defaults?.showName ?? true, defaults?.showAvatar ?? true);
          setContent(AUTHOR_DISPLAY_KEYS.relativeToTitle, true);
          setContent(
            AUTHOR_DISPLAY_KEYS.nameSizePx,
            defaults?.nameSizePx ?? AUTHOR_NAME_SIZE_PX_DEFAULT,
          );
          setContent(
            AUTHOR_DISPLAY_KEYS.avatarSizePx,
            defaults?.avatarSizePx ?? AUTHOR_AVATAR_SIZE_PX_DEFAULT,
          );
          setContent(AUTHOR_DISPLAY_KEYS.avatarSizeExact, false);
        }}
      >
        <RotateCcw className="h-3 w-3" />
        {t("builder.authorDisplay.reset")}
      </Button>
    </div>
  );
}
