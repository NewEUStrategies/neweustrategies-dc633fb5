// Meta SEO (tytuł + lead) dokumentów prawnych - JEDYNE, czego potrzebuje
// `head()` tras /polityka-prywatnosci, /regulamin i /zwroty-i-reklamacje.
//
// PO CO OSOBNY MODUŁ. `head()` jest funkcją EAGER w drzewie tras (route
// splitter wynosi tylko `component:`), a wspólna stała czytana przez head()
// I komponent ląduje w module `?tsr-shared`, który jedzie w chunku wejściowym
// KAŻDEJ strony. Trzy pełne treści dokumentów (privacy 14 kB + terms 14 kB +
// refunds 8 kB źródeł) podróżowały tak do każdego czytelnika, choć head()
// czyta z nich wyłącznie te dwa pola. Ten sam wzorzec co lib/clubs/applyHead.ts.
//
// JEDNO ŹRÓDŁO PRAWDY: pliki treści w ./content/* importują te stałe i
// wpinają je w swoje obiekty (spread), więc meta nie może się rozjechać
// z treścią. Zależność biegnie treść -> meta (nigdy odwrotnie), dzięki czemu
// meta pozostaje tanie i wolne od pełnych dokumentów.
import { LEGAL_ENTITY, REFUND_WINDOW_DAYS } from "@/lib/legal/entity";

export interface LegalDocMeta {
  title: string;
  lead: string;
}

export const PRIVACY_META: Record<"pl" | "en", LegalDocMeta> = {
  pl: {
    title: "Polityka prywatności",
    lead: `Wyjaśniamy, jakie dane osobowe przetwarza ${LEGAL_ENTITY}, na jakiej podstawie prawnej, komu je powierzamy i jakie prawa Ci przysługują.`,
  },
  en: {
    title: "Privacy notice",
    lead: `We explain what personal data ${LEGAL_ENTITY} processes, on what legal basis, who we share it with and what rights you have.`,
  },
};

export const TERMS_META: Record<"pl" | "en", LegalDocMeta> = {
  pl: {
    title: "Regulamin serwisu",
    lead: `Warunki korzystania z serwisu neweuropeanstrategies.com prowadzonego przez ${LEGAL_ENTITY} - zakres usług, płatności, prawa i obowiązki stron.`,
  },
  en: {
    title: "Terms and conditions",
    lead: `Terms of use for neweuropeanstrategies.com operated by ${LEGAL_ENTITY} - scope of the service, payments, rights and obligations.`,
  },
};

export const REFUNDS_META: Record<"pl" | "en", LegalDocMeta> = {
  pl: {
    title: "Polityka zwrotów i reklamacji",
    lead: `Gwarancja zwrotu pieniędzy przez ${REFUND_WINDOW_DAYS} dni od zakupu - bez ukrytych warunków. Poniżej wyjaśniamy, jak złożyć wniosek i kiedy otrzymasz środki.`,
  },
  en: {
    title: "Refund policy",
    lead: `A ${REFUND_WINDOW_DAYS}-day money-back guarantee with no hidden conditions. Below we explain how to request a refund and when you get your money back.`,
  },
};
