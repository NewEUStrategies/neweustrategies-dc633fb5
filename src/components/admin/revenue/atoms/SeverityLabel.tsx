// Atom: waga diagnozy - IKONA + SŁOWO, nigdy sam kolor (WCAG 1.4.1, SPEC §6.8).
//
// Trzy wagi mają trzy RÓŻNE kształty ikon (kółko z krzyżykiem, trójkąt,
// kółko z „i"), więc odróżnia je także osoba, która nie widzi kolorów albo
// patrzy na wydruk w skali szarości. Słowo stoi zawsze - ikona jest dekoracją
// (`aria-hidden`), a czytnik ogłasza samą wagę.
//
// KOLORY Z TOKENÓW, GEOMETRIA WSPÓLNA DLA OBU MOTYWÓW. Ostrzeżenie używa pary
// `text-brand-ink dark:text-brand` (ta sama co „opóźnienie" w `HeartbeatDot`),
// bo czysty kolor marki na jasnym tle nie ma kontrastu tekstu.
import { AlertTriangle, Info, XCircle, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { RevenueSeverity } from "@/lib/admin/revenue/hubTabs";
import { ensureI18n } from "@/lib/i18n-admin-revenue-shell";
import { cn } from "@/lib/utils";

const ICON: Readonly<Record<RevenueSeverity, LucideIcon>> = {
  critical: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const TONE: Readonly<Record<RevenueSeverity, string>> = {
  critical: "text-destructive",
  warning: "text-brand-ink dark:text-brand",
  info: "text-muted-foreground",
};

const LABEL_KEY: Readonly<Record<RevenueSeverity, string>> = {
  critical: "adminRevenue.severity.critical",
  warning: "adminRevenue.severity.warning",
  info: "adminRevenue.severity.info",
};

export interface SeverityLabelProps {
  severity: RevenueSeverity;
  className?: string;
}

export function SeverityLabel({ severity, className }: SeverityLabelProps) {
  ensureI18n();
  const { t } = useTranslation();
  const Icon = ICON[severity];
  return (
    <span
      data-severity={severity}
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        TONE[severity],
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {t(LABEL_KEY[severity])}
    </span>
  );
}
