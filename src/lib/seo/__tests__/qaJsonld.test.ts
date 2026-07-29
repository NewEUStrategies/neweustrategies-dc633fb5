import { describe, it, expect } from "vitest";
import { qaPageJsonLd, faqPageJsonLd, qaCollectionJsonLd } from "@/lib/seo/jsonld";

const ORIGIN = "https://neweuropeanstrategies.com";

describe("qaPageJsonLd", () => {
  const questions = [
    {
      id: "q1",
      body: "Czy Europa zwiększy wydatki obronne?",
      answer: "Tak, większość państw NATO deklaruje wzrost.",
      authorName: "Anna",
      createdAt: "2026-01-01T10:00:00Z",
      answeredAt: "2026-01-02T10:00:00Z",
      upvotes: 7,
    },
    { id: "q2", body: "A budżet UE?", answer: "Negocjacje trwają.", upvotes: 2 },
    { id: "q3", body: "Pytanie bez odpowiedzi", answer: null },
  ];

  it("emits a QAPage with the top answered question as mainEntity", () => {
    const graph = qaPageJsonLd({
      origin: ORIGIN,
      lang: "pl",
      path: "/qa/sesja",
      name: "Sesja Q&A",
      description: "Opis",
      questions,
    });
    expect(graph?.["@type"]).toBe("QAPage");
    expect(graph?.url).toBe(`${ORIGIN}/qa/sesja`);
    const main = graph?.mainEntity as Record<string, unknown>;
    expect(main["@type"]).toBe("Question");
    expect(main.acceptedAnswer).toBeTruthy();
    expect(main.upvoteCount).toBe(7);
    expect(main.author).toEqual({ "@type": "Person", name: "Anna" });
  });

  it("skips unanswered questions and returns null when nothing is answered", () => {
    const graph = qaPageJsonLd({
      origin: ORIGIN,
      lang: "pl",
      path: "/qa/sesja",
      name: "Sesja",
      questions,
    });
    expect((graph?.hasPart as unknown[]).length).toBe(1);
    expect(
      qaPageJsonLd({
        origin: ORIGIN,
        lang: "pl",
        path: "/qa/pusta",
        name: "Pusta",
        questions: [{ id: "x", body: "?", answer: "   " }],
      }),
    ).toBeNull();
  });

  it("uses the /en path prefix for the English render", () => {
    const graph = qaPageJsonLd({
      origin: ORIGIN,
      lang: "en",
      path: "/qa/session",
      name: "Session",
      questions,
    });
    expect(graph?.url).toBe(`${ORIGIN}/en/qa/session`);
    expect(graph?.inLanguage).toBe("en");
  });
});

describe("faqPageJsonLd", () => {
  it("builds a FAQPage from complete pairs only", () => {
    const graph = faqPageJsonLd({
      origin: ORIGIN,
      lang: "pl",
      path: "/qa/sesja",
      items: [
        { question: "Pytanie?", answer: "Odpowiedź." },
        { question: "  ", answer: "Sierota." },
      ],
    });
    expect((graph?.mainEntity as unknown[]).length).toBe(1);
    expect(faqPageJsonLd({ origin: ORIGIN, lang: "pl", path: "/x", items: [] })).toBeNull();
  });
});

describe("qaCollectionJsonLd", () => {
  it("lists every session as an absolute, language-correct URL", () => {
    const graph = qaCollectionJsonLd({
      origin: ORIGIN,
      lang: "en",
      path: "/qa",
      name: "Q&A sessions",
      sessions: [{ slug: "a", title: "A" }, { slug: "b", title: "B" }],
    });
    const list = graph.mainEntity as { itemListElement: Array<{ url: string; position: number }> };
    expect(list.itemListElement.map((i) => i.url)).toEqual([
      `${ORIGIN}/en/qa/a`,
      `${ORIGIN}/en/qa/b`,
    ]);
    expect(list.itemListElement[1].position).toBe(2);
  });
});
