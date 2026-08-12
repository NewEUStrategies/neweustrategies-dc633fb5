// Atom: typografia treści klubowej (post otwierający wątku i odpowiedzi).
//
// PO CO. Do tej pory treść wątku szła na ekran jako jeden `whitespace-pre-wrap`
// blok na całą szerokość karty. Przy dwóch akapitach to jeszcze uchodzi, przy
// ośmiu - już nie: linie mają ~140 znaków, akapity nie mają odstępu, a wersaliki
// ("PO PIERWSZE:") zlewają się z resztą w ścianę tekstu. Deliberacja to najdłuższe
// teksty w całym produkcie i to one najbardziej potrzebują miary wiersza.
//
// TRZY DECYZJE:
//
// 1) MIARA WIERSZA. `max-w-[72ch]` - typograficzne optimum czytania to 60-80
//    znaków; karta wątku jest szeroka, bo mieści belkę i panele, ale TEKST nie
//    ma prawa się do niej rozciągać.
//
// 2) AKAPIT JEST JEDNOSTKĄ, nie znakiem nowej linii. Rozbijamy treść na akapity
//    (`splitParagraphs`) i renderujemy `<p>` z odstępem, zachowując pojedyncze
//    złamania wewnątrz akapitu. Dzięki temu odstęp jest stały i niezależny od
//    tego, ile pustych linii ktoś wstukał.
//
// 3) TREŚĆ POZOSTAJE TEKSTEM. Zero `dangerouslySetInnerHTML` - wpisy pochodzą
//    od użytkowników, a wyróżnienia robimy klasami na węzłach, nie parsowaniem
//    HTML-a.
import { cn } from "@/lib/utils";
import { parseProseBlocks } from "@/lib/clubs/proseBlocks";
import { ClubInlineText } from "@/components/clubs/atoms/ClubInlineText";

/**
 * Rozbija surowy tekst wpisu na akapity. Pusta linia (lub kilka) rozdziela;
 * pojedyncze złamania zostają wewnątrz akapitu, bo autor zwykle łamie tam
 * wyliczenie, a nie myśl.
 */
export function splitParagraphs(body: string): string[] {
  return body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Akapit będący samym wołaczem porządkującym ("PO PIERWSZE:", "WNIOSEK:")
 * dostaje wyróżnienie: to śródtytuł, który autor napisał wersalikami, bo nie
 * miał do dyspozycji nagłówka.
 */
export function isLeadIn(paragraph: string): boolean {
  if (paragraph.length > 64 || !paragraph.includes(":")) return false;
  const head = paragraph.slice(0, paragraph.indexOf(":")).trim();
  if (head.length === 0 || head.length > 48) return false;
  return head === head.toLocaleUpperCase("pl-PL") && /\p{L}/u.test(head);
}

export function ClubProse({
  body,
  className,
  size = "base",
  clubSlug = null,
}: {
  body: string;
  className?: string;
  /** Kontekst klubu - włącza #tagi jako filtr strumienia tego klubu. */
  clubSlug?: string | null;
  /** `sm` dla odpowiedzi (gęstsza lista), `base` dla postu otwierającego. */
  size?: "sm" | "base";
}) {
  const blocks = parseProseBlocks(body);
  if (blocks.length === 0) return null;
  const dense = size === "sm";

  return (
    <div
      className={cn(
        "club-prose max-w-[72ch] text-foreground/90",
        dense ? "space-y-2.5 text-sm leading-6" : "space-y-3.5 text-[15px] leading-7",
        className,
      )}
      data-testid="club-prose"
    >
      {blocks.map((block, index) => {
        if (block.kind === "paragraph") {
          return (
            <p
              key={index}
              className={cn(
                "whitespace-pre-wrap break-words [text-wrap:pretty]",
                isLeadIn(block.text) ? "font-medium text-foreground" : null,
              )}
            >
              <ClubInlineText body={block.text} clubSlug={clubSlug} />
            </p>
          );
        }

        if (block.kind === "ordered") {
          return (
            <ol
              key={index}
              data-testid="club-prose-ordered"
              className={cn("list-none", dense ? "space-y-1.5" : "space-y-2")}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex gap-2.5 break-words [text-wrap:pretty]">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 inline-flex shrink-0 items-center justify-center rounded-md",
                      "bg-primary/12 font-semibold tabular-nums text-primary",
                      dense ? "h-[18px] min-w-[18px] px-1 text-[11px]" : "h-5 min-w-5 px-1 text-xs",
                    )}
                  >
                    {block.start + itemIndex}
                  </span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap">
                    <ClubInlineText body={item} clubSlug={clubSlug} />
                  </span>
                </li>
              ))}
            </ol>
          );
        }

        return (
          <ul
            key={index}
            data-testid="club-prose-bullet"
            className={cn("list-none", dense ? "space-y-1.5" : "space-y-2")}
          >
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} className="flex gap-2.5 break-words [text-wrap:pretty]">
                <span
                  aria-hidden="true"
                  className={cn(
                    "shrink-0 rounded-full bg-primary/60",
                    dense ? "mt-[9px] h-1.5 w-1.5" : "mt-[11px] h-1.5 w-1.5",
                  )}
                />
                <span className="min-w-0 flex-1 whitespace-pre-wrap">
                  <ClubInlineText body={item} clubSlug={clubSlug} />
                </span>
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}
