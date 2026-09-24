// Profil członka społeczności - każda zarejestrowana osoba (/people/<slug>).
// Autorzy (rola nadana przez admina lub zaproszenie) mają dodatkowo /author.
// Trasa publiczna z bramką inline (AuthGate): dane czyta RPC tenant-scoped
// po stronie klienta, bo sesja żyje w przeglądarce. Zawsze noindex.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AuthGate } from "@/components/profile/AuthGate";
import { MemberProfileView } from "@/components/people/organisms/MemberProfileView";
import { useAuth } from "@/hooks/useAuth";
import { memberProfileQueryOptions } from "@/lib/profile/memberProfile";
import { ensureI18n, memberProfileEn, memberProfilePl } from "@/lib/i18n-member-profile";
import { currentLang } from "@/lib/i18n/localeRuntime";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { SITE_NAME } from "@/lib/seo/meta";

export const Route = createFileRoute("/people/$slug")({
  head: ({ params }) => {
    const lang = activeLang(getRequestUrl() || `/people/${params.slug}`);
    const copy = lang === "en" ? memberProfileEn.memberProfile : memberProfilePl.memberProfile;
    const title = `${copy.metaTitle} - ${SITE_NAME}`;
    return {
      meta: [
        { title },
        { name: "description", content: copy.metaDescription },
        { name: "robots", content: "noindex, nofollow" },
        { property: "og:title", content: title },
        { property: "og:description", content: copy.metaDescription },
        { property: "og:type", content: "profile" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: MemberProfilePage,
});

function MemberProfilePage() {
  ensureI18n();
  const { t } = useTranslation();
  return (
    <main className="container mx-auto px-4 py-8">
      <AuthGate fallbackTitle={t("memberProfile.gateTitle")} fallbackBody={t("memberProfile.gateBody")}>
        <MemberProfileBody />
      </AuthGate>
    </main>
  );
}

function MemberProfileBody() {
  const { slug } = Route.useParams();
  const { user } = useAuth();
  const { t } = useTranslation();
  const lang = currentLang() === "en" ? "en" : "pl";
  const query = useQuery(memberProfileQueryOptions(slug, user?.id ?? null));

  if (query.isPending) {
    return <p className="py-12 text-center text-sm text-muted-foreground">{t("memberProfile.loading")}</p>;
  }
  if (query.isError) {
    return (
      <div className="py-12 text-center text-sm">
        <p className="text-muted-foreground">{t("memberProfile.error")}</p>
        <button type="button" onClick={() => void query.refetch()} className="mt-3 text-primary underline">
          {t("memberProfile.retry")}
        </button>
      </div>
    );
  }
  if (query.data === null) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <h1 className="text-xl font-semibold text-foreground">{t("memberProfile.notFoundTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("memberProfile.notFoundBody")}</p>
        <Link to="/people" className="mt-4 inline-block text-sm text-primary underline">
          {t("memberProfile.backToPeople")}
        </Link>
      </div>
    );
  }
  return <MemberProfileView profile={query.data} lang={lang} />;
}
