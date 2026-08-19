// Reguły projektowania wpisu pod zero-click (SERP / AI Overview / feed) razem
// z czystym analizatorem, który mierzy KONKRETNY wpis względem tych reguł.
//
// Po co osobny moduł: budżety (40-70 słów leadu, <=60 słów odpowiedzi FAQ,
// 3-5 punktów „Dowiesz się…") muszą być JEDNĄ liczbą dla ściągawki w edytorze
// i dla checklisty stanu wpisu. Rozjazd między „co mówimy redaktorowi" a „co
// sprawdzamy" jest gorszy niż brak sprawdzenia: redaktor traci zaufanie do
// panelu i przestaje go czytać.
//
// Moduł jest czysty i bez zależności od Reacta - wejściem jest treść wpisu
// (HTML lub drzewo bloków) + punkty kluczowe, wyjściem lista pomiarów.
// Warstwa maszynowa (JSON-LD `abstract`, `speakable`, FAQPage) powstaje gdzie
// indziej (lib/seo/meta.ts, components/blocks/FaqBlockView.tsx) - tu pilnujemy
// tego, czego żaden schema nie naprawi: KSZTAŁTU tekstu.
import { collectHeadings } from "@/lib/seo/headingValidation";

/** Budżety liczbowe reguł. Jedno źródło prawdy dla ściągawki i checklisty. */
export const ZERO_CLICK_BUDGETS = {
  /** Akapit definicyjny: dolna granica, poniżej której nie ma czego wyciąć. */
  leadWordsMin: 40,
  /** Górna granica - powyżej niej Google i tak przytnie fragment. */
  leadWordsMax: 70,
  /** Udział nagłówków H2/H3 w formie pytania, od którego uznajemy strukturę
   *  za „pod ekstrakcję". 40%, nie 100%: wpis analityczny ma prawo mieć też
   *  nagłówki narracyjne. */
  questionHeadingsRatioMin: 0.4,
  /** Odpowiedź w FAQ: powyżej tego progu przestaje być cytowalna w PAA. */
  faqAnswerWordsMax: 60,
  /** Punkty „Dowiesz się…" - zasilają `abstract` w JSON-LD. */
  takeawaysMin: 3,
  takeawaysMax: 5,
  /** Minimalna liczba nagłówków H2/H3, przy której liczenie udziału pytań ma
   *  sens statystyczny (przy jednym nagłówku „50%" nic nie znaczy). */
  headingsForRatio: 2,
} as const;

export type ZeroClickCheckId =
  | "lead"
  | "questionHeadings"
  | "faq"
  | "faqAnswerLength"
  | "takeaways"
  | "scannable";

/**
 * `ok` - reguła spełniona. `warn` - jest, ale poza budżetem (do poprawy).
 * `todo` - elementu w ogóle nie ma. Rozróżnienie jest istotne, bo „brak FAQ"
 * i „FAQ z rozwlekłymi odpowiedziami" to dwie różne prace redakcyjne.
 */
export type ZeroClickStatus = "ok" | "warn" | "todo";

/**
 * Powód uwagi. Sam status nie wystarcza: „lead za krótki" i „lead zaczyna się
 * rozbiegówką" to ten sam `warn`, a zupełnie inna poprawka. Warstwa i18n mapuje
 * `reason` na komunikat - bez zgadywania po obecności `snippet`.
 */
export type ZeroClickReason =
  | "filler"
  | "short"
  | "long"
  | "few"
  | "many"
  | "tooFewHeadings"
  | "prose";

export interface ZeroClickCheck {
  id: ZeroClickCheckId;
  status: ZeroClickStatus;
  reason?: ZeroClickReason;
  /** Zmierzona wartość (słowa leadu, liczba pytań, liczba punktów…). */
  value?: number;
  /** Wartość odniesienia dla komunikatu (np. liczba wszystkich H2/H3). */
  total?: number;
  /** Fragment treści, której dotyczy uwaga (nagłówek, początek odpowiedzi). */
  snippet?: string;
}

export interface ZeroClickReport {
  checks: ZeroClickCheck[];
  /** Liczba reguł ze statusem `ok`. */
  passed: number;
  /** Liczba reguł ogółem (stabilna - checks zawsze ma komplet). */
  total: number;
}

