// Mapowanie statusów domenowych na tony pigułek. Czysty moduł - żeby test
// dowodził reguły „cofnięty = negatywny" bez montowania tabeli.
import type { GiftLinkStatus, GrantStatus } from "@/lib/admin/monetization/model";
import type { LedgerTone } from "./LedgerStatusPill";

export function grantTone(status: GrantStatus): LedgerTone {
  if (status === "active") return "positive";
  if (status === "revoked") return "negative";
  if (status === "scheduled") return "warning";
  return "neutral";
}

export function giftLinkTone(status: GiftLinkStatus): LedgerTone {
  if (status === "active") return "positive";
  if (status === "revoked") return "negative";
  if (status === "exhausted") return "warning";
  return "neutral";
}

export function donationTone(status: string): LedgerTone {
  if (status === "paid") return "positive";
  if (status === "pending" || status === "processing") return "warning";
  if (status === "failed" || status === "refunded" || status === "canceled") return "negative";
  return "neutral";
}
