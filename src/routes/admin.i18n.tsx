// /admin/i18n - audyt tłumaczeń treści widgetów (PL -> EN).
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";

import { WidgetI18nAuditPane } from "@/components/admin/i18n/WidgetI18nAuditPane";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { SITE_NAME } from "@/lib/seo/meta";

export const Route = createFileRoute("/admin/i18n")({
  component: AdminI18nAuditPage,
  head: () => {
    // head() biegnie POZA drzewem Reacta i poza dostawcą i18next, więc `t()` tu
    // nie istnieje - język bierzemy z adresu przez `activeLang`. Trasy /admin są
    // w NON_LOCALIZED_PREFIXES, więc w praktyce rozstrzyga ciasteczko języka; to
    // jednak ta sama wartość, którą widzi ciało strony, a o zgodność karty
    // przeglądarki z interfejsem tu właśnie chodzi.
    const lang = activeLang(getRequestUrl() || "/admin/i18n");
    return {
      meta: [
        {
          title:
            lang === "en"
              ? `Widget translation audit | ${SITE_NAME} panel`
              : `Audyt tłumaczeń widgetów | Panel ${SITE_NAME}`,
        },
        {
          name: "description",
          content:
            lang === "en"
              ? "Widgets rendering Polish content on /en pages: missing translation, EN identical to PL, or a placeholder value."
              : "Lista widgetów, które renderują polską treść na stronach /en: brak tłumaczenia, EN identyczne z PL lub wartość szablonowa.",
        },
        { name: "robots", content: "noindex, nofollow" },
      ],
    };
  },
});

function AdminI18nAuditPage() {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
          <Languages className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-lg font-semibold">
            {L("Audyt tłumaczeń widgetów", "Widget translation audit")}
          </h1>
          <p className="text-[0.8125rem] text-muted-foreground">
            {L(
              "Widgety, które na wersji angielskiej pokażą polską treść lub tekst szablonowy.",
              "Widgets that render Polish or template copy on the English version.",
            )}
          </p>
        </div>
      </header>

      <WidgetI18nAuditPane />
    </div>
  );
}
