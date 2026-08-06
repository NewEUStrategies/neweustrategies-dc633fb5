// Baner odbiorcy linku "Udostepnij pelny artykul" - nad trescia wpisu.
//   "gifted"    - wazny link odblokowal pelna tresc,
//   "exhausted" - budzet klikniec wyczerpany (ktos byl szybszy),
//   "expired"   - link po terminie waznosci,
//   "invalid"   - kod nieprawidlowy/cofniety; tresc zostaje za paywallem.
// Kazdy wariant odmowy ma WLASNE copy, bo odbiorca ma inna sciezke wyjscia:
// przy wyczerpanym budzecie warto poprosic nadawce o nowy link, przy wygasnietym
// - tez, a przy nieprawidlowym pozostaje cennik. We wszystkich wariantach
// subtelne CTA planow (lejek: odbiorca -> subskrybent), spojne stylistycznie
// z MeterBanner (tokeny semantyczne, rounded-[5px]).
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Gift } from "lucide-react";
import type { GiftBannerVariant } from "@/lib/gifting/model";
import "@/lib/i18n-gifting";

interface Props {
  variant: GiftBannerVariant;
}

/** Klucze copy per wariant - jedno miejsce zamiast lancucha ternary w JSX. */
const COPY: Record<GiftBannerVariant, { title: string; desc: string }> = {
  gifted: { title: "gifting.banner.title", desc: "gifting.banner.desc" },
  exhausted: {
    title: "gifting.banner.exhaustedTitle",
    desc: "gifting.banner.exhaustedDesc",
  },
  expired: { title: "gifting.banner.expiredTitle", desc: "gifting.banner.expiredDesc" },
  invalid: { title: "gifting.banner.invalidTitle", desc: "gifting.banner.invalidDesc" },
};

export function GiftBanner({ variant }: Props) {
  const { t } = useTranslation();
  const granted = variant === "gifted";
  const copy = COPY[variant];

  return (
    <div
      role="status"
      data-gift-banner={variant}
      className={[
        "no-print mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[5px] border px-4 py-3",
        granted
          ? "border-brand/30 bg-gradient-to-r from-brand/10 to-transparent"
          : "border-border bg-muted/40",
      ].join(" ")}
    >
      <span
        className={[
          "shrink-0 h-9 w-9 rounded-full grid place-items-center",
          granted ? "bg-brand/15" : "bg-muted",
        ].join(" ")}
      >
        <Gift
          className={granted ? "w-4 h-4 text-brand" : "w-4 h-4 text-muted-foreground"}
          aria-hidden
        />
      </span>
      <div className="flex-1 min-w-[12rem]">
        <p className="text-[13px] font-bold leading-tight text-foreground">{t(copy.title)}</p>
        <p className="text-[12px] leading-snug text-muted-foreground">{t(copy.desc)}</p>
      </div>
      <Link
        to="/pricing"
        className="shrink-0 inline-flex items-center justify-center h-8 px-3 rounded-[5px] border border-border bg-background text-[12px] font-semibold text-foreground hover:bg-muted hover:text-brand transition-colors"
      >
        {t("gifting.banner.cta")}
      </Link>
    </div>
  );
}
