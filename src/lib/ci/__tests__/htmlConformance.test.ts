// Raport zgodności HTML (scripts/performance/check-html-conformance.ts): klasyfikacja
// komunikatów vnu 26.11.17 według scripts/performance/html-conformance-allowlist.json.
// Próbki to komunikaty z prawdziwego przebiegu vnu na dokumentach fixture `/` i `/blog`
// (treść, rodzaj i wycinek 1:1), plus kontrole negatywne: wpis akceptowany nie może
// połknąć innego problemu tej samej klasy (inny element, inny rodzaj, inny wycinek).
import { describe, expect, it } from "vitest";
import allowlist from "../../../../scripts/performance/html-conformance-allowlist.json";
import {
  ConformanceSetupError,
  DEFAULT_ALLOWLIST,
  VNU_VERSION,
  classifyMessages,
  compileAllowlist,
  countNewErrors,
  formatExtract,
  loadAllowlist,
  messageKind,
  parseVnuOutput,
  summarize,
  vnuCacheDir,
  type VnuMessage,
} from "../../../../scripts/performance/check-html-conformance";

const entries = loadAllowlist(DEFAULT_ALLOWLIST);
const classify = (m: VnuMessage) => classifyMessages([m], entries)[0];

const META_LANG: VnuMessage = {
  type: "error",
  message:
    "Using the “meta” element to specify the document-wide default language is obsolete. Consider specifying the language on the root element instead.",
  extract: 'carstw."/><meta http-equiv="content-language" content="pl"/><meta ',
};
const TRAILING_SLASH: VnuMessage = {
  type: "info",
  message:
    "Trailing slash on void elements has no effect and interacts badly with unquoted attribute values.",
  extract: 'pl"><head><meta charSet="utf-8"/><meta ',
};
const ROLE_LIST: VnuMessage = {
  type: "info",
  subType: "warning",
  message: "The “list” role is unnecessary for element “ul”.",
  extract: 'reground"><ul role="list" class="m-0 flex list-none flex-wrap">',
};
const NEW_SEARCH_TYPE: VnuMessage = {
  type: "error",
  message: "Bad value “search” for attribute “type” on element “input”.",
  extract: ':visible"><input type="search" role="combobox" aria-expanded="false"',
  lastLine: 79,
  firstColumn: 15214,
  lastColumn: 15300,
  hiliteStart: 10,
  hiliteLength: 20,
};

describe("lista klasyfikacji z repo", () => {
  it("ma udokumentowane wpisy: uzasadnienie i źródło przy każdym, accepted przed knownDebt", () => {
    for (const entry of [...allowlist.accepted, ...allowlist.knownDebt]) {
      expect(entry.reason.trim(), entry.id).not.toBe("");
      expect(entry.source.trim(), entry.id).not.toBe("");
    }
    expect(entries.map((e) => `${e.group}:${e.id}`)).toEqual([
      "accepted:meta-content-language",
      "accepted:css-container-type",
      "accepted:css-container-at-rule",
      "accepted:css-view-transition-name",
      "accepted:void-element-trailing-slash",
      "accepted:ul-role-list",
      "knownDebt:inline-style-not-first-child",
      "knownDebt:inline-style-rule-outside-scope",
      "knownDebt:section-lacks-heading",
    ]);
  });

  it("opisuje tę samą wersję vnu, którą skrypt przypina i trzyma w cache", () => {
    expect(allowlist._comment.join(" ")).toContain(`vnu-jar@${VNU_VERSION}`);
    expect(vnuCacheDir("/repo")).toBe(`/repo/node_modules/.cache/vnu-jar/${VNU_VERSION}`);
  });
});

describe("classifyMessages", () => {
  it.each<[string, VnuMessage, string, string | null]>([
    ["meta content-language (Bing)", META_LANG, "accepted", "meta-content-language"],
    [
      "container-type z silnika CSS",
      { type: "error", message: "CSS: “container-type”: Property “container-type” doesn't exist." },
      "accepted",
      "css-container-type",
    ],
    [
      "@container z silnika CSS",
      { type: "error", message: "CSS: Unrecognized at-rule “@container”" },
      "accepted",
      "css-container-at-rule",
    ],
    [
      "view-transition-name z silnika CSS",
      {
        type: "error",
        message: "CSS: “view-transition-name”: Property “view-transition-name” doesn't exist.",
      },
      "accepted",
      "css-view-transition-name",
    ],
    [
      "ukośnik w elemencie pustym (React)",
      TRAILING_SLASH,
      "accepted",
      "void-element-trailing-slash",
    ],
    ["role=list na ul (Safari/VoiceOver)", ROLE_LIST, "accepted", "ul-role-list"],
    [
      "style w body nie jako pierwsze dziecko",
      {
        type: "error",
        message: "A “style” element in “body” must be the first child of its parent.",
      },
      "knownDebt",
      "inline-style-not-first-child",
    ],
    [
      "reguła poza @scope (selektor z cudzysłowami)",
      {
        type: "error",
        message:
          'Style rule “[data-w-id="00000000-0000-0000-0000-000000000015"][data-w-id][data-w-id], .x” not allowed outside an “@scope” rule in a “style” element in “body”.',
      },
      "knownDebt",
      "inline-style-rule-outside-scope",
    ],
    [
      "sekcja bez nagłówka",
      {
        type: "info",
        subType: "warning",
        message:
          "Section lacks heading. Consider using “h2”-“h6” elements to add identifying headings to all sections, or else use a “div” element instead for any cases where no heading is needed.",
      },
      "knownDebt",
      "section-lacks-heading",
    ],
    ["NOWE: zły typ pola", NEW_SEARCH_TYPE, "new", null],
    [
      "NOWE: zła wartość CSS z danych (nie fałszywy alarm silnika)",
      { type: "error", message: "CSS: “color”: Too many values or values are not recognized." },
      "new",
      null,
    ],
    [
      "NOWE: meta języka w innej postaci niż content-language",
      { ...META_LANG, extract: '<meta name="language" content="pl"/>' },
      "new",
      null,
    ],
    [
      "NOWE: ukośnik jako błąd, nie info (rodzaj musi się zgadzać)",
      { ...TRAILING_SLASH, type: "error" },
      "new",
      null,
    ],
    [
      "NOWE: zbędna rola list na innym elemencie",
      { ...ROLE_LIST, message: "The “list” role is unnecessary for element “ol”." },
      "new",
      null,
    ],
    [
      "NOWE: inna właściwość nieznana silnikowi CSS",
      { type: "error", message: "CSS: “container-name”: Property “container-name” doesn't exist." },
      "new",
      null,
    ],
  ])("%s", (_name, message, verdict, entryId) => {
    const result = classify(message);
    expect(result.verdict).toBe(verdict);
    expect(result.entryId).toBe(entryId);
  });

  it("niesie pozycję (pierwsza linia/kolumna) i wycinek komunikatu", () => {
    expect(classify(NEW_SEARCH_TYPE)).toMatchObject({
      kind: "error",
      line: 79,
      column: 15214,
      extract: NEW_SEARCH_TYPE.extract,
    });
  });
});

