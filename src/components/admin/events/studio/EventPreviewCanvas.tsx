// Podglad strony wydarzenia - to, co zobaczy uczestnik po publikacji.
//
// DLACZEGO RYSUJEMY, A NIE OSADZAMY `<iframe>` STRONY PUBLICZNEJ. Podglad ma
// pokazywac WERSJE ROBOCZA - tytul, ktory redaktor wlasnie wpisuje, i kolor,
// ktory wlasnie wybral. Ramka z adresem publicznym pokazuje stan ZAPISANY
// i odswieza sie dopiero po zapisie, czyli odpowiada na pytanie, ktorego nikt
// nie zadaje. Rysunek z tego samego szkicu, ktory karmi formularz, jest jedynym
// sposobem, zeby podglad byl „na zywo".
//
// TO JEST WIERNY SZKIC, NIE DRUGI RENDERER STRONY. Uklad (pasek nawigacji,
// naglowek z okladka, kafle podstron, blok informacji, stopka) odpowiada
// stronie publicznej wydarzenia, ale nie wchodzi w widgety buildera - inaczej
// powstalby drugi silnik stron, czyli ryzyko nr 1 z projektu modulu
// (`docs/PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md` §9.1).
//
// KANWA MA STALA SZEROKOSC WIRTUALNA, a skaluje ja rodzic (`transform: scale`).
// Dzieki temu proporcje typografii i odstepow sa takie jak na prawdziwym
// ekranie - podglad rysowany „responsywnie" w waskim panelu pokazywalby uklad
// mobilny i klamalby o wygladzie na komputerze.
import { useTranslation } from "react-i18next";
import { CalendarDays, MapPin, Play } from "@/lib/lucide-shim";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { eventLanguageLabel } from "@/lib/events/eventLanguages";
import { EVENT_FORMAT_LABEL_KEYS } from "@/lib/events/eventTypes";
import { formatEventDateTime, eventTimeZoneLabel } from "@/lib/events/timezone";
import { uiLang } from "@/lib/i18n/format";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";
import type { EventPreviewModel } from "@/components/admin/events/studio/EventStudioPreviewContext";

/** Szerokosci wirtualne kanwy - rzeczywiste punkty zalamania strony publicznej. */
export const PREVIEW_WIDTHS = { desktop: 1240, mobile: 390 } as const;
export type PreviewDevice = keyof typeof PREVIEW_WIDTHS;

interface Palette {
  nav: string;
  action: string;
  text: string;
  block: string;
  page: string;
  muted: string;
  border: string;
  onAction: string;
}

/**
 * Paleta podgladu. Slot pusty = wartosc z motywu - i to jest cala mechanika
 * dziedziczenia brandingu: podglad ma pokazac to samo, co zobaczy uczestnik,
 * gdy wydarzenie nie nadpisze koloru.
 */
function palette(model: EventPreviewModel): Palette {
  const dark = model.branding.appearance === "dark";
  const colors = model.branding.colors;
  const fallback = {
    nav: dark ? "#0B1120" : "#01112F",
    action: "#FA9346",
    text: dark ? "#F5F7FA" : "#01112F",
    block: dark ? "#111827" : "#FFFFFF",
    page: dark ? "#050B18" : "#F3F5F9",
  };
  const text = colors.text === "" ? fallback.text : colors.text;
  return {
    nav: colors.navigation === "" ? fallback.nav : colors.navigation,
    action: colors.main_action === "" ? fallback.action : colors.main_action,
    text,
    block: colors.blocks_background === "" ? fallback.block : colors.blocks_background,
    page: colors.page_background === "" ? fallback.page : colors.page_background,
    muted: dark ? "rgba(245,247,250,0.62)" : "rgba(1,17,47,0.60)",
    border: dark ? "rgba(255,255,255,0.12)" : "rgba(1,17,47,0.10)",
    onAction: "#FFFFFF",
  };
}

