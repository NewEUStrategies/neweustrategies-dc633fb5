// Publiczny profil organizacji - nagłówek tożsamości + sekcje.
//
// TO NIE JEST ARCHIWUM Z INNYM TYTUŁEM. Archiwum odpowiada na pytanie „co tu
// wyszło"; profil organizacji najpierw mówi, KIM jest ten byt (logo, nazwa,
// branża, adres), potem KTO za nim stoi, a dopiero na końcu pokazuje dorobek.
// Dlatego układ dziedziczy po wspólnym szkielecie profilu (`ProfileShell`),
// a nie po layoutach archiwum - organizacja i człowiek mają w tym serwisie
// wyglądać jak dwa warianty tej samej wizytówki, nie jak dwa różne serwisy.
//
// KONTRAKT „BRAK DANEJ = ELEMENT ZNIKA". Każda pigułka meta renderuje się
// wyłącznie przy niepustej wartości. Nie ma pustych slotów, nie ma separatorów
// bez sąsiada i nie ma pigułki „Branża: -". Brak logo schodzi do inicjału w
// kafelku szkieletu, brak opisu usuwa całą kartę „O organizacji".
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Building2, Globe, Newspaper } from "lucide-react";

import {
  ProfileHeroFrame,
  ProfileIdentityBlock,
  ProfileMetaPill,
  ProfileMetaRow,
  ProfileNameRow,
  ProfileSectionCard,
} from "@/components/profile/shell/ProfileShell";
import { ensureI18n as ensureOrganizationsI18n } from "@/lib/i18n-organizations";
import {
  organizationDescription,
  organizationName,
  type OrganizationData,
} from "@/lib/queries/organization";

/** Adres bez protokołu i końcowego ukośnika - pigułka ma pokazywać domenę,
 *  a nie pełny URL z „https://" zjadającym połowę szerokości na telefonie. */
export function prettyWebsite(url: string): string {
  return url
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
}

/** Adres do atrybutu `href`. Kartoteka bywa wypełniona bez protokołu, a wtedy
 *  przeglądarka potraktowałaby wartość jako ścieżkę względną. */
export function websiteHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function OrganizationProfile({
  data,
  lang,
  total,
  children,
}: {
  data: OrganizationData;
  lang: "pl" | "en";
  /** Liczba publikacji - pigułka pojawia się dopiero od pierwszej. */
  total: number;
  /** Sekcje pod nagłówkiem (osoby, publikacje). */
  children?: ReactNode;
}) {
  // Rejestracja słownika w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureOrganizationsI18n();
  const { t } = useTranslation();
  const { term, brand } = data;
  const name = organizationName(term, lang);
  const description = organizationDescription(term, lang);
  // Logo z kartoteki ma pierwszeństwo: jest utrzymywane przez redakcję, term
  // bywa zasiany bez grafiki.
  const logoUrl = brand?.logoUrl ?? term.logo_url;
  const branch = brand?.branch ?? null;
  const website = brand?.website ?? null;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-4 pb-14 pt-6 lg:px-8">
      <ProfileHeroFrame coverUrl={null} avatarUrl={logoUrl} fullName={name} />
      <ProfileIdentityBlock>
        <ProfileNameRow name={name} />
        <p className="mt-0.5 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:text-left">
          {t("organization.tagline")}
        </p>
        <ProfileMetaRow>
          {branch !== null ? (
            <ProfileMetaPill icon={<Building2 />} brandKey="location">
              {branch}
            </ProfileMetaPill>
          ) : null}
          {website !== null ? (
            <ProfileMetaPill icon={<Globe />} href={websiteHref(website)} brandKey="website">
              {prettyWebsite(website)}
            </ProfileMetaPill>
          ) : null}
          {total > 0 ? (
            <ProfileMetaPill icon={<Newspaper />}>
              {t("organization.postsCount", { count: total })}
            </ProfileMetaPill>
          ) : null}
        </ProfileMetaRow>
      </ProfileIdentityBlock>

      {description !== null ? (
        <ProfileSectionCard
          icon={<Building2 className="h-3.5 w-3.5" />}
          title={t("organization.aboutHeading")}
        >
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        </ProfileSectionCard>
      ) : null}

      {children}
    </div>
  );
}
