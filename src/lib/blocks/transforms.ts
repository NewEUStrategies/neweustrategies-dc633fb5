// Transformacje bloków „Przekształć w …" (zachowanie WordPress Gutenberg):
// akapit ↔ nagłówek ↔ lista ↔ cytat ↔ kod itd. z zachowaniem treści.
// Czysty moduł (bez DOM) - transformacja to funkcja Block -> Block[].
//
// TABELA -> WYKRES (PR2). Zakres z Excela wklejony na kanwę bez zaznaczonego
// wykresu staje się blokiem tabeli; „Przekształć w wykres" robi z niego
// wykres tą samą drogą co import pliku (`tableToChartData`: rozpoznanie
// nagłówka, orientacji i konwencji liczb). Tabela -> mapa danych świadomie
// NIE istnieje: mapa rozwiązuje nazwy krajów skorowidzem zasobu geometrii,
// który dociąga się asynchronicznie, a transformacja jest synchroniczna.

import type { Block, BlockType, Json } from "./types";
import { newBlockId } from "./types";
import { escapeInlineText } from "./inlineHtml";
import { BLOCK_SPECS } from "./registry";
import { tableToChartData } from "@/lib/charts/importTable";
import type { ImportProblem } from "@/lib/charts/importTable";

/** Rodzina tekstowa - tylko między tymi typami oferujemy przekształcenia. */
const TEXT_FAMILY: readonly BlockType[] = [
  "paragraph",
  "heading",
  "list",
  "quote",
  "pullquote",
  "code",
  "preformatted",
  "verse",
  "callout",
  "details",
  "html",
];

const strip = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Tekst źródłowy bloku - wspólny punkt wyjścia dla większości transformacji. */
function sourceText(block: Block): string {
  switch (block.type) {
    case "paragraph":
    case "html":
      return strip(String(block.data.html ?? ""));
    case "heading":
      return strip(String(block.data.text ?? ""));
    case "list": {
      const items = Array.isArray(block.data.items) ? (block.data.items as Json[]) : [];
      return items.map((i) => strip(String(i))).join("\n");
    }
    case "quote":
    case "pullquote":
    case "callout":
    case "verse":
      return strip(String(block.data.text ?? ""));
    case "preformatted":
      return String(block.data.text ?? "");
    case "code":
      return String(block.data.code ?? "");
    case "details":
      return [strip(String(block.data.summary ?? "")), strip(String(block.data.body ?? ""))]
        .filter(Boolean)
        .join("\n");
    default:
      return "";
  }
}

/** HTML inline bloku - zachowuje pogrubienia/linki tam, gdzie cel je przyjmie. */
function sourceInlineHtml(block: Block): string {
  switch (block.type) {
    case "paragraph":
    case "html":
      return String(block.data.html ?? "").replace(/^<p[^>]*>|<\/p>\s*$/gi, "");
    case "heading":
      return String(block.data.text ?? "");
    default:
      return escapeInlineText(sourceText(block)).replace(/\n/g, "<br>");
  }
}

const textLines = (block: Block): string[] =>
  sourceText(block)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** Komórki bloku tabeli jako napisy (blok trzyma tekst komórek, nie HTML). */
function tableRows(block: Block): string[][] {
  const raw = Array.isArray(block.data.rows) ? block.data.rows : [];
  return raw.map((row) =>
    Array.isArray(row)
      ? row.map((cell) =>
          typeof cell === "string" ? cell : typeof cell === "number" ? String(cell) : "",
        )
      : [],
  );
}

/**
 * Tabela -> wykres. Ustawienia wykresu to DOMYŚLNE z rejestru (jedno źródło
 * z blokiem wstawianym z menu), dane - z tabeli. Flaga nagłówka tabeli jest
 * rozstrzygnięciem autora; bez niej nagłówek rozpoznaje `analyseTable`.
 *
 * TABELA BEZ LICZB NIE STAJE SIĘ WYKRESEM (`null`). Do tej poprawki tabela
 * samego tekstu zamieniała się w pusty wykres, a jej komórki ginęły bez
 * słowa; teraz tabela zostaje nietknięta. Menu „Przekształć w" liczy cele
 * po TYPIE bloku (pamięć podręczna kanwy), więc pozycji nie da się tu ukryć
 * dla jednej tabeli - komunikat o odmowie i o problemach odczytu (obcięcie
 * do limitów, komórki nieliczbowe) należy do kanwy (`BlockCanvas`).
 */
