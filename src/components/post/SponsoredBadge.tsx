// Skrócone oznaczenie komercyjne do LIST i pasków meta (karta na stronie
// głównej, archiwum, wyniki wyszukiwania, pasek nad tytułem artykułu).
//
// PO CO OSOBNE OZNACZENIE, JEŚLI ARTYKUŁ MA JUŻ PEŁNY PASEK. Bo obowiązek
// dotyczy TAKŻE momentu wypisu, nie tylko strony docelowej: UPNPR art. 7 pkt 11a
// (za dyr. 2019/2161, zał. I pkt 11a dyr. 2005/29/WE) obejmuje płatne wyniki
// prezentowane w zestawieniach. Czytelnik przeglądający listę podejmuje decyzję
// „klikam / nie klikam" WTEDY - jeśli dowie się o odpłatności dopiero po
// kliknięciu, informacja przyszła za późno (art. 7 ust. 2: „w sposób nieczasowy").
//
// Skróty są pełnymi słowami („Reklama", nie „Rekl."/„#ad") - Rekomendacje UOKiK
// (2022) wprost odrzucają formy nieoczywiste, a ograniczenie miejsca w karcie nie
// jest podstawą do złagodzenia oznaczenia.
import { useTranslation } from "react-i18next";
import { resolveDisclosure, type SponsoredDisclosureInput } from "@/lib/content/sponsored";
import "@/lib/i18n-sponsored";

export function SponsoredBadge({
  post,
  lang,
  className,
}: {
  post: SponsoredDisclosureInput;
  /** Język materiału. Przypina brzmienie oznaczenia - patrz SponsoredDisclosure. */
  lang?: "pl" | "en";
  className?: string;
}) {
  const { t: translate } = useTranslation();
  const t = (key: string): string => (lang ? translate(key, { lng: lang }) : translate(key));
  const disclosure = resolveDisclosure(post);
  if (!disclosure.required) return null;

  // Sponsoring wyprzedza afiliację: gdy oba są włączone, w liście liczy się
  // mocniejsza relacja. Pełne ujawnienie obu czytelnik dostaje na stronie wpisu.
  const label = disclosure.kind ? (
    <>
      {disclosure.kind === "advertisement" && t("sponsored.badge.advertisement")}
      {disclosure.kind === "sponsored" && t("sponsored.badge.sponsored")}
      {disclosure.kind === "partner" && t("sponsored.badge.partner")}
      {disclosure.kind === "barter" && t("sponsored.badge.barter")}
      {disclosure.kind === "self_promo" && t("sponsored.badge.self_promo")}
    </>
  ) : (
    t("sponsored.affiliate.label")
  );

  return (
    <span
      data-sponsored-badge={disclosure.kind ?? "affiliate"}
      className={`sponsor-label inline-flex items-center rounded border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${className ?? ""}`}
    >
      {label}
    </span>
  );
}
