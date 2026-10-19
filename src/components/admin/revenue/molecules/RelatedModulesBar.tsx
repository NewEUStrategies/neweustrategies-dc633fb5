// Molekuła: skoki do modułów, które hub tylko czyta (paywall, cennik,
// członkostwo, kupony, rozliczenia, CRM, newsletter, automatyzacje, BI).
//
// WYGLĄD JAK W CENNIKU (`AdminPricingWorkspace`, nagłówek): napis „Powiązane
// moduły" i obrysowane przyciski `h-7`. Ten sam pasek w kilku modułach
// monetyzacji uczy admina jednego wzorca przechodzenia między nimi; od I9
// Cennik dostaje TEN komponent zamiast własnej kopii (SPEC §2.7).
//
// BEZ IKON. Kontrakt pozycji to `{ to, search?, labelKey }`, a lista ikon
// huba jest zamknięta (SPEC §6.8) - nazwa modułu słowem wystarcza i nie
// dokłada do bundla ikon spoza grafu.
//
// `<nav>` Z NAZWĄ: to drugi (obok paska zakładek) zestaw odnośników na
// ekranie, więc czytnik musi je rozróżniać po etykiecie punktu orientacyjnego.
// Napis „Powiązane moduły" jest widoczny, ale `aria-hidden` - nazwę landmarku
// niesie `aria-label`, inaczej czytnik przeczytałby ją dwa razy.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { RelatedModule } from "@/lib/admin/revenue/hubTabs";
import { ensureI18n } from "@/lib/i18n-admin-revenue-shell";
import { cn } from "@/lib/utils";

export interface RelatedModulesBarProps {
  items: readonly RelatedModule[];
  className?: string;
}

export function RelatedModulesBar({ items, className }: RelatedModulesBarProps) {
  ensureI18n();
  const { t } = useTranslation();
  if (items.length === 0) return null;
  const heading = t("adminRevenue.related.heading");

  return (
    <nav aria-label={heading} className={cn("flex flex-wrap items-center gap-2", className)}>
      <span aria-hidden="true" className="text-xs text-muted-foreground">
        {heading}
      </span>
      {items.map((item) => (
        <Button key={item.labelKey} asChild size="sm" variant="outline" className="h-7">
          <Link to={item.to} search={item.search}>
            {t(item.labelKey)}
          </Link>
        </Button>
      ))}
    </nav>
  );
}
