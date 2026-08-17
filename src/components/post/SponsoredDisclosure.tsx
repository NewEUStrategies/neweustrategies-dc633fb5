// Pasek ujawnienia komercyjnego nad treścią artykułu.
//
// WYMAGANIA, KTÓRE KSZTAŁTUJĄ TEN KOMPONENT (nie są to preferencje stylistyczne):
//
//   * Prawo prasowe art. 36 ust. 3 - oznaczenie „w sposób nie budzący
//     wątpliwości, iż nie stanowi materiału redakcyjnego". Stąd pasek stoi NAD
//     treścią, w pierwszym ekranie, z widoczną ramką i wersalikami - nie w stopce
//     i nie jako drobny dopisek pod tekstem.
//   * UPNPR art. 7 pkt 11 / dyr. 2005/29/WE zał. I pkt 11 - oznaczenie musi być
//     „w treści" i rozpoznawalne przez konsumenta BEZ INTERAKCJI. Stąd nie ma tu
//     <details>, „pokaż więcej" ani tooltipa: cały tekst jest w DOM od razu i
//     renderuje się serwerowo (SSR), więc widzi go też czytelnik bez JS i crawler.
//   * Rekomendacje UOKiK (2022) - reguła dwuczęściowa (CO + KTO) i zakaz skrótów.
//     Stąd zawsze etykieta + zdanie z nazwą reklamodawcy.
//   * uśude art. 9 ust. 1 pkt 1 - adres elektroniczny zlecającego jest elementem
//     oznaczenia, dlatego link do reklamodawcy jest częścią paska, nie dodatkiem.
//   * rozp. (UE) 2024/900 art. 11 ust. 1 - reklama polityczna dostaje WŁASNY,
//     wyodrębniony blok (informacja, że to reklama polityczna + proces + podmiot
//     kontrolujący sponsora), bo to inny obowiązek niż zwykłe ujawnienie.
//
// CZEGO TU CELOWO NIE MA: przejścia przez `allowAd()` / budżet reklamowy. Pasek
// ujawnienia NIE jest reklamą i nie może zniknąć, bo skończył się budżet slotów
// albo czytelnik włączył tryb czytania - to by zamieniło zgodny materiał w
// kryptoreklamę jednym przełącznikiem ustawień.
import { useTranslation } from "react-i18next";
import { Megaphone } from "lucide-react";
import { resolveDisclosure, type SponsoredDisclosureInput } from "@/lib/content/sponsored";
import "@/lib/i18n-sponsored";