describe("messageKind", () => {
  it.each<[VnuMessage, string]>([
    [{ type: "error" }, "error"],
    [{ type: "error", subType: "fatal" }, "error"],
    [{ type: "info", subType: "warning" }, "warning"],
    [{ type: "info" }, "info"],
    [{ type: "nieznany" }, "error"],
  ])("%o -> %s", (message, kind) => {
    expect(messageKind(message)).toBe(kind);
  });
});

describe("summarize i --strict", () => {
  it("liczy razem/akcept./dług/NOWE per rodzaj, a --strict widzi wyłącznie NOWE błędy", () => {
    const warningOnly: VnuMessage = {
      type: "info",
      subType: "warning",
      message:
        "Attribute “aria-required” is unnecessary for elements that have attribute “required”.",
    };
    const reportOnly = classifyMessages(
      [META_LANG, TRAILING_SLASH, ROLE_LIST, warningOnly],
      entries,
    );
    expect(countNewErrors(reportOnly)).toBe(0);

    const messages = classifyMessages(
      [META_LANG, TRAILING_SLASH, ROLE_LIST, warningOnly, NEW_SEARCH_TYPE],
      entries,
    );
    const summary = summarize(messages);
    expect(summary.error).toEqual({ total: 2, accepted: 1, knownDebt: 0, new: 1 });
    expect(summary.warning).toEqual({ total: 2, accepted: 1, knownDebt: 0, new: 1 });
    expect(summary.info).toEqual({ total: 1, accepted: 1, knownDebt: 0, new: 0 });
    expect(summary.all).toEqual({ total: 5, accepted: 3, knownDebt: 0, new: 2 });
    expect(countNewErrors(messages)).toBe(1);
  });
});

describe("parseVnuOutput", () => {
  it("pomija linię JAVA_TOOL_OPTIONS przed JSON-em, także z klamrami", () => {
    const output = parseVnuOutput(
      'Picked up JAVA_TOOL_OPTIONS: -Dx={a} -Dhttp.nonProxyHosts=localhost|127.*\n{"messages":[{"type":"info","message":"m"}],"version":"26.11.17 (a4bee0f)"}\n',
    );
    expect(output.version).toBe("26.11.17 (a4bee0f)");
    expect(output.messages).toEqual([{ type: "info", message: "m" }]);
  });

  it("odrzuca wyjście bez raportu JSON", () => {
    expect(() => parseVnuOutput("Error: Unable to access jarfile vnu.jar")).toThrow(
      ConformanceSetupError,
    );
    expect(() => parseVnuOutput('{"version":"26.11.17"}')).toThrow(/messages/);
  });
});

describe("compileAllowlist", () => {
  const entry = { id: "a", type: "error", message: "^x$", reason: "powód" };

  it.each<[string, unknown, RegExp]>([
    ["brak grupy", { accepted: [] }, /knownDebt/],
    ["brak uzasadnienia", { accepted: [{ ...entry, reason: " " }], knownDebt: [] }, /reason/],
    ["powtórzone id między grupami", { accepted: [entry], knownDebt: [entry] }, /powtórzone/],
    ["zły wzorzec", { accepted: [{ ...entry, message: "(" }], knownDebt: [] }, /wyrażenie/],
    ["zły wzorzec wycinka", { accepted: [{ ...entry, extract: "[" }], knownDebt: [] }, /extract/],
    ["nieznany rodzaj", { accepted: [{ ...entry, type: "fatal" }], knownDebt: [] }, /type/],
  ])("odrzuca: %s", (_name, raw, error) => {
    expect(() => compileAllowlist(raw)).toThrow(error);
  });
});

describe("formatExtract", () => {
  it("zaznacza miejsce komunikatu i spłaszcza białe znaki", () => {
    const [m] = classifyMessages(
      [{ type: "error", message: "m", extract: "ab\n  cdef", hiliteStart: 5, hiliteLength: 2 }],
      entries,
    );
    expect(formatExtract(m)).toBe("ab »cd«ef");
  });
});