export interface ZeroClickInput {
  /** Treść w HTML (edytor klasyczny). */
  html?: string | null;
  /** Drzewo bloków dla jednego języka - wygrywa nad `html`, gdy niepuste. */
  blocks?: unknown;
  /** Punkty „Dowiesz się…" dla tego samego języka. */
  takeaways?: readonly string[] | null;
}

/**
 * Otwarcia-rozbiegówki. Akapit zaczynający się od „W dzisiejszych czasach…"
 * nie odpowiada na pytanie, więc wyszukiwarka nie ma czego podnieść do
 * snippetu - traci się najcenniejsze zdanie wpisu.
 */
const FILLER_OPENERS: readonly RegExp[] = [
  /^w\s+(dzisiejszych\s+czasach|dzisiejszym\s+świecie|obecnych\s+czasach)/i,
  /^w\s+(dobie|erze)\s+/i,
  /^(coraz\s+(więcej|częściej)|nie\s+od\s+dziś)/i,
  /^(żyjemy|świat\s+się\s+zmienia)/i,
  /^in\s+(today'?s|the\s+modern)\s+/i,
  /^(nowadays|these\s+days|in\s+recent\s+years|it'?s\s+no\s+secret)/i,
];

/** Nagłówki-pytania bez znaku zapytania: „Jak działa X", „Czym jest Y". */
const QUESTION_STARTERS: readonly RegExp[] = [
  /^(co|czym|czemu|cóż)\b/i,
  /^(jak|jakie?|jaki|jaką|jakim|jakich)\b/i,
  /^(dlaczego|czemu)\b/i,
  /^(kiedy|odkąd|dopóki)\b/i,
  /^(gdzie|dokąd|skąd)\b/i,
  /^(ile|ilu)\b/i,
  /^(czy)\b/i,
  /^(kto|kogo|komu)\b/i,
  /^(który|która|które|którego|której)\b/i,
  /^(po\s+co|na\s+czym|z\s+czego|w\s+czym|dla\s+kogo)\b/i,
  /^(what|how|why|when|where|who|which|whose)\b/i,
  /^(is|are|does|do|can|should|will)\b/i,
];

/** Nagłówki sekcji FAQ rozpoznawane w treści pisanej „z ręki". */
const FAQ_HEADING_RE =
  /(najczęściej\s+zadawane|najczęstsze\s+pytania|pytania\s+i\s+odpowiedzi|\bfaq\b|frequently\s+asked|common\s+questions|\bq\s*&\s*a\b)/i;

function stripTags(input: string): string {
  return input
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Liczba słów tekstu (po zdjęciu znaczników). Puste = 0. */
export function countWords(input: string | null | undefined): number {
  const text = stripTags(input ?? "");
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function snippet(text: string, max = 60): string {
  const clean = stripTags(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > 20 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Czy nagłówek jest w formie pytania (znak zapytania LUB zaimek pytajny). */
export function isQuestionHeading(text: string | null | undefined): boolean {
  const clean = stripTags(text ?? "");
  if (!clean) return false;
  if (clean.endsWith("?")) return true;
  return QUESTION_STARTERS.some((re) => re.test(clean));
}

/** Czy akapit startuje rozbiegówką zamiast odpowiedzi. */
export function startsWithFiller(text: string | null | undefined): boolean {
  const clean = stripTags(text ?? "");
  if (!clean) return false;
  return FILLER_OPENERS.some((re) => re.test(clean));
}

interface FaqItem {
  q: string;
  a: string;
}

interface ExtractedContent {
  /** Akapity w kolejności dokumentu (tekst bez znaczników). */
  paragraphs: string[];
  /** Pary FAQ z bloków `faq`. */
  faqItems: FaqItem[];
  /** Czy w treści jest jakakolwiek lista punktowana/numerowana. */
  hasList: boolean;
  /** Czy treść ma nagłówek sekcji FAQ (poza blokiem `faq`). */
  hasFaqHeading: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

/** Wyciąga akapity, listy i pary FAQ z drzewa bloków (BlocksDoc lub tablica). */
function fromBlocks(blocks: unknown): ExtractedContent {
  const out: ExtractedContent = {
    paragraphs: [],
    faqItems: [],
    hasList: false,
    hasFaqHeading: false,
  };
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!isRecord(node)) return;
    const rawType = node.type ?? node.blockName ?? node.name;
    const type = typeof rawType === "string" ? rawType.toLowerCase() : "";
    const data = isRecord(node.data) ? node.data : isRecord(node.props) ? node.props : node;

    if (type === "paragraph" || type === "core/paragraph") {
      const text = stripTags(readString(data, ["html", "text", "content"]));
      if (text) out.paragraphs.push(text);
    } else if (type === "list" || type === "core/list") {
      const items = data.items;
      if (Array.isArray(items) ? items.some((i) => stripTags(String(i ?? "")).length > 0) : false) {
        out.hasList = true;
      }
    } else if (type === "faq") {
      const items = data.items;
      if (Array.isArray(items)) {
        for (const item of items) {
          if (!isRecord(item)) continue;
          const q = stripTags(readString(item, ["q", "question"]));
          const a = stripTags(readString(item, ["a", "answer"]));
          if (q && a) out.faqItems.push({ q, a });
        }
      }
    } else if (type.includes("heading") || type === "header" || type === "core/heading") {
      const text = stripTags(readString(data, ["text", "content", "title"]));
      if (FAQ_HEADING_RE.test(text)) out.hasFaqHeading = true;
    }

    for (const key of Object.keys(node)) {
      const child = node[key];
      if (child && typeof child === "object") visit(child);
    }
  };
  visit(blocks);
  return out;
}

/** To samo z HTML-a edytora klasycznego. */
function fromHtml(html: string): ExtractedContent {
  const out: ExtractedContent = {
    paragraphs: [],
    faqItems: [],
    hasList: false,
    hasFaqHeading: false,
  };
  const paragraphRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  while ((match = paragraphRe.exec(html)) !== null) {
    const text = stripTags(match[1] ?? "");
    if (text) out.paragraphs.push(text);
  }
  // Akapit bez znacznika <p> (wklejony zwykły tekst) też jest leadem - inaczej
  // wpis pisany „na płasko" dostawałby fałszywe „brak akapitu definicyjnego".
  if (out.paragraphs.length === 0) {
    const beforeFirstHeading = html.split(/<h[1-6]\b/i)[0] ?? "";
    const text = stripTags(beforeFirstHeading);
    if (text) out.paragraphs.push(text);
  }
  out.hasList = /<(ul|ol)\b[^>]*>[\s\S]*?<li\b/i.test(html);
  const headingRe = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  while ((match = headingRe.exec(html)) !== null) {
    if (FAQ_HEADING_RE.test(stripTags(match[2] ?? ""))) {
      out.hasFaqHeading = true;
      break;
    }
  }
  return out;
}

function extract(input: ZeroClickInput): ExtractedContent {
  const fromTree = fromBlocks(input.blocks);
  const treeHasContent =
    fromTree.paragraphs.length > 0 ||
    fromTree.faqItems.length > 0 ||
    fromTree.hasList ||
    fromTree.hasFaqHeading;
  if (treeHasContent) return fromTree;
  return fromHtml(input.html ?? "");
}

/**
 * Mierzy wpis względem reguł zero-click. Zwraca KOMPLET reguł (nigdy podzbiór)
 * - checklista w edytorze ma zawsze te same wiersze, żeby redaktor uczył się
 * ich kolejności, a nie zgadywał, czy coś zniknęło.
 */
export function analyzeZeroClick(input: ZeroClickInput): ZeroClickReport {
  const content = extract(input);
  const headings = collectHeadings({ html: input.html, blocks: input.blocks }).filter(
    (h) => h.level >= 2 && h.level <= 3 && h.text.trim().length > 0,
  );
  const takeaways = (input.takeaways ?? []).map((t) => t.trim()).filter(Boolean);
  const checks: ZeroClickCheck[] = [];

  // 1. Akapit definicyjny - pierwszy akapit treści.
  const lead = content.paragraphs[0] ?? "";
  const leadWords = countWords(lead);
  if (leadWords === 0) {
    checks.push({ id: "lead", status: "todo", value: 0 });
  } else if (startsWithFiller(lead)) {
    // Rozbiegówka jest gorsza niż zła długość: zdanie o właściwej długości,
    // które nie odpowiada na pytanie, i tak nie trafi do snippetu.
    checks.push({
      id: "lead",
      status: "warn",
      reason: "filler",
      value: leadWords,
      snippet: snippet(lead),
    });
  } else if (leadWords < ZERO_CLICK_BUDGETS.leadWordsMin) {
    checks.push({ id: "lead", status: "warn", reason: "short", value: leadWords });
  } else if (leadWords > ZERO_CLICK_BUDGETS.leadWordsMax) {
    checks.push({ id: "lead", status: "warn", reason: "long", value: leadWords });
  } else {
    checks.push({ id: "lead", status: "ok", value: leadWords });
  }

  // 2. Nagłówki pytaniowe.
  const questionCount = headings.filter((h) => isQuestionHeading(h.text)).length;
  if (headings.length === 0) {
    checks.push({ id: "questionHeadings", status: "todo", value: 0, total: 0 });
  } else if (headings.length < ZERO_CLICK_BUDGETS.headingsForRatio) {
    // Za mało nagłówków, by mówić o strukturze - to samo w sobie jest uwagą.
    checks.push({
      id: "questionHeadings",
      status: questionCount > 0 ? "warn" : "todo",
      reason: "tooFewHeadings",
      value: questionCount,
      total: headings.length,
    });
  } else {
    const ratio = questionCount / headings.length;
    checks.push({
      id: "questionHeadings",
      status:
        ratio >= ZERO_CLICK_BUDGETS.questionHeadingsRatioMin
          ? "ok"
          : questionCount > 0
            ? "warn"
            : "todo",
      value: questionCount,
      total: headings.length,
    });
  }

  // 3. Sekcja FAQ (blok `faq` daje dodatkowo JSON-LD FAQPage; sam nagłówek nie).
  const faqHeadingInHeadings = headings.some((h) => FAQ_HEADING_RE.test(h.text));
  const hasFaqHeading = content.hasFaqHeading || faqHeadingInHeadings;
  if (content.faqItems.length > 0) {
    checks.push({ id: "faq", status: "ok", value: content.faqItems.length });
  } else if (hasFaqHeading) {
    // Pytania są, ale poza blokiem `faq` - czytelnik je widzi, crawler nie
    // dostaje FAQPage. To warn, nie ok.
    checks.push({ id: "faq", status: "warn", reason: "prose", value: 0 });
  } else {
    checks.push({ id: "faq", status: "todo", value: 0 });
  }

  // 4. Długość odpowiedzi w FAQ.
  if (content.faqItems.length === 0) {
    checks.push({ id: "faqAnswerLength", status: "todo", value: 0, total: 0 });
  } else {
    const tooLong = content.faqItems
      .map((item) => ({ item, words: countWords(item.a) }))
      .filter(({ words }) => words > ZERO_CLICK_BUDGETS.faqAnswerWordsMax);
    checks.push(
      tooLong.length === 0
        ? { id: "faqAnswerLength", status: "ok", value: 0, total: content.faqItems.length }
        : {
            id: "faqAnswerLength",
            status: "warn",
            value: tooLong.length,
            total: content.faqItems.length,
            snippet: snippet(tooLong[0].item.q),
          },
    );
  }

  // 5. Punkty „Dowiesz się…" - trafiają do `abstract` w JSON-LD.
  if (takeaways.length === 0) {
    checks.push({ id: "takeaways", status: "todo", value: 0 });
  } else {
    const tooFew = takeaways.length < ZERO_CLICK_BUDGETS.takeawaysMin;
    const tooMany = takeaways.length > ZERO_CLICK_BUDGETS.takeawaysMax;
    checks.push({
      id: "takeaways",
      status: tooFew || tooMany ? "warn" : "ok",
      ...(tooFew ? { reason: "few" as const } : tooMany ? { reason: "many" as const } : {}),
      value: takeaways.length,
    });
  }

  // 6. Skanowalność - lista kroków / checklista.
  checks.push({ id: "scannable", status: content.hasList ? "ok" : "todo" });

  return {
    checks,
    passed: checks.filter((c) => c.status === "ok").length,
    total: checks.length,
  };
}
