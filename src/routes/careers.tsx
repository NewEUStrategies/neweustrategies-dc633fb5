// Publiczna strona kariery (/careers - "Dołącz do zespołu").
// Trasa statyczna wygrywa z resolverem CMS ($.tsx). Cała treść jest
// dwujęzyczna (i18n `careers.*`), a formularz aplikacyjny korzysta z tej samej
// utwardzonej funkcji serwerowej co formularz kontaktowy.
import { useCallback, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { staticPageSeoQueryOptions, pickStaticSeo } from "@/lib/queries/staticPageSeo";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { ensureI18n as ensureCareersI18n } from "@/lib/i18n-careers";
import { CareersHero } from "@/components/careers/organisms/CareersHero";
import { CareersValues } from "@/components/careers/organisms/CareersValues";
import { CareersRoles } from "@/components/careers/organisms/CareersRoles";
import { CareersProcess } from "@/components/careers/organisms/CareersProcess";
import { CareersApplyForm } from "@/components/careers/organisms/CareersApplyForm";
import { CareersClosing } from "@/components/careers/organisms/CareersClosing";

const ROLES_ID = "careers-open-roles";
const FORM_ID = "careers-application";

export const Route = createFileRoute("/careers")({
  component: CareersPage,
  loader: async ({ context }) => {
    const seo = await context.queryClient
      .ensureQueryData(staticPageSeoQueryOptions("careers"))
      .catch(() => null);
    return { seo };
  },
  head: ({ loaderData }) => {
    const lang = activeLang(getRequestUrl() || "/careers");
    const isEn = lang === "en";
    const seo = pickStaticSeo(loaderData?.seo ?? null, lang, {
      title: isEn
        ? "Careers - join the New European Strategies team"
        : "Kariera - dołącz do zespołu New European Strategies",
      description: isEn
        ? "Open roles at New European Strategies: research, public policy, marketing, advisory, editorial and operations. Apply online in 3 minutes."
        : "Otwarte role w New European Strategies: analizy, polityka publiczna, marketing, doradztwo, redakcja i operacje. Aplikuj online w 3 minuty.",
    });
    const meta: Array<Record<string, string>> = [
      { title: seo.title },
      { name: "description", content: seo.description },
      { property: "og:title", content: seo.title },
      { property: "og:description", content: seo.description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ];
    if (seo.image) {
      meta.push({ property: "og:image", content: seo.image });
      meta.push({ name: "twitter:image", content: seo.image });
    }
    if (seo.noindex) meta.push({ name: "robots", content: "noindex,nofollow" });
    return { meta, links: seo.canonical ? [{ rel: "canonical", href: seo.canonical }] : [] };
  },
  errorComponent: ({ error }) => (
    <div role="alert" className="container mx-auto max-w-3xl px-4 py-16 text-sm text-destructive">
      {error.message}
    </div>
  ),
});

function CareersPage() {
  ensureCareersI18n();
  const lang = activeLang(typeof window === "undefined" ? getRequestUrl() || "/careers" : window.location.pathname);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

  const scrollTo = useCallback((id: string) => {
    if (typeof document === "undefined") return;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handleApply = useCallback(
    (roleId: string) => {
      setSelectedRoleId(roleId);
      scrollTo(FORM_ID);
    },
    [scrollTo],
  );

  const openApplication = useCallback(() => {
    setSelectedRoleId(null);
    scrollTo(FORM_ID);
  }, [scrollTo]);

  return (
    <div className="container mx-auto max-w-6xl px-4 py-10 md:py-14 xl:max-w-[88rem]">
      <CareersHero onSeeRoles={() => scrollTo(ROLES_ID)} onOpenApplication={openApplication} />
      <CareersValues />
      <CareersRoles id={ROLES_ID} selectedRoleId={selectedRoleId} onApply={handleApply} />
      <CareersProcess />
      <CareersApplyForm
        id={FORM_ID}
        lang={lang === "en" ? "en" : "pl"}
        selectedRoleId={selectedRoleId}
        onRoleChange={setSelectedRoleId}
      />
      <CareersClosing onOpenApplication={openApplication} />
    </div>
  );
}
