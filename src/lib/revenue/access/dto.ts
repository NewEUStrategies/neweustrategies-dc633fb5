// KSZTAŁT INWENTARZA DOSTĘPU HUBA „PRZYCHÓD I LEJEK" (S3, kontrakt §5.2).
//
// MODUŁ CZYSTO TYPOWY - zero wartości w runtime. Inwentarz nie ma kwot, więc
// admin i editor dostają ten sam wynik (SPEC §2.5: Dostęp - pełny dla obu).
import type { PaywallHitReason } from "@/lib/revenue/limits";

/** Tryb reguły `content_access.mode`. */
export type AccessInventoryMode = "public" | "members" | "paid" | "password";
/** Polityka licznika `content_access.metering_policy`. */
export type AccessInventoryPolicy = "inherit" | "metered" | "exempt";
/** Typ treści z regułą (`access_entity_type`). */
export type AccessInventoryEntity = "post" | "page" | "media";

/** Jedna komórka: typ × tryb × próg rangi × polityka licznika. */
export interface AccessInventoryRow {
  entityType: AccessInventoryEntity;
  mode: AccessInventoryMode;
  minTierRank: number;
  meteringPolicy: AccessInventoryPolicy;
  count: number;
}

/** Warstwa najemcy i to, czy da się ją dziś kupić. */
export interface AccessInventoryTier {
  key: string;
  rank: number;
  active: boolean;
  pricingVisible: boolean;
  /** `auto` | `contact` | `none` (`tierCtaMode`); `null` = brak ustawienia. */
  ctaMode: string | null;
  /** Aktywny plan w sprzedaży + widoczna w cenniku + przycisk kasy. */
  offerable: boolean;
}

/** Ślepe zaułki i ryzyka polityki dostępu (P14, P19, plany spoza sprzedaży). */
export interface AccessInventoryDeadEnds {
  /** Próg warstwy, której nie da się kupić (zalogowany za nisko bez oferty). */
  tierWithoutOffer: number;
  /** Treść płatna bez progu, ceny jednorazowej i planu w sprzedaży. */
  paidWithoutOffer: number;
  /** Reguły wskazujące plan nieaktywny, wycofany albo usunięty. */
  danglingPlans: number;
  /** Treści z progiem objęte licznikiem - P19 wyłącza z nich licznik. */
  meteredTierGated: number;
}

export interface AccessInventoryHits {
  reason: PaywallHitReason;
  accounts: number;
  visitors: number;
  hits: number;
}

export interface AccessInventoryDto {
  computedAt: string;
  total: number;
  rows: AccessInventoryRow[];
  byMode: Record<AccessInventoryMode, number>;
  tiers: AccessInventoryTier[];
  deadEnds: AccessInventoryDeadEnds;
  /** Powody uderzeń w paywall z ostatnich 30 dni. */
  hits30d: AccessInventoryHits[];
}

export type AccessInventoryRead =
  | { state: "ready"; inventory: AccessInventoryDto }
  /** 42501 - rola bez dostępu do inwentarza (autor). */
  | { state: "forbidden" }
  /** Funkcji jeszcze nie ma w bazie (migracja w drodze). */
  | { state: "unavailable" };
