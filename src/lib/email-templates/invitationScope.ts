// Zakres obietnicy w mailu zaproszenia.
//
// PRZYCZYNA. Jedno zdanie („Aktywuj je, aby korzystać z analiz, klubów
// dyskusyjnych i wydarzeń") szło do KAŻDEGO zaproszonego - także do zwykłego
// użytkownika, który klubów dyskusyjnych nie ma w swoim dostępie. Mail obiecywał
// wtedy coś, czego konto po aktywacji nie daje.
//
// Reguła: pełne brzmienie należy się redakcji (rola inna niż `user`) oraz
// planom od PRO w górę. Poniżej PRO odbiorca dostaje zakres, który faktycznie
// ma: analizy, raporty, quizy i wydarzenia.
import { BILLING_CATALOG } from "@/lib/billing/catalog";
import type { EmailLang } from "./nes-layout";

/** Ranga planu PRO w katalogu - próg pełnego zakresu obietnicy. */
export const PRO_TIER_RANK = 40;

export type InvitationScope = "full" | "basic";

/** Ranga planu po kluczu katalogowym (`pro`, `member`, ...). 0 gdy nieznany. */
export function tierRankByKey(tierKey: string | null | undefined): number {
  if (!tierKey) return 0;
  const ranks = BILLING_CATALOG.filter((entry) => entry.tierKey === tierKey).map(
    (entry) => entry.rank,
  );
  return ranks.length > 0 ? Math.max(...ranks) : 0;
}

/** Ranga planu po identyfikatorze ceny u operatora płatności. */
export function tierRankByPriceId(priceId: string | null | undefined): number {
  if (!priceId) return 0;
  const entry = BILLING_CATALOG.find((item) => item.priceId === priceId);
  return entry?.rank ?? 0;
}

export function invitationScope(input: {
  role: string | null | undefined;
  tierRank?: number | null;
}): InvitationScope {
  const role = (input.role ?? "user").trim().toLowerCase();
  if (role && role !== "user") return "full";
  return (input.tierRank ?? 0) >= PRO_TIER_RANK ? "full" : "basic";
}

const INTRO: Record<InvitationScope, Record<EmailLang, string>> = {
  full: {
    pl: "Przygotowaliśmy dla Ciebie konto na platformie New European Strategies. Aktywuj je, aby korzystać z analiz, klubów dyskusyjnych i wydarzeń.",
    en: "We have prepared an account for you on the New European Strategies platform. Activate it to access our analysis, discussion clubs and events.",
  },
  basic: {
    pl: "Przygotowaliśmy dla Ciebie konto na platformie New European Strategies. Aktywuj je, aby korzystać z analiz, raportów, quizów i wydarzeń.",
    en: "We have prepared an account for you on the New European Strategies platform. Activate it to access our analysis, reports, quizzes and events.",
  },
};

export function invitationIntro(scope: InvitationScope, lang: EmailLang): string {
  return INTRO[scope][lang === "en" ? "en" : "pl"];
}
