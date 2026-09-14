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
import { LEGAL_ENTITY, LEGAL_ENTITY_FULL, REFUND_WINDOW_DAYS } from "@/lib/legal/entity";

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

// --- Pakiet zgodności 2026-09 -----------------------------------------------
// Ten sam kontrakt co wyżej: `head()` tras czyta WYŁĄCZNIE te stałe, więc pełna
// treść dokumentu (kilkanaście kB na sztukę) nie wchodzi do chunku wejściowego.

export const RODO_META: Record<"pl" | "en", LegalDocMeta> = {
  pl: {
    title: "RODO - Twoje prawa",
    lead: `Skrócona instrukcja obsługi RODO w ${LEGAL_ENTITY}: jakie prawa Ci przysługują, jak z nich skorzystać, w jakim terminie odpowiadamy i gdzie złożyć skargę.`,
  },
  en: {
    title: "GDPR - your rights",
    lead: `A practical guide to the GDPR at ${LEGAL_ENTITY}: what rights you have, how to exercise them, how fast we respond and where to lodge a complaint.`,
  },
};

export const PRIVACY_GOVERNANCE_META: Record<"pl" | "en", LegalDocMeta> = {
  pl: {
    title: "Zarządzanie polityką prywatności",
    lead: `Jak ${LEGAL_ENTITY} tworzy, wersjonuje i zmienia polityki prywatności - kto za nie odpowiada, jak ogłaszamy zmiany i gdzie samodzielnie zarządzasz swoimi ustawieniami.`,
  },
  en: {
    title: "Privacy policy governance",
    lead: `How ${LEGAL_ENTITY} writes, versions and changes its privacy policies - who owns them, how we announce changes and where you manage your own settings.`,
  },
};

export const DATA_PROCESSING_META: Record<"pl" | "en", LegalDocMeta> = {
  pl: {
    title: "Polityka przetwarzania danych",
    lead: `Warstwa operacyjna ochrony danych w ${LEGAL_ENTITY}: rejestr czynności, podmioty przetwarzające, okresy retencji, transfery poza EOG i środki bezpieczeństwa.`,
  },
  en: {
    title: "Data processing policy",
    lead: `The operational layer of data protection at ${LEGAL_ENTITY}: records of processing, processors, retention periods, transfers outside the EEA and security measures.`,
  },
};

export const COMMUNICATIONS_META: Record<"pl" | "en", LegalDocMeta> = {
  pl: {
    title: "Komunikacja i marketing",
    lead: `Zasady newslettera, powiadomień i komunikacji marketingowej ${LEGAL_ENTITY} - jakie zgody zbieramy, czym różni się wiadomość transakcyjna od marketingowej i jak zrezygnować.`,
  },
  en: {
    title: "Communications and marketing",
    lead: `How ${LEGAL_ENTITY} runs its newsletter, notifications and marketing - what consents we collect, how transactional messages differ from marketing and how to opt out.`,
  },
};

export const CLUBS_META: Record<"pl" | "en", LegalDocMeta> = {
  pl: {
    title: "Regulamin klubów dyskusyjnych",
    lead: `Zasady udziału w klubach dyskusyjnych ${LEGAL_ENTITY}: rekrutacja, reguła Chatham House, poufność, wypowiedzi anonimowe i moderacja.`,
  },
  en: {
    title: "Discussion club rules",
    lead: `Rules for taking part in ${LEGAL_ENTITY} discussion clubs: admission, the Chatham House Rule, confidentiality, anonymous contributions and moderation.`,
  },
};

export const MODERATION_META: Record<"pl" | "en", LegalDocMeta> = {
  pl: {
    title: "Moderacja komentarzy i treści",
    lead: `Zasady moderacji w ${LEGAL_ENTITY} zgodne z aktem o usługach cyfrowych (DSA): co usuwamy, jak zgłosić treść, jak uzasadniamy decyzje i jak się od nich odwołać.`,
  },
  en: {
    title: "Comment and content moderation",
    lead: `${LEGAL_ENTITY} moderation rules under the Digital Services Act (DSA): what we remove, how to report content, how we justify decisions and how to appeal them.`,
  },
};

export const EVENTS_META: Record<"pl" | "en", LegalDocMeta> = {
  pl: {
    title: "Wydarzenia, bilety i skanowanie",
    lead: `Warunki udziału w wydarzeniach ${LEGAL_ENTITY}: rejestracja i bilety, identyfikatory QR, kontrola wejścia, skanowanie na stoiskach partnerów, nagrania i odwołanie udziału.`,
  },
  en: {
    title: "Events, tickets and scanning",
    lead: `Terms for attending ${LEGAL_ENTITY} events: registration and tickets, QR badges, access control, scanning at partner booths, recordings and cancellation.`,
  },
};

export const AI_TRANSPARENCY_META: Record<"pl" | "en", LegalDocMeta> = {
  pl: {
    title: "Sztuczna inteligencja i przejrzystość",
    lead: `Gdzie ${LEGAL_ENTITY} używa sztucznej inteligencji, jak to oznaczamy i czego nigdy nie oddajemy maszynie - zgodnie z art. 50 aktu o sztucznej inteligencji (AI Act), stosowanym od 2 sierpnia 2026 r.`,
  },
  en: {
    title: "Artificial intelligence and transparency",
    lead: `Where ${LEGAL_ENTITY} uses artificial intelligence, how we label it and what we never hand over to a machine - under Article 50 of the AI Act, applicable since 2 August 2026.`,
  },
};

export const SUBSCRIPTIONS_META: Record<"pl" | "en", LegalDocMeta> = {
  pl: {
    title: "Subskrypcje, zakupy i płatności",
    lead: `Warunki handlowe ${LEGAL_ENTITY}: plany i okresy rozliczeniowe, odnowienia, bilety i zakupy jednorazowe, faktury, prawo odstąpienia i rezygnacja.`,
  },
  en: {
    title: "Subscriptions, purchases and payments",
    lead: `The commercial terms of ${LEGAL_ENTITY}: plans and billing periods, renewals, tickets and one-off purchases, invoices, the right of withdrawal and cancellation.`,
  },
};

export const STATUTE_META: Record<"pl" | "en", LegalDocMeta> = {
  pl: {
    title: "Statut i dane rejestrowe",
    lead: `${LEGAL_ENTITY_FULL} - cele statutowe, organy, majątek i pełne dane rejestrowe wydawcy serwisu neweuropeanstrategies.com.`,
  },
  en: {
    title: "Statute and registration details",
    lead: `${LEGAL_ENTITY_FULL} - statutory objectives, governing bodies, assets and the full registration details of the publisher of neweuropeanstrategies.com.`,
  },
};
