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
}: {
  body: string;
  className?: string;
  /** `sm` dla odpowiedzi (gęstsza lista), `base` dla postu otwierającego. */
  size?: "sm" | "base";
}) {
  const paragraphs = splitParagraphs(body);
  if (paragraphs.length === 0) return null;

  return (
    <div
      className={cn(
        "club-prose max-w-[72ch] text-foreground/90",
        size === "base" ? "space-y-3.5 text-[15px] leading-7" : "space-y-2.5 text-sm leading-6",
        className,
      )}
      data-testid="club-prose"
    >
      {paragraphs.map((paragraph, index) => (
        <p
          key={index}
          className={cn(
            "whitespace-pre-wrap break-words [text-wrap:pretty]",
            isLeadIn(paragraph) ? "font-medium text-foreground" : null,
          )}
        >
          {paragraph}
        </p>
      ))}
    </div>
  );
}
