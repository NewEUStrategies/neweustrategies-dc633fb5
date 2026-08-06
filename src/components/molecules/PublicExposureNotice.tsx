// Nota ekspozycji publicznej: czy profil użytkownika jest osiągalny dla osób
// niezalogowanych i robotów - i dlaczego.
//
// Zastępuje dawne, płaskie zdanie „nigdy nie jesteś widoczny poza platformą",
// które było nieprawdziwe dla autorów i ekspertów (ich hub /author/$slug jest
// publiczny z założenia), a dla zwykłych członków było obietnicą bez pokrycia,
// dopóki widok `profiles_public` nie dostał bramki (migracja 20260806160000).
//
// Molekuła czysto prezentacyjna: zero I/O, zero stanu, dane wyłącznie z propsów -
// dzięki temu testuje się ją bez klienta zapytań i da się jej użyć na dowolnej
// powierzchni (panel tożsamości, onboarding, ekran RODO). Kolory wyłącznie z
// tokenów semantycznych, więc nota wygląda spójnie w obu motywach.
import { Globe2, ShieldCheck, HelpCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ensureI18n } from "@/lib/i18n-chat";
import { exposureReasons, type PublicExposure } from "@/lib/profile/publicExposure";

export interface PublicExposureNoticeProps {
  /** Stan z `usePublicExposure()`; `null` = baza nie odpowiedziała (nota neutralna). */
  exposure: PublicExposure | null;
  /** Trwa odczyt - pokazujemy zapowiedź zamiast migotania stanem domyślnym. */
  loading?: boolean;
  className?: string;
}

function noticeClasses(tone: "public" | "private" | "unknown", extra?: string): string {
  const base = "flex items-start gap-2.5 rounded-[5px] border px-3 py-2.5 text-left";
  const toneClass =
    tone === "public"
      ? "border-[var(--brand)]/40 bg-[var(--brand)]/5"
      : tone === "private"
        ? "border-border/60 bg-muted/40"
        : "border-dashed border-border/60 bg-transparent";
  return [base, toneClass, extra ?? ""].filter(Boolean).join(" ");
}

export function PublicExposureNotice({ exposure, loading, className }: PublicExposureNoticeProps) {
  // Rejestracja słownika w chunku, który molekułę renderuje (nazwane wiązanie,
  // nie side-effectowy import) - inaczej samodzielne użycie poza panelem
  // tożsamości pokazałoby surowe klucze.
  ensureI18n();
  const { t } = useTranslation();

  if (loading) {
    return (
      <p
        data-testid="public-exposure-notice-loading"
        className={["text-[11px] leading-snug text-muted-foreground/80", className ?? ""]
          .filter(Boolean)
          .join(" ")}
        aria-live="polite"
      >
        {t("profilePrivacy.exposureLoading")}
      </p>
    );
  }

  if (!exposure) {
    return (
      <aside
        data-testid="public-exposure-notice"
        data-state="unknown"
        className={noticeClasses("unknown", className)}
      >
        <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 grid gap-0.5">
          <p className="text-xs font-medium leading-snug">
            {t("profilePrivacy.exposureUnknownTitle")}
          </p>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {t("profilePrivacy.exposureUnknownBody")}
          </p>
        </div>
      </aside>
    );
  }

  const reasons = exposureReasons(exposure);

  if (!exposure.isPublic) {
    return (
      <aside
        data-testid="public-exposure-notice"
        data-state="private"
        className={noticeClasses("private", className)}
      >
        <ShieldCheck
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden
        />
        <div className="min-w-0 grid gap-0.5">
          <p className="text-xs font-medium leading-snug">
            {t("profilePrivacy.exposurePrivateTitle")}
          </p>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {t("profilePrivacy.exposurePrivateBody")}
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside
      data-testid="public-exposure-notice"
      data-state="public"
      className={noticeClasses("public", className)}
    >
      <Globe2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--brand)]" aria-hidden />
      <div className="min-w-0 grid gap-1">
        <p className="text-xs font-medium leading-snug">
          {t("profilePrivacy.exposurePublicTitle")}
        </p>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {t("profilePrivacy.exposurePublicBody")}
        </p>
        {reasons.length > 0 ? (
          <ul className="mt-0.5 flex flex-wrap gap-1.5" data-testid="public-exposure-reasons">
            {reasons.map((reason) => (
              <li
                key={reason}
                className="rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[11px] leading-snug text-muted-foreground"
              >
                {t(`profilePrivacy.exposureReason.${reason}`)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </aside>
  );
}
