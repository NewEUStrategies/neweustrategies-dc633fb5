// Molekuła: byline autora (zdjęcie profilowe eksperta + imię i nazwisko).
//
// JEDEN komponent prezentacyjny dla WSZYSTKICH widgetów z autorem - post-lista,
// slider, lista z oceną, rekomendacje, metadane wpisu, opinia. Wcześniej każdy
// z nich rysował własny byline (inne rozmiary awatara, inna typografia, inna
// obsługa braku zdjęcia), więc ta sama osoba wyglądała inaczej w każdej sekcji
// strony.
//
// Komponent jest CZYSTO PREZENTACYJNY: nie zna treści widgetu ani `WidgetContent`.
// Reguła „co pokazać” żyje w `@/lib/builder/authorDisplay` (rezolwer domeny),
// a tutaj trafia już rozstrzygnięta - dzięki temu tę samą molekułę można wpiąć
// poza builderem (strona autora, stopka wpisu) bez ciągnięcia zależności.
import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import { AppLink } from "@/components/atoms/AppLink";
import { safeImageUrl } from "@/lib/sanitizePure";
import { buildAvatarSrc, buildAvatarSrcSet } from "@/lib/cropSizes";
import {
  AUTHOR_AVATAR_RADIUS_PX_DEFAULT,
  AUTHOR_AVATAR_SIZE_PX_DEFAULT,
  AUTHOR_NAME_SIZE_PX_DEFAULT,
  type AuthorDisplay,
} from "@/lib/builder/authorDisplay";

/** Prezentacja na jasnym tle (domyślna) albo na zdjęciu/ciemnej nakładce. */
type AuthorBylineTone = "default" | "onDark";

export interface AuthorBylineProps {
  /** Imię i nazwisko. Puste = molekuła nie renderuje nic. */
  name: string;
  /** Publiczny URL zdjęcia profilowego; pusty = neutralny placeholder. */
  avatarUrl?: string | null;
  /** Link do profilu autora. Brak = byline nie jest klikalny. */
  href?: string | null;
  /**
   * Rozstrzygnięta prezentacja (widoczność + wymiary + prefiks etykiety).
   * Brak = kontrakt domyślny widgetu: 12 px czcionki, 20 px awatara, oba widoczne.
   */
  display?: AuthorDisplay;
  tone?: AuthorBylineTone;
  className?: string;
  /** Dosypywane do klasy tekstu - np. `truncate` w wąskiej karcie. */
  nameClassName?: string;
  /** Wywoływane, gdy zdjęcie nie da się załadować (widget może je schować). */
  onAvatarError?: () => void;
  /**
   * Przechwycenie kliknięcia. Slider potrzebuje `stopPropagation`, bo cały
   * slajd jest klikalny i przejście do profilu autora nie może zarazem
   * przewinąć karuzeli.
   */
  onClick?: MouseEventHandler<HTMLElement>;
  /** Treść doklejana za nazwiskiem (np. separator i data). */
  children?: ReactNode;
}

/** Kontrakt domyślny - ten sam, który zwraca rezolwer dla pustej treści. */
const FALLBACK_DISPLAY: AuthorDisplay = {
  visible: true,
  showName: true,
  showAvatar: true,
  nameSizePx: AUTHOR_NAME_SIZE_PX_DEFAULT,
  avatarSizePx: AUTHOR_AVATAR_SIZE_PX_DEFAULT,
  avatarRadiusPx: AUTHOR_AVATAR_RADIUS_PX_DEFAULT,
  labelPrefix: "",
  mode: "avatar",
};

