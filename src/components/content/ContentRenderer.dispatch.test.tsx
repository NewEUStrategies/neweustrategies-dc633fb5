// PRZEŁĄCZNIK STRATEGII `ContentRenderer` - gałąź BUILDERA i kontekst wpisu.
//
// DLACZEGO OSOBNY PLIK. `ContentRenderer.test.tsx` renderuje PRAWDZIWE silniki
// (blocks + sanitizowany HTML) i taki ma zostać. Dwie gałęzie, których tam nie
// widać, wymagają odwrotnego ustawienia: podmienionych silników.
//   1. Silnik BUILDERA nie był renderowany w ŻADNYM teście tego komponentu,
//      a to główna strategia stron budowanych builderem. Prawdziwy
//      `BuilderRenderer` ciągnie za sobą leniwe paczki widgetów, i18n,
//      obserwatory i klienta react-query - czyli mierzyłby wszystko poza
//      przełącznikiem, który jest tu przedmiotem testu.
//   2. Ternarne `currentPostCtx ? <CurrentPostProvider> : tree` w OBU gałęziach
//      silnikowych - żaden test nie podawał `currentPostCtx`, więc ścieżka,
//      którą widgety tagów dynamicznych w ogóle dostają dane bieżącego wpisu,
//      nie była wykonana ani razu.
//
// Atrapy silników są CELOWO głupie: wypisują to, co dostały, i odczytują
// kontekst. Dzięki temu asercje mówią o dyspozytorze, a nie o cudzym renderze.
import { describe, it, expect, vi } from "vitest";
import { freezeClock } from "@/test/time";

freezeClock();
import { render } from "@testing-library/react";
import type { BuilderDocument } from "@/lib/builder/types";
import type { BlocksDoc } from "@/lib/blocks/types";
import type { CurrentPostCtx } from "@/lib/content-model/postContext";

vi.mock("@/components/builder/organisms/BuilderRenderer", async () => {
  const { useCurrentPostCtx } = await import("@/lib/content-model/postContext");
  return {
    BuilderRenderer: ({
      doc,
      lang,
      stream,
    }: {
      doc: BuilderDocument;
      lang: string;
      stream?: boolean;
    }) => {
      const ctx = useCurrentPostCtx();
      return (
        <div
          data-testid="builder"
          data-lang={lang}
          data-stream={String(stream)}
          data-sections={String(doc.sections.length)}
          data-ctx-title={ctx?.title_pl ?? "BRAK"}
        />
      );
    },
  };
});

vi.mock("@/components/blocks/BlocksRenderer", async () => {
  const { useCurrentPostCtx } = await import("@/lib/content-model/postContext");
  return {
    BlocksRenderer: ({
      doc,
      lang,
      postId,
    }: {
      doc: BlocksDoc | null;
      lang: string;
      postId?: string;
    }) => {
      const ctx = useCurrentPostCtx();
      return (
        <div
          data-testid="blocks"
          data-lang={lang}
          data-post-id={postId ?? "BRAK"}
          data-blocks={String(doc?.blocks.length ?? 0)}
          data-ctx-title={ctx?.title_pl ?? "BRAK"}
        />
      );
    },
  };
});

import { ContentRenderer } from "./ContentRenderer";

/** Dokument buildera z jedną sekcją - minimum, żeby silnik został wybrany. */
const builderDoc = (): BuilderDocument =>
  ({
    version: 1,
    sections: [{ id: "s1", kind: "section", children: [] }],
  }) as unknown as BuilderDocument;

const blocksDoc = (): BlocksDoc => ({
  version: 1,
  blocks: [{ id: "b1", type: "paragraph", data: { html: "<p>Treść</p>" } }],
});

/** Kontekst bieżącego wpisu - dane fikcyjne, domena wyłącznie example.com. */
const POST_CTX: CurrentPostCtx = {
  kind: "post",
  id: "post-1",
  slug: "raport-roczny",
  title_pl: "Raport roczny",
  title_en: "Annual report",
  publishedAt: "2026-03-01T09:00:00.000Z",
};

