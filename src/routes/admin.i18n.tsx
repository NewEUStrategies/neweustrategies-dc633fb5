// /admin/i18n - audyt tłumaczeń treści widgetów (PL -> EN).
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";

import { WidgetI18nAuditPane } from "@/components/admin/i18n/WidgetI18nAuditPane";
import { ensureI18n as ensureWidgetAuditI18n } from "@/lib/i18n-admin-widget-audit";
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
    //
    // Słownika panelu (`adminWidgetI18nAudit.*`) tu celowo NIE czytamy:
    // `head()` zostaje w shellu trasy, a import nakładki na tym poziomie
    // wciągnąłby ją do paczki wejściowej (ta sama decyzja co
    // `admin.settings.cookie-banner.tsx`). Że tytuł karty zaczyna się od
    // `adminWidgetI18nAudit.title`, przypina `adminI18nRoute.test.tsx`.
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
  // Rejestracja nakładki w komponencie (nie na poziomie modułu) - słownik
  // jedzie chunkiem trasy panelu, nie shellem z `head()`. Nagłówek i panel
  // niżej czytają ten sam słownik tym samym `t()`, więc nie mogą wybrać
  // różnych języków.
  ensureWidgetAuditI18n();
  const { t } = useTranslation();

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
          <Languages className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-lg font-semibold">{t("adminWidgetI18nAudit.title")}</h1>
          <p className="text-[0.8125rem] text-muted-foreground">{t("adminWidgetI18nAudit.lead")}</p>
        </div>
      </header>

      <WidgetI18nAuditPane />
    </div>
  );
}
