import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowRight, ChevronLeft, ChevronRight, Flame } from "@/lib/lucide-shim";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { NewsletterForm } from "@/components/NewsletterForm";
import { SectionLabel } from "@/components/SectionLabel";
import { ArticleCard } from "@/components/ArticleCard";
import { CategoryTag } from "@/components/CategoryTag";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { parseBuilderDoc } from "@/lib/builder/parse";
import { homePageQueryOptions } from "@/lib/queries/public";

import imgMilitary from "@/assets/report-military.jpg";
import imgGeo from "@/assets/geopolitics.jpg";
import imgEmpire from "@/assets/history-empire.jpg";
import imgDollar from "@/assets/finance-dollar.jpg";
import imgYalta from "@/assets/history-yalta.jpg";
import imgGeneral from "@/assets/interview-general.jpg";
import imgMinister from "@/assets/interview-minister.jpg";
import imgBook from "@/assets/book-review.jpg";

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(homePageQueryOptions());
    return null;
  },
  head: () => ({
    meta: [
      { title: "New European Strategies - Strategic thinking, new perspectives" },
      { name: "description", content: "Think-tank o europejskim bezpieczeństwie, geopolityce i grze mocarstw. Analizy, raporty, wywiady i policy papers." },
      { property: "og:title", content: "New European Strategies" },
      { property: "og:description", content: "Strategic thinking, new perspectives. European security, geopolitics, great-power rivalry." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Index,
});

function Index() {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const { data: homePage } = useSuspenseQuery(homePageQueryOptions());

  // If a CMS page with slug "home" exists and uses the builder with content,
  // render it. Otherwise fall back to the hardcoded landing layout below.
  if (homePage && homePage.editor === "builder") {
    const doc = parseBuilderDoc(homePage.builder_data);
    if (doc.sections.length > 0) {
      return (
        <div className="min-h-screen flex flex-col bg-background text-foreground">
          <Header />
          <main className="flex-1 w-full">
            <BuilderRenderer doc={doc} lang={lang} />
          </main>
          <Footer />
        </div>
      );
    }
  }

  return <IndexFallback />;
}

function IndexFallback() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Header />

      {/* Hot topic banner */}
      <div className="border-b border-border bg-muted/40">
        <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-3 flex items-center gap-4 text-sm">
          <span className="inline-flex items-center gap-2 bg-brand text-brand-foreground font-bold px-3 py-1 rounded text-xs uppercase tracking-wider">
            <Flame className="w-3.5 h-3.5" /> {t("hero.hotTopic")}
          </span>
          <p className="truncate flex-1">{t("articles.a3t")}</p>
          <ArrowRight className="w-4 h-4 text-brand shrink-0" />
        </div>
      </div>

      {/* Hero 3-col layout */}
      <section className="max-w-[1400px] mx-auto w-full px-4 lg:px-8 py-10 grid lg:grid-cols-[1fr_2fr_1fr] gap-10">
        {/* LEFT: Latest report + upcoming events */}
        <aside className="space-y-10">
          <div>
            <SectionLabel label={t("sections.latestReport")} action={t("sections.more")} />
            <ArticleCard
              image={imgMilitary}
              category={{ label: t("cats.reports"), color: "military" }}
              title={t("articles.a1t")}
              excerpt={t("articles.a1d")}
              author="Igor Miasnikow"
              readTime={`18 ${t("hero.minRead")}`}
            />
          </div>

          <div>
            <SectionLabel label={t("sections.upcomingEvents")} action={t("sections.more")} />
            <div className="space-y-5">
              <ArticleCard horizontal size="sm" image={imgGeneral} title={t("articles.a5t")} />
              <ArticleCard horizontal size="sm" image={imgMinister} title={t("articles.a4t")} />
            </div>
          </div>
        </aside>

        {/* CENTER: Featured article */}
        <div className="flex flex-col items-center text-center justify-center py-10 border-y lg:border-y-0 lg:border-x border-border lg:px-10">
          <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold leading-[1.05] max-w-2xl">
            {t("articles.a2t")}
          </h1>
          <p className="mt-6 text-muted-foreground max-w-lg leading-relaxed">
            {t("articles.a2d")}
          </p>
          <div className="mt-6 flex items-center gap-4 text-sm text-muted-foreground">
            <span>{t("hero.by")} <span className="text-foreground font-semibold">Igor Miasnikow</span></span>
            <span>·</span>
            <span>14 {t("hero.minRead")}</span>
          </div>
          <img
            src={imgGeo}
            alt={t("articles.a2t")}
            className="mt-8 w-full max-w-xl aspect-[16/10] object-cover rounded"
            width={1024}
            height={640}
          />
        </div>

        {/* RIGHT: Expert opinions */}
        <aside>
          <SectionLabel label={t("sections.expertOpinion")} action={t("sections.more")} />
          <ol className="space-y-7">
            {[
              { n: "01", t: t("articles.a3t"), d: t("articles.a3d"), rating: 8.3 },
              { n: "02", t: t("articles.a4t") },
              { n: "03", t: t("articles.a5t") },
            ].map((item) => (
              <li key={item.n} className="relative">
                <span className="absolute -top-2 right-0 font-display text-5xl font-bold text-foreground/5 select-none">
                  {item.n}
                </span>
                <h3 className="text-lg font-bold leading-snug pr-12 hover:text-brand cursor-pointer">
                  {item.t}
                </h3>
                {item.d && (
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-3">{item.d}</p>
                )}
                {item.rating && (
                  <div className="mt-3 flex items-center gap-2">
                    <div className="flex h-2 w-24 overflow-hidden rounded-full">
                      {[0,1,2,3,4].map((i) => (
                        <div key={i} className="flex-1" style={{ backgroundColor: ["#ef4444","#f97316","#facc15","#a3e635","#22c55e"][i] }} />
                      ))}
                    </div>
                    <span className="text-xs font-semibold">{item.rating} <span className="text-muted-foreground">{t("sections.outOf")}</span></span>
                  </div>
                )}
                <p className="mt-2 text-xs text-muted-foreground">{t("hero.by")} <span className="font-semibold text-foreground/80">Igor Miasnikow</span></p>
              </li>
            ))}
          </ol>
        </aside>
      </section>

      {/* Interviews | Reports two-column */}
      <section className="max-w-[1400px] mx-auto w-full px-4 lg:px-8 py-12 grid lg:grid-cols-2 gap-12 border-t border-border">
        <div>
          <h2 className="text-center font-display text-2xl font-bold mb-6 pb-4 border-b-2 border-brand">
            {t("sections.interviewsPodcasts")}
          </h2>
          <div className="relative bg-[oklch(0.18_0.02_260)] text-white p-6 rounded">
            <div className="inline-block bg-destructive text-white text-xs font-bold px-3 py-1 mb-3">
              GEOPOLITYCZNA GRA MOCARSTW
            </div>
            <img src={imgGeneral} alt="" className="w-full h-72 object-cover rounded" loading="lazy" width={1024} height={640} />
            <h3 className="mt-4 font-display text-2xl font-bold">{t("articles.a11t")}</h3>
            <p className="text-sm text-white/70 mt-2">{t("articles.a11d")}</p>
          </div>
        </div>

        <div>
          <h2 className="text-center font-display text-2xl font-bold mb-6 pb-4 border-b-2 border-brand">
            {t("sections.ourReports")}
          </h2>
          <div className="space-y-8">
            <div className="grid grid-cols-[1fr_auto] gap-4 items-start">
              <div>
                <CategoryTag label={t("cats.reports")} color="military" />
                <h3 className="mt-2 text-lg font-bold leading-snug">{t("articles.a1t")}</h3>
                <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{t("articles.a1d")}</p>
              </div>
              <img src={imgMilitary} alt="" className="w-40 h-28 object-cover rounded" loading="lazy" width={1024} height={640} />
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-4 items-start">
              <div>
                <div className="flex gap-2"><CategoryTag label={t("cats.history")} color="diplomacy" /><CategoryTag label={t("cats.policyPapers")} color="neutral" /></div>
                <h3 className="mt-2 text-lg font-bold leading-snug">{t("articles.a10t")}</h3>
                <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{t("articles.a10d")}</p>
              </div>
              <img src={imgEmpire} alt="" className="w-40 h-28 object-cover rounded" loading="lazy" width={1024} height={640} />
            </div>
          </div>
        </div>
      </section>

      {/* Military & Geopolitics carousel */}
      <section className="max-w-[1400px] mx-auto w-full px-4 lg:px-8 py-12">
        <SectionLabel label={t("sections.militaryGeo")} color="military" action={t("sections.seeMore")} />
        <div className="grid lg:grid-cols-[1fr_1fr_1fr] gap-8">
          <ArticleCard
            image={imgGeo}
            category={{ label: t("cats.geopolitics"), color: "military" }}
            title={t("articles.a6t")}
            excerpt={t("articles.a6d")}
            author="Igor Miasnikow"
            readTime={`14 ${t("hero.minRead")}`}
          />
          <ArticleCard
            image={imgMilitary}
            category={{ label: t("cats.reports"), color: "military" }}
            title={t("articles.a1t")}
            author="Igor Miasnikow"
            readTime={`18 ${t("hero.minRead")}`}
          />
          <div className="space-y-6">
            <ArticleCard horizontal size="sm" image={imgEmpire} title={t("articles.a10t")} category={{ label: t("cats.history"), color: "diplomacy" }} />
            <ArticleCard horizontal size="sm" image={imgYalta} title={t("articles.a9t")} category={{ label: t("cats.history"), color: "diplomacy" }} />
          </div>
        </div>
        <div className="flex justify-center gap-4 mt-8 text-muted-foreground">
          <button className="p-2 hover:text-brand"><ChevronLeft className="w-4 h-4" /></button>
          {[0,1,2,3,4].map((i) => (
            <span key={i} className={`w-2 h-2 rounded-full ${i === 0 ? "bg-brand" : "bg-border"}`} />
          ))}
          <button className="p-2 hover:text-brand"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </section>

      {/* Finance + Book reviews */}
      <section className="max-w-[1400px] mx-auto w-full px-4 lg:px-8 py-12 grid lg:grid-cols-[2fr_1fr] gap-12">
        <div>
          <SectionLabel label={t("sections.financeEconomy")} color="finance" action={t("sections.seeMore")} />
          <div className="grid md:grid-cols-3 gap-8">
            <ArticleCard image={imgEmpire} category={{ label: t("cats.history"), color: "finance" }} title={t("articles.a7t")} />
            <ArticleCard image={imgDollar} category={{ label: t("cats.economy"), color: "finance" }} title={t("articles.a8t")} excerpt={t("articles.a8d")} />
            <ArticleCard image={imgYalta} category={{ label: t("cats.europe"), color: "finance" }} title={t("articles.a9t")} />
          </div>
        </div>
        <div>
          <h2 className="text-center font-display text-2xl font-bold mb-6 pb-4 border-b-2 border-brand">
            {t("sections.bookReviews")}
          </h2>
          <ArticleCard
            image={imgBook}
            category={{ label: t("cats.book"), color: "brand" }}
            title={t("articles.a3t")}
            excerpt={t("articles.a3d")}
            author="Igor Miasnikow"
            rating={8.3}
          />
        </div>
      </section>

      {/* Empty category sections */}
      <section className="max-w-[1400px] mx-auto w-full px-4 lg:px-8 py-12 grid lg:grid-cols-3 gap-8">
        <div>
          <SectionLabel label={t("sections.transportEnergy")} color="transport" action={t("sections.seeMore")} />
          <p className="text-sm text-muted-foreground">- Coming soon -</p>
        </div>
        <div>
          <SectionLabel label={t("sections.diplomacy")} color="diplomacy" action={t("sections.seeMore")} />
          <p className="text-sm text-muted-foreground">- Coming soon -</p>
        </div>
        <div>
          <SectionLabel label={t("sections.cybersecurity")} color="cyber" action={t("sections.seeMore")} />
          <p className="text-sm text-muted-foreground">- Coming soon -</p>
        </div>
      </section>

      <NewsletterForm />

      {/* Partner content */}
      <section className="max-w-[1400px] mx-auto w-full px-4 lg:px-8 py-16">
        <div className="text-center mb-10">
          <h2 className="font-display text-3xl font-bold flex items-center justify-center gap-4">
            <span className="h-px w-12 bg-brand" />
            {t("sections.partnerContent")}
            <span className="h-px w-12 bg-brand" />
          </h2>
          <p className="text-sm text-muted-foreground mt-2">{t("sections.partnerSub")}</p>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          <ArticleCard image={imgBook} category={{ label: t("cats.book"), color: "neutral" }} title={t("articles.a3t")} rating={8.3} author="Igor Miasnikow" />
          <ArticleCard image={imgMinister} category={{ label: t("cats.interviews"), color: "brand" }} title={t("articles.a4t")} author="Igor Miasnikow" />
          <ArticleCard image={imgGeneral} category={{ label: t("cats.interviews"), color: "brand" }} title={t("articles.a5t")} author="Igor Miasnikow" />
        </div>
      </section>

      <Footer />
    </div>
  );
}
