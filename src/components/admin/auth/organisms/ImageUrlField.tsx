// ORGANIZM: pole adresu obrazu z podglądem i wyborem z biblioteki mediów.
//
// Wyprowadzone z `admin.login-settings.tsx` (lokalny `ImageField`, 11 wywołań).
// Dlaczego organizm, a nie molekuła: składa `MediaPickerDialog`, który sięga do
// biblioteki mediów - czyli do danych. Molekuła nie ma prawa do I/O, więc
// granica wypada tutaj.
//
// TRZY STANY PODGLĄDU, KTÓRE MUSZĄ BYĆ ROZRÓŻNIALNE:
//   - własny obraz (adres wpisany albo wybrany),
//   - obraz DOMYŚLNY wbudowany w aplikację (plakietka „Domyślny" - inaczej
//     administrator widzi ilustrację i sądzi, że to jego wybór, a wyczyszczenie
//     pola niczego nie zmienia),
//   - brak obrazu (ikona zastępcza plus tekst).
// Pomyłka między drugim i trzecim to ta sama klasa defektu, co „awaria kontra
// pustka" na listach: dwa różne stany o jednym wyglądzie.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MediaPickerDialog } from "@/components/admin/media/MediaPickerDialog";
import { Image as ImageIcon, Upload, X, Sun, Moon } from "@/lib/lucide-shim";
// Nakładka rejestruje klucze `adminLoginSettings.*` efektem ubocznym importu.
// Organizm woła je sam (plakietka, podpowiedzi, tytuł okna wyboru), więc słownik
// musi trafić do chunka RAZEM z nim - inaczej ekran pokaże goły klucz w chwili,
// gdy trasa przestanie go wciągać przypadkiem.
import "@/lib/i18n-admin-login-settings";

export interface ImageUrlFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  /** `aspect-ratio` ramki podglądu - kadr ma odpowiadać docelowemu miejscu. */
  aspect?: string;
  /** Tło podglądu: ilustracja dla ciemnego motywu na białym tle kłamie. */
  previewBg?: "light" | "dark";
  /** Ikona motywu przy etykiecie (para pól jasny/ciemny stoi obok siebie). */
  icon?: "light" | "dark";
  /** Obraz wbudowany, używany, gdy pole jest puste. */
  fallbackUrl?: string;
}

const PREVIEW_BG = {
  dark: "bg-neutral-900 border-neutral-800",
  light: "bg-neutral-50 border-neutral-200",
} as const;

export function ImageUrlField({
  label,
  value,
  onChange,
  hint,
  aspect = "16 / 9",
  previewBg,
  icon,
  fallbackUrl,
}: ImageUrlFieldProps) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);

  const bgClass = previewBg ? PREVIEW_BG[previewBg] : "bg-muted border-border";
  const IconEl = icon === "dark" ? Moon : icon === "light" ? Sun : null;
  const displayUrl = value || fallbackUrl || "";
  const isFallback = value === "" && Boolean(fallbackUrl);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5">
          {IconEl ? <IconEl className="w-3.5 h-3.5" aria-hidden /> : null}
          {label}
        </Label>
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1"
          >
            <X className="w-3 h-3" /> {t("adminLoginSettings.clear")}
          </button>
        ) : null}
      </div>
      <div
        className={`relative w-full rounded-lg border overflow-hidden ${bgClass} flex items-center justify-center`}
        style={{ aspectRatio: aspect }}
      >
        {displayUrl ? (
          <>
            <img
              src={displayUrl}
              alt={label}
              className="absolute inset-0 w-full h-full object-cover"
            />
            {isFallback ? (
              <span className="absolute top-2 left-2 z-10 rounded-full bg-black/70 text-white text-[10px] px-2 py-0.5 uppercase tracking-wider backdrop-blur">
                {t("adminLoginSettings.defaultBadge")}
              </span>
            ) : null}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground text-xs">
            <ImageIcon className="w-6 h-6 opacity-60" />
            <span>{t("adminLoginSettings.noImage")}</span>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t("adminLoginSettings.imgUrlPlaceholder")}
          className="flex-1"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
          <Upload className="w-3.5 h-3.5 mr-1.5" /> {t("adminLoginSettings.pick")}
        </Button>
      </div>
      {hint ? <p className="text-[11px] text-muted-foreground leading-snug">{hint}</p> : null}
      <MediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(url) => {
          onChange(url);
          setPickerOpen(false);
        }}
        accept="image"
        title={t("adminLoginSettings.pickImage", { label })}
      />
    </div>
  );
}