describe("ContentRenderer - gałąź silnika buildera", () => {
  it("editor=builder z sekcją renderuje builder, a NIE artykuł z HTML", () => {
    const { container, getByTestId } = render(
      <ContentRenderer
        editor="builder"
        builderDoc={builderDoc()}
        blocksDoc={null}
        html="<p>Ten HTML nie powinien się pojawić</p>"
        lang="pl"
      />,
    );

    expect(getByTestId("builder").dataset.sections).toBe("1");
    expect(container.querySelector("article.single-post-content")).toBeNull();
    expect(container.textContent).not.toContain("Ten HTML nie powinien się pojawić");
  });

  it("przekazuje builderowi język i flagę strumieniowania", () => {
    const { getByTestId } = render(
      <ContentRenderer
        editor="builder"
        builderDoc={builderDoc()}
        blocksDoc={null}
        html=""
        lang="en"
        stream
      />,
    );

    expect(getByTestId("builder").dataset.lang).toBe("en");
    expect(getByTestId("builder").dataset.stream).toBe("true");
  });

  it("domyślnie strumieniowanie jest WYŁĄCZONE", () => {
    const { getByTestId } = render(
      <ContentRenderer
        editor="builder"
        builderDoc={builderDoc()}
        blocksDoc={null}
        html=""
        lang="pl"
      />,
    );
    expect(getByTestId("builder").dataset.stream).toBe("false");
  });

  it("editor=builder BEZ sekcji spada na HTML - dokument buildera nie jest renderowany", () => {
    const { container, queryByTestId } = render(
      <ContentRenderer
        editor="builder"
        builderDoc={{ version: 1, sections: [] } as unknown as BuilderDocument}
        blocksDoc={null}
        html="<p>zapasowa treść</p>"
        lang="pl"
      />,
    );

    expect(queryByTestId("builder")).toBeNull();
    expect(container.querySelector("article.single-post-content")).not.toBeNull();
    expect(container.textContent).toContain("zapasowa treść");
  });

  it("editor=blocks wygrywa nad obecnym dokumentem buildera", () => {
    const { getByTestId, queryByTestId } = render(
      <ContentRenderer
        editor="blocks"
        builderDoc={builderDoc()}
        blocksDoc={blocksDoc()}
        html=""
        lang="pl"
        postId="post-1"
      />,
    );

    expect(getByTestId("blocks").dataset.postId).toBe("post-1");
    expect(queryByTestId("builder")).toBeNull();
  });
});

describe("ContentRenderer - kontekst bieżącego wpisu dla widgetów dynamicznych", () => {
  it("silnik buildera Z kontekstem podaje go w dół drzewa", () => {
    const { getByTestId } = render(
      <ContentRenderer
        editor="builder"
        builderDoc={builderDoc()}
        blocksDoc={null}
        html=""
        lang="pl"
        currentPostCtx={POST_CTX}
      />,
    );
    expect(getByTestId("builder").dataset.ctxTitle).toBe("Raport roczny");
  });

  it("silnik bloków Z kontekstem podaje go w dół drzewa", () => {
    const { getByTestId } = render(
      <ContentRenderer
        editor="blocks"
        builderDoc={builderDoc()}
        blocksDoc={blocksDoc()}
        html=""
        lang="pl"
        currentPostCtx={POST_CTX}
      />,
    );
    expect(getByTestId("blocks").dataset.ctxTitle).toBe("Raport roczny");
  });

  it("BEZ kontekstu drzewo idzie bez dostawcy - widget widzi `null`", () => {
    // Druga gałąź tego samego ternarnego. To NIE jest szczegół: dostawca
    // z wartością „na wszelki wypadek" pokazywałby dane cudzego wpisu tam,
    // gdzie trasa świadomie ich nie podała (nagłówek, stopka, archiwum).
    const builderOnly = render(
      <ContentRenderer
        editor="builder"
        builderDoc={builderDoc()}
        blocksDoc={null}
        html=""
        lang="pl"
      />,
    );
    expect(builderOnly.getByTestId("builder").dataset.ctxTitle).toBe("BRAK");

    const blocksOnly = render(
      <ContentRenderer
        editor="blocks"
        builderDoc={builderDoc()}
        blocksDoc={blocksDoc()}
        html=""
        lang="pl"
      />,
    );
    expect(blocksOnly.getByTestId("blocks").dataset.ctxTitle).toBe("BRAK");
  });

  it("ścieżka HTML nie owija treści dostawcą kontekstu, nawet gdy kontekst jest", () => {
    // Kontrakt czytany wprost z kodu: dostawca dotyczy WYŁĄCZNIE silników
    // z widgetami. Sanityzowany HTML nie ma czego z kontekstu odczytać.
    const { container } = render(
      <ContentRenderer
        editor="richtext"
        builderDoc={{ version: 1, sections: [] } as unknown as BuilderDocument}
        blocksDoc={null}
        html="<p>Zwykła treść</p>"
        lang="pl"
        currentPostCtx={POST_CTX}
      />,
    );
    expect(container.querySelector("article.single-post-content")).not.toBeNull();
    expect(container.textContent).toContain("Zwykła treść");
  });

  it("ścieżka HTML dostaje usprawnienia obrazów i flagę eagerFirstImage", () => {
    const { container } = render(
      <ContentRenderer
        editor="richtext"
        builderDoc={{ version: 1, sections: [] } as unknown as BuilderDocument}
        blocksDoc={null}
        html='<p>Tekst</p><img src="https://example.com/a.jpg" alt="Opis">'
        lang="pl"
        eagerFirstImage
      />,
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("loading")).toBe("eager");
    expect(img?.getAttribute("fetchpriority")).toBe("high");
    expect(img?.getAttribute("decoding")).toBe("async");
  });
});
