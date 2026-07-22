// Metadane UI segmentów odbiorców: mapa ikon (zamknięty katalog slugów
// lucide wybieranych w panelu) oraz identyfikatory ARIA tab/tabpanel.
// Osobny plik (bez komponentów) - czysty fast-refresh i wspólny import
// dla strony /pricing i panelu admina.
import {
  Building2,
  GraduationCap,
  Landmark,
  Sparkles,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";

const AUDIENCE_ICONS: Record<string, LucideIcon> = {
  user: User,
  users: Users,
  "building-2": Building2,
  "graduation-cap": GraduationCap,
  landmark: Landmark,
  sparkles: Sparkles,
};

/** Ikona segmentu po slugu; nieznany slug dostaje neutralny fallback. */
export function audienceIcon(slug: string): LucideIcon {
  return AUDIENCE_ICONS[slug] ?? Sparkles;
}

export function audiencePanelId(key: string): string {
  return `pricing-audience-panel-${key}`;
}

export function audienceTabId(key: string): string {
  return `pricing-audience-tab-${key}`;
}