export function SponsoredDisclosure({
  post,
  lang,
  className,
}: {
  post: SponsoredDisclosureInput;
  lang: "pl" | "en";
  className?: string;
}) {
  const { t: translate } = useTranslation();
  // JĘZYK ETYKIETY PRZYPINAMY DO JĘZYKA MATERIAŁU, nie do stanu interfejsu.
  // Rekomendacje UOKiK wymagają oznaczenia w języku odbiorcy, a `i18n.language`
  // to stan otoczenia: przy renderze serwerowym potrafi jeszcze nie odpowiadać
  // prefiksowi z URL-a, a wtedy angielska strona dostałaby polską etykietę.
  // `lng` zamyka tę furtkę - to samo `lang`, z którego bierzemy wersję treści.
  const t = (key: string, opts?: Record<string, unknown>): string =>
    translate(key, { lng: lang, ...opts });
  const disclosure = resolveDisclosure(post);
  if (!disclosure.required) return null;

  const note = lang === "en" ? post.sponsored_note_en : post.sponsored_note_pl;
  const trimmedNote = (note ?? "").trim();

  return (
    <aside
      // `role="note"` + aria-label: czytnik ekranu ogłasza, czym jest ten blok,
      // zanim przeczyta etykietę - inaczej „MATERIAŁ REKLAMOWY" brzmi jak
      // śródtytuł artykułu.
      role="note"
      aria-label={t("sponsored.regionLabel")}
      data-sponsored-disclosure={disclosure.kind ?? "affiliate"}
      className={`not-prose mb-5 rounded-md border border-border bg-muted/50 px-4 py-3 ${className ?? ""}`}
    >
      {disclosure.kind && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Megaphone className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-muted-foreground" />
          {/* `sponsor-label` to istniejący, tematyzowalny token globalnych kolorów
              (Kokpit → Kolory globalne → „Sponsor Label"). Do tej pory nie miał
              ani jednego konsumenta - etykieta ujawnienia jest dokładnie tym,
              do czego był przewidziany. */}
          <span className="sponsor-label text-[11px] font-semibold uppercase tracking-[0.08em]">
            {disclosure.kind === "advertisement" && t("sponsored.label.advertisement")}
            {disclosure.kind === "sponsored" && t("sponsored.label.sponsored")}
            {disclosure.kind === "partner" && t("sponsored.label.partner")}
            {disclosure.kind === "barter" && t("sponsored.label.barter")}
            {disclosure.kind === "self_promo" && t("sponsored.label.self_promo")}
          </span>
        </div>
      )}

      <div className="mt-1 space-y-1 text-[12.5px] leading-relaxed text-foreground/90">
        {disclosure.kind &&
          (disclosure.advertiser ? (
            <p>
              {disclosure.kind === "advertisement" &&
                t("sponsored.body.advertisement", { advertiser: disclosure.advertiser })}
              {disclosure.kind === "sponsored" &&
                t("sponsored.body.sponsored", { advertiser: disclosure.advertiser })}
              {disclosure.kind === "partner" &&
                t("sponsored.body.partner", { advertiser: disclosure.advertiser })}
              {disclosure.kind === "barter" &&
                t("sponsored.body.barter", { advertiser: disclosure.advertiser })}
              {disclosure.kind === "self_promo" &&
                t("sponsored.body.self_promo", { advertiser: disclosure.advertiser })}
            </p>
          ) : (
            <p>{t("sponsored.bodyUnnamed")}</p>
          ))}

        {/* DSA art. 26 ust. 1 lit. c - płatnik, gdy inny niż reklamodawca. */}
        {disclosure.payer && <p>{t("sponsored.payer", { payer: disclosure.payer })}</p>}

        {disclosure.political && (
          <div className="mt-1.5 border-t border-border/70 pt-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em]">
              {t("sponsored.political.label")}
            </p>
            <p>{t("sponsored.political.body")}</p>
            {disclosure.politicalProcess && (
              <p>{t("sponsored.political.process", { process: disclosure.politicalProcess })}</p>
            )}
            {disclosure.sponsorController && (
              <p>
                {t("sponsored.political.controller", { controller: disclosure.sponsorController })}
              </p>
            )}
          </div>
        )}

        {trimmedNote && <p className="text-muted-foreground">{trimmedNote}</p>}

        {disclosure.advertiserUrl && (
          <p>
            <a
              href={disclosure.advertiserUrl}
              // rel="sponsored" - wytyczna Google dla linków opłaconych; nofollow
              // dokłada się, bo link reklamodawcy nie jest rekomendacją redakcji.
              rel="sponsored nofollow noopener noreferrer"
              target="_blank"
              className="underline underline-offset-2 hover:no-underline"
            >
              {t("sponsored.advertiserLink")}
            </a>
          </p>
        )}

        {/* Afiliacja jest ortogonalna: materiał redakcyjny z linkami
            afiliacyjnymi też wymaga ujawnienia (dyr. 2005/29/WE art. 7 ust. 2),
            więc ta linia potrafi stać samodzielnie, bez bloku sponsoringu. */}
        {disclosure.affiliate && (
          <p className={disclosure.kind ? "border-t border-border/70 pt-1.5" : undefined}>
            <span className="sponsor-label mr-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]">
              {t("sponsored.affiliate.label")}
            </span>
            {t("sponsored.affiliate.body")}
          </p>
        )}
      </div>
    </aside>
  );
}
