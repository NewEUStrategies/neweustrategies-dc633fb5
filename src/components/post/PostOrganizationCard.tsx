// Karta atrybucji organizacji pod artykułem: logo, nazwa, link do strony.
//
// Czyta WYŁĄCZNIE migawkę z wiersza wpisu (`organization_name`,
// `organization_logo_url`, `organization_website`), nigdy `crm_companies` - ta
// tabela jest czytelna tylko dla stafu CRM, więc dołączenie jej tutaj dałoby
// pustą kartę dla anonimowego czytelnika i pełną w panelu (defekt widoczny
// dopiero po publikacji). Uzasadnienie w migracji 20260817090000.
//
// Link do organizacji NIE dostaje rel="sponsored": atrybucja organizacyjna sama
// z siebie nie jest relacją opłaconą. Gdy materiał JEST komercyjny, płatny link
// niesie osobny komponent (SponsoredDisclosure) - tam rel="sponsored nofollow"
// jest na miejscu. Zlanie tych dwóch rzeczy w jeden link oznaczałoby albo
// nieoznaczoną reklamę, albo oznaczanie zwykłej współpracy jako płatnej.
import { useTranslation } from "react-i18next";
import { Building2 } from "lucide-react";
import "@/lib/i18n-sponsored";

export interface PostOrganizationSnapshot {
  organization_name?: string | null;
  organization_logo_url?: string | null;
  organization_website?: string | null;
}

export function PostOrganizationCard({
  post,
  className,
}: {
  post: PostOrganizationSnapshot;
  className?: string;
}) {
  const { t } = useTranslation();
  const name = (post.organization_name ?? "").trim();
  if (!name) return null;

  const logo = (post.organization_logo_url ?? "").trim();
  const website = (post.organization_website ?? "").trim();

  return (
    <aside
      aria-label={t("postOrganization.heading")}
      className={`not-prose flex items-center gap-3 rounded-[6px] border border-border/70 bg-background/95 p-4 ${className ?? ""}`}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-muted">
        {logo ? (
          <img
            src={logo}
            alt={t("postOrganization.logoAlt", { name })}
            width={44}
            height={44}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-contain"
          />
        ) : (
          <Building2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {t("postOrganization.heading")}
        </span>
        <span className="block truncate text-[14px] font-medium text-foreground">{name}</span>
        {website && (
          <a
            href={website}
            rel="noopener noreferrer"
            target="_blank"
            className="block truncate text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {t("postOrganization.websiteLabel")}
          </a>
        )}
      </span>
    </aside>
  );
}