export function AuthorByline({
  name,
  avatarUrl,
  href,
  display = FALLBACK_DISPLAY,
  tone = "default",
  className = "",
  nameClassName = "truncate",
  onAvatarError,
  onClick,
  children,
}: AuthorBylineProps) {
  const safeName = name.trim();
  // Sam awatar bez nazwiska jest sensownym trybem, ale awatar bez ŻADNYCH danych
  // autora nie - taki byline byłby pustym kwadratem bez znaczenia.
  if (!display.visible || !safeName) return null;

  const safeAvatar = safeImageUrl(avatarUrl ?? undefined);

  // KONTRAKT ROZMIARU JEST NIENARUSZALNY.
  //
  // Nie wystarczy styl inline. Warstwa typografii widgetu generuje reguły
  // `[data-w-id="…"] span:not([data-typography-exempt]){font-size:… !important}`
  // (patrz `lib/builder/typographyCss`), a `!important` z arkusza BIJE styl
  // inline. Dlatego:
  //   * KAŻDY węzeł bylinu (nie tylko korzeń) nosi `data-typography-exempt`,
  //     więc żadna wygenerowana reguła go nie łapie,
  //   * pudełko zdjęcia jest domknięte z obu stron (`min-*` + `max-*`) i wyjęte
  //     ze zginania flexa, więc ani `h-5 w-5` z klasy, ani `max-width:100%`,
  //     ani ciasny kontener nie zmienią realnych pikseli.
  // Bez tego ustawienie w panelu było „dekoracyjne": zmieniało treść, a nie obraz.
  const exempt = { "data-typography-exempt": "" } as const;
  // SKALOWANIE DESKTOP (>= 768 px): mobile trzyma wartości ustawione w panelu,
  // a desktop dostaje proporcjonalnie większy byline. Dla kontraktu domyślnego
  // (12 px / 20 px) daje to dokładnie 16 px czcionki i 24 px zdjęcia.
  // Wartości jadą jako custom properties, bo media query nie istnieje w stylu
  // inline - reguły `@media` żyją w `src/styles.css` i mają `!important`,
  // żeby wygrać z warstwą typografii widgetu.
  const nameSizeDesktop = Math.round((display.nameSizePx * 16) / AUTHOR_NAME_SIZE_PX_DEFAULT);
  const avatarSizeDesktop = Math.round((display.avatarSizePx * 24) / AUTHOR_AVATAR_SIZE_PX_DEFAULT);
  const textStyle: CSSProperties & Record<string, string | number> = {
    fontSize: `${display.nameSizePx}px`,
    lineHeight: 1.35,
    "--abl-fs-desktop": `${nameSizeDesktop}px`,
  };
  const avatarStyle: CSSProperties & Record<string, string | number> = {
    width: display.avatarSizePx,
    height: display.avatarSizePx,
    minWidth: display.avatarSizePx,
    minHeight: display.avatarSizePx,
    maxWidth: display.avatarSizePx,
    maxHeight: display.avatarSizePx,
    borderRadius: display.avatarRadiusPx,
    flex: "0 0 auto",
    "--abl-av-desktop": `${avatarSizeDesktop}px`,
    "--abl-av-fs-desktop": `${Math.round(avatarSizeDesktop * 0.55)}px`,
  };

  const avatar = display.showAvatar ? (
    safeAvatar ? (
      <img
        // Serwerowy resize do rozmiaru wyswietlania (1x/2x/3x): przegladarka
        // dostaje maly, ostry kwadrat zamiast skalowac oryginal 1600 px.
        src={buildAvatarSrc(safeAvatar, avatarSizeDesktop)}
        srcSet={buildAvatarSrcSet(safeAvatar, avatarSizeDesktop) || undefined}
        // Nazwisko stoi obok jako tekst, więc zdjęcie jest dekoracyjne -
        // czytnik ekranu nie ma go powtarzać. Bez nazwiska niesie treść.
        alt={display.showName ? "" : safeName}
        width={display.avatarSizePx}
        height={display.avatarSizePx}
        loading="lazy"
        decoding="async"
        className="shrink-0 object-cover"
        style={avatarStyle}
        onError={onAvatarError}
        data-author-byline-avatar=""
        {...exempt}
      />
    ) : (
      // Autor bez zdjęcia dostaje inicjał, nie pusty prostokąt - byline
      // zachowuje rytm siatki i od razu widać, że to miejsce na osobę.
      <span
        aria-hidden={display.showName ? true : undefined}
        aria-label={display.showName ? undefined : safeName}
        role={display.showName ? undefined : "img"}
        className="inline-flex shrink-0 items-center justify-center bg-muted font-semibold text-foreground/70"
        style={{ ...avatarStyle, fontSize: `${Math.round(display.avatarSizePx * 0.55)}px` }}
        data-author-byline-avatar=""
        {...exempt}
      >
        {safeName.charAt(0).toUpperCase()}
      </span>
    )
  ) : null;

  const textCls = tone === "onDark" ? "text-white/90" : "";
  const labelCls = tone === "onDark" ? "text-white/70" : "opacity-70";
  const nameCls = `${nameClassName} ${textCls}`.trim();
  // Prefiks jest ODRĘBNYM elementem (a nie sklejonym napisem), więc da się go
  // osobno przygasić i odczytać - ale zostaje WEWNĄTRZ tekstu nazwiska, żeby
  // `textContent` brzmiał „Autor: Jan Kowalski", a nie „Autor:Jan Kowalski".
  const inner = (
    <>
      {avatar}
      {display.showName ? (
        display.labelPrefix ? (
          <span className={nameCls} style={textStyle} data-author-byline-name="" {...exempt}>
            <span className={labelCls} style={textStyle} data-author-byline-label="" {...exempt}>
              {display.labelPrefix}
            </span>
            <span style={textStyle} {...exempt}>
              {safeName}
            </span>
          </span>
        ) : (
          <span className={nameCls} style={textStyle} data-author-byline-name="" {...exempt}>
            {safeName}
          </span>
        )
      ) : null}
      {children}
    </>
  );

  const baseCls = [
    "inline-flex min-w-0 items-center gap-1.5 font-medium transition-colors",
    tone === "onDark"
      ? "text-white/85 hover:text-white"
      : "text-muted-foreground hover:text-primary",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (href) {
    return (
      <AppLink
        href={href}
        className={baseCls}
        style={textStyle}
        onClick={onClick}
        data-author-byline={display.mode}
        data-typography-exempt
      >
        {inner}
      </AppLink>
    );
  }

  return (
    <span
      className={baseCls}
      style={textStyle}
      onClick={onClick}
      data-author-byline={display.mode}
      data-typography-exempt
    >
      {inner}
    </span>
  );
}
