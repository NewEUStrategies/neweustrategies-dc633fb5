// Gift Articles - baner odbiorcy nad trescia wpisu.
//   variant="gifted"  - wazny kod odblokowal pelna tresc ("artykul podarowany"),
//   variant="invalid" - kod nieprawidlowy/wygasly, tresc zostaje za paywallem.
// W obu wariantach subtelne CTA planow (lejek: odbiorca prezentu -> subskrybent),
// spojne stylistycznie z MeterBanner (tokeny semantyczne, rounded-[5px]).
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Gift } from "lucide-react";
import "@/lib/i18n-gifting";

interface Props {
  variant: "gifted" | "invalid";
}

export function GiftBanner({ variant }: Props) {
  const { t } = useTranslation();
  const invalid = variant === "invalid";

  return (
    <div
      role="status"
      data-gift-banner={variant}
      className={[
        "no-print mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[5px] border px-4 py-3",
        invalid
          ? "border-border bg-muted/40"
          : "border-brand/30 bg-gradient-to-r from-brand/10 to-transparent",
      ].join(" ")}
    >
      <span
        className={[
          "shrink-0 h-9 w-9 rounded-full grid place-items-center",
          invalid ? "bg-muted" : "bg-brand/15",
        ].join(" ")}
      >
        <Gift
          className={invalid ? "w-4 h-4 text-muted-foreground" : "w-4 h-4 text-brand"}
          aria-hidden
        />
      </span>
      <div className="flex-1 min-w-[12rem]">
        <p className="text-[13px] font-bold leading-tight text-foreground">
          {t(invalid ? "gifting.banner.invalidTitle" : "gifting.banner.title")}
        </p>
        <p className="text-[12px] leading-snug text-muted-foreground">
          {t(invalid ? "gifting.banner.invalidDesc" : "gifting.banner.desc")}
        </p>
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