function tableChartData(block: Block): ReturnType<typeof tableToChartData> {
  return tableToChartData(tableRows(block), {
    header: block.data.header === true ? true : undefined,
  });
}

/**
 * Uwagi odczytu tabeli przy przekształceniu w wykres (obcięcie do limitów,
 * komórki nieliczbowe, nagłówek przyjęty) - kanwa pokazuje je po udanym
 * przekształceniu, tymi samymi zdaniami co import pliku.
 */
export function tableToChartProblems(block: Block): ImportProblem[] {
  return block.type === "table" ? tableChartData(block).problems : [];
}

function tableToChart(block: Block): Block | null {
  const dane = tableChartData(block);
  const maLiczbe = dane.series.some((s) =>
    s.values.some((v) => typeof v === "number" && Number.isFinite(v)),
  );
  if (!maLiczbe) return null;
  const base = BLOCK_SPECS.chart.create();
  return {
    ...base,
    data: {
      ...base.data,
      categories: dane.categories,
      series: dane.series.map((s) => ({
        name: s.name,
        values: s.values.map((v) => (v === null || v === undefined ? null : v)),
        colorSlot: s.colorSlot,
      })),
    },
  };
}

/** Buduje blok docelowy z treści źródła. `null` = transformacja nieobsługiwana. */
export function transformBlock(block: Block, to: BlockType): Block[] | null {
  if (block.type === to) return null;
  if (block.type === "table") {
    const chart = to === "chart" ? tableToChart(block) : null;
    return chart === null ? null : [chart];
  }
  const text = sourceText(block);
  const inline = sourceInlineHtml(block);

  switch (to) {
    case "paragraph": {
      // Lista -> osobny akapit z każdej pozycji (jak w Gutenbergu).
      if (block.type === "list") {
        const items = Array.isArray(block.data.items) ? (block.data.items as Json[]) : [];
        const blocks = items
          .map((i) => String(i))
          .filter((s) => strip(s).length > 0)
          .map((s) => ({ id: newBlockId(), type: "paragraph" as const, data: { html: s } }));
        return blocks.length
          ? blocks
          : [{ id: newBlockId(), type: "paragraph", data: { html: "" } }];
      }
      return [
        {
          id: newBlockId(),
          type: "paragraph",
          data: { html: inline || escapeInlineText(text).replace(/\n/g, "<br>") },
        },
      ];
    }
    case "heading":
      return [
        {
          id: newBlockId(),
          type: "heading",
          data: {
            level: block.type === "heading" ? Number(block.data.level ?? 2) : 2,
            text: inline,
            anchor: "",
          },
        },
      ];
    case "list": {
      const lines = textLines(block);
      return [
        {
          id: newBlockId(),
          type: "list",
          data: { ordered: false, items: (lines.length ? lines : [""]) as Json },
        },
      ];
    }
    case "quote":
    case "pullquote":
      return [
        {
          id: newBlockId(),
          type: to,
          data: {
            text,
            cite: String(
              (block.data.cite as string | undefined) ??
                (to === "quote" || to === "pullquote" ? "" : ""),
            ),
          },
        },
      ];
    case "code":
      return [{ id: newBlockId(), type: "code", data: { lang: "", code: text } }];
    case "preformatted":
    case "verse":
      return [{ id: newBlockId(), type: to, data: { text } }];
    case "callout":
      return [{ id: newBlockId(), type: "callout", data: { variant: "info", text } }];
    case "details": {
      const [first, ...rest] = textLines(block);
      return [
        {
          id: newBlockId(),
          type: "details",
          data: { summary: first ?? "", body: rest.join("\n") },
        },
      ];
    }
    case "html":
      return [
        {
          id: newBlockId(),
          type: "html",
          data: { html: inline ? `<p>${inline}</p>` : `<p>${escapeInlineText(text)}</p>` },
        },
      ];
    default:
      return null;
  }
}

/** Lista typów, na które da się przekształcić dany blok (menu „Przekształć w"). */
export function getTransformTargets(block: Block): BlockType[] {
  if (block.type === "table") return ["chart"];
  if (!TEXT_FAMILY.includes(block.type)) return [];
  return TEXT_FAMILY.filter((t) => t !== block.type);
}
