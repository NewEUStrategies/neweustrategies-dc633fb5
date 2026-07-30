// Organizm nadrzędny sekcji "Wersje": polityki, banner zgód i elementy
// buildera w jednym miejscu, z podglądem tego, co zobaczy odwiedzający.
import { useState } from "react";
import { useAdminLang } from "@/lib/builder/labelsEn";
import { Button } from "@/components/ui/button";
import { PolicyVersionsPane } from "./organisms/PolicyVersionsPane";
import { CookieVersionsPane } from "./organisms/CookieVersionsPane";
import { BuilderVersionsPane } from "./organisms/BuilderVersionsPane";

type Tab = "policies" | "cookies" | "builder";

export function VersionsPane() {
  const lang = useAdminLang();
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const [tab, setTab] = useState<Tab>("policies");

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: "policies", label: L("Polityki i regulamin", "Policies & terms") },
    { id: "cookies", label: L("Banner cookies i zgody", "Cookie banner & consent") },
    { id: "builder", label: L("Widgety i popupy", "Widgets & popups") },
  ];

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-2" aria-label={L("Sekcje wersji", "Version sections")}>
        {TABS.map((t) => (
          <Button
            key={t.id}
            size="sm"
            variant={t.id === tab ? "default" : "outline"}
            aria-pressed={t.id === tab}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </nav>

      {tab === "policies" ? <PolicyVersionsPane lang={lang} /> : null}
      {tab === "cookies" ? <CookieVersionsPane lang={lang} /> : null}
      {tab === "builder" ? <BuilderVersionsPane lang={lang} /> : null}
    </div>
  );
}
