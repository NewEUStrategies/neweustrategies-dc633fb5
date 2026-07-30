// /admin/versions - przegląd i zarządzanie wersjami polityk, bannera zgód
// oraz elementów buildera, wraz z podglądem każdej wersji.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { History } from "lucide-react";

import { VersionsPane } from "@/components/admin/versions/VersionsPane";

export const Route = createFileRoute("/admin/versions")({
  component: AdminVersionsPage,
  head: () => ({
    meta: [
      { title: "Wersje polityk i widgetów | Panel New European Strategies" },
      {
        name: "description",
        content:
          "Przegląd, podgląd i publikacja wersji regulaminu, polityk, bannera zgód oraz widgetów i popupów.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function AdminVersionsPage() {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
          <History className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-lg font-semibold">{L("Wersje", "Versions")}</h1>
          <p className="text-[0.8125rem] text-muted-foreground">
            {L(
              "Historia polityk, bannera zgód i elementów buildera z podglądem każdej wersji.",
              "History of policies, the consent banner and builder items with a preview of every version.",
            )}
          </p>
        </div>
      </header>

      <VersionsPane />
    </div>
  );
}
