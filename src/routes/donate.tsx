// Publiczna strona darowizn: /donate
// Nasz własny checkout (Stripe Embedded) zamiast wychodzenia na zewnętrzną
// zbiórkę. Po powrocie z płatności Stripe dokleja `?status=thanks` - wtedy
// zamiast formularza pokazujemy podziękowanie.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CheckCircle2, HandHeart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppLink } from "@/components/atoms/AppLink";
import { DonationForm } from "@/components/donations/DonationForm";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";
import { ensureI18n as ensureDonateI18n } from "@/lib/i18n-donate";

export const Route = createFileRoute("/donate")({
  validateSearch: (search: Record<string, unknown>): { status?: string } => ({
    status: typeof search.status === "string" ? search.status.slice(0, 32) : undefined,
  }),
  component: DonatePage,
  head: () => {
    const url = getRequestUrl() || "/donate";
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "website",
      title:
        lang === "en" ? "Donate - New European Strategies" : "Darowizna - New European Strategies",
      description:
        lang === "en"
          ? "Support independent European policy analysis with a one-off or monthly gift."
          : "Wesprzyj niezależną analizę polityk europejskich wpłatą jednorazową lub miesięczną.",
    });
  },
});

function DonatePage() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-donate.ts.
  ensureDonateI18n();
  const { t } = useTranslation();
  const { status } = Route.useSearch();

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      {status === "thanks" ? (
        <section className="text-center">
          <CheckCircle2 className="mx-auto mb-4 h-10 w-10 text-primary" aria-hidden />
          <h1 className="font-display text-2xl">{t("donate.thanksTitle")}</h1>
          <p className="mt-2 text-muted-foreground">{t("donate.thanksBody")}</p>
          <Button asChild className="mt-6">
            <AppLink href="/">{t("donate.backHome")}</AppLink>
          </Button>
        </section>
      ) : (
        <>
          <header className="mb-8">
            <p className="mb-2 inline-flex items-center gap-2 text-sm text-muted-foreground">
              <HandHeart className="h-4 w-4" aria-hidden />
              {t("donate.subtitle")}
            </p>
            <h1 className="font-display text-3xl">{t("donate.title")}</h1>
          </header>
          <DonationForm />
        </>
      )}
    </main>
  );
}