export function EventPreviewCanvas({
  model,
  device,
}: {
  model: EventPreviewModel;
  device: PreviewDevice;
}) {
  ensureAdminEventsI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const colors = palette(model);
  const mobile = device === "mobile";

  const title =
    (lang === "en" ? model.titleEn || model.titlePl : model.titlePl || model.titleEn) ||
    t("adminEvents.studio.preview.untitled");
  const description =
    lang === "en"
      ? model.descriptionEn || model.descriptionPl
      : model.descriptionPl || model.descriptionEn;
  const dateLabel = formatEventDateTime(model.startsAt, model.timezone, lang);
  const endLabel = formatEventDateTime(model.endsAt, model.timezone, lang);
  const zoneLabel = eventTimeZoneLabel(model.startsAt, model.timezone, lang);
  const place = [model.locationName, model.addressLine].filter((part) => part !== "").join(" · ");

  return (
    <div
      style={{ width: PREVIEW_WIDTHS[device], background: colors.page, color: colors.text }}
      className="font-sans"
      data-testid="event-preview-canvas"
    >
      {/* Pasek nawigacji - kolor `navigation`, akcja glowna po prawej. */}
      <div
        style={{ background: colors.nav }}
        className={
          "flex items-center justify-between text-white " + (mobile ? "px-4 py-3" : "px-8 py-4")
        }
      >
        <span className={mobile ? "text-sm font-semibold" : "text-base font-semibold"}>
          {title}
        </span>
        {mobile ? null : (
          <nav className="flex items-center gap-5 text-[13px] opacity-90">
            {model.menu.slice(0, 5).map((item) => (
              <span key={item.key}>{item.label}</span>
            ))}
          </nav>
        )}
        <span
          style={{ background: colors.action, color: colors.onAction }}
          className="rounded-md px-3 py-1.5 text-[13px] font-medium"
        >
          {t("adminEvents.studio.preview.register")}
        </span>
      </div>

      {/* Naglowek: naglowek wideo zastepuje banner, okladka zostaje miniatura. */}
      <div className="relative">
        <div
          className={mobile ? "h-40 w-full" : "h-72 w-full"}
          style={{
            backgroundColor: colors.nav,
            backgroundImage:
              model.coverUrl === "" ? undefined : `url(${JSON.stringify(model.coverUrl)})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        {model.videoId === "" ? null : (
          <span className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white">
            <Play className="h-5 w-5" aria-hidden="true" />
          </span>
        )}
      </div>

      <div className={mobile ? "space-y-4 p-4" : "space-y-6 p-8"}>
        {/* Blok tytulowy */}
        <div
          style={{ background: colors.block, borderColor: colors.border }}
          className={"rounded-xl border " + (mobile ? "p-4" : "p-6")}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              style={{ background: colors.action, color: colors.onAction }}
              className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
            >
              {t(EVENT_FORMAT_LABEL_KEYS[model.format])}
            </span>
            {model.hashtag === "" ? null : (
              <span style={{ color: colors.muted }} className="text-[11px]">
                #{model.hashtag}
              </span>
            )}
          </div>
          <h1 className={"mt-2 font-semibold " + (mobile ? "text-xl" : "text-3xl")}>{title}</h1>
          <div style={{ color: colors.muted }} className="mt-3 flex flex-col gap-1.5 text-[13px]">
            <span className="inline-flex items-center gap-2">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              {dateLabel === "" ? t("adminEvents.studio.preview.noDate") : dateLabel}
              {endLabel === "" ? "" : ` – ${endLabel}`}
              {zoneLabel === "" ? "" : ` (${zoneLabel})`}
            </span>
            {place === "" ? null : (
              <span className="inline-flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                {place}
              </span>
            )}
          </div>
          <span
            style={{ background: colors.action, color: colors.onAction }}
            className="mt-4 inline-block rounded-md px-4 py-2 text-sm font-medium"
          >
            {t("adminEvents.studio.preview.register")}
          </span>
        </div>

        {/* Podstrony wydarzenia - ta sama lista, co menu, w dwoch prezentacjach. */}
        {model.menu.length === 0 ? null : (
          <div
            className={
              model.pagesDisplayMode === "grid"
                ? "grid gap-3 " + (mobile ? "grid-cols-2" : "grid-cols-4")
                : "flex flex-col gap-2"
            }
          >
            {model.menu.map((item) => (
              <div
                key={item.key}
                style={{ background: colors.block, borderColor: colors.border }}
                className={
                  "flex items-center gap-3 rounded-lg border " +
                  (model.pagesDisplayMode === "grid" ? "flex-col p-4 text-center" : "p-3")
                }
              >
                <span
                  style={{ background: item.color === "" ? colors.action : item.color }}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-white"
                >
                  <DynamicIcon name={item.icon} size={16} />
                </span>
                <span className="text-[13px] font-medium">{item.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Informacje o wydarzeniu */}
        {description === "" ? null : (
          <div
            style={{ background: colors.block, borderColor: colors.border }}
            className={"rounded-xl border " + (mobile ? "p-4" : "p-6")}
          >
            <h2 className="text-sm font-semibold uppercase tracking-wide">
              {t("adminEvents.studio.preview.about")}
            </h2>
            <p
              style={{ color: colors.muted }}
              className="mt-2 whitespace-pre-line text-[13px] leading-relaxed"
            >
              {description}
            </p>
          </div>
        )}

        {/* Stopka: jezyki tresci i kontakt - to, co redaktor wlasnie ustawil. */}
        <div
          style={{ borderColor: colors.border, color: colors.muted }}
          className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-4 text-[12px]"
        >
          {model.languages.length === 0 ? null : (
            <span>
              {t("adminEvents.studio.preview.languages")}:{" "}
              {model.languages.map((code) => eventLanguageLabel(code, lang)).join(", ")}
            </span>
          )}
          {model.supportEmail === "" ? null : (
            <span>
              {t("adminEvents.studio.preview.support")}: {model.supportEmail}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
