// Karta „Tłumaczenie AI PL -> EN" w edytorze wpisu.
//
// CO TU DOWODZIMY:
//   * do serwera jedzie KOMPLETNY zestaw pól PL (tytuł, zajawka, wnioski, SEO,
//     treść) plus dokument bloków zawinięty w wersjonowaną kopertę - brak pola
//     oznacza wersję EN bez tego fragmentu, czyli publikację z dziurą,
//   * wynik wraca do FORMULARZA przez `onTranslated` (nie do bazy) - redakcja
//     zapisuje go świadomie,
//   * bez tytułu PL nie ma czego tłumaczyć i przycisk jest zablokowany,
//   * istniejąca treść EN dostaje jawne OSTRZEŻENIE o nadpisaniu szkicu,
//   * podczas pracy przycisk jest zablokowany i zmienia opis, a błąd serwera
//     jest pokazany i NIE podmienia treści EN.
//
// DLACZEGO TO WAŻNE: karta jednym kliknięciem podmienia całą angielską wersję
// wpisu. Cicha awaria zostawia redakcję w przekonaniu, że tłumaczenie się udało
// (a przy publikacji wychodzi pusta strona EN); brak ostrzeżenia niszczy ręcznie
// dopracowany tekst tłumacza bez pytania.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Block } from "@/lib/blocks/types";
import type { TranslateOutput } from "@/lib/content/translateSegments";
import type { TranslateCardInput } from "../TranslateCard";

const h = vi.hoisted(() => ({ translate: null as unknown, toast: null as unknown }));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
vi.mock("@/lib/i18n-admin-post-panes", () => ({}));

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/content/translate.functions", async () => {
  const { vi: v } = await import("vitest");
  h.translate = v.fn();
  return { translatePostDraft: h.translate };
});

vi.mock("sonner", async () => {
  const { toastStub } = await import("@/test/post-editor/fixtures");
  const toast = toastStub();
  h.toast = toast;
  return { toast, Toaster: () => null };
});

import { TranslateCard } from "../TranslateCard";

const translate = () => h.translate as ReturnType<typeof vi.fn>;
const toast = () => h.toast as ReturnType<typeof import("@/test/post-editor/fixtures").toastStub>;

const BLOCKS = [{ id: "b1", type: "paragraph", data: { text: "Akapit PL" } }] as unknown as Block[];

const SOURCE: TranslateCardInput = {
  title_pl: "Polski tytuł wpisu",
  excerpt_pl: "Polska zajawka.",
  takeaways_pl: ["Pierwszy wniosek", "Drugi wniosek"],
  seo_title_pl: "Tytuł SEO",
  seo_description_pl: "Opis SEO wpisu.",
  content_pl: "<p>Polska treść</p>",
  blocks_pl: BLOCKS,
};

const RESULT: TranslateOutput = {
  title_en: "English post title",
  excerpt_en: "English excerpt.",
  takeaways_en: ["First takeaway", "Second takeaway"],
  seo_title_en: "SEO title",
  seo_description_en: "SEO description.",
  content_en: "<p>English body</p>",
  blocks_en: null,
};

function renderCard(
  overrides: { source?: Partial<TranslateCardInput>; hasEnContent?: boolean } = {},
) {
  const onTranslated = vi.fn<(result: TranslateOutput) => void>();
  const view = render(
    <TranslateCard
      source={{ ...SOURCE, ...overrides.source }}
      hasEnContent={overrides.hasEnContent ?? false}
      onTranslated={onTranslated}
    />,
  );
  return { ...view, onTranslated };
}

const runButton = () => screen.getByRole("button") as HTMLButtonElement;

/** Ręcznie sterowana obietnica - do testu stanu „tłumaczę". */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  translate().mockReset();
  translate().mockResolvedValue(RESULT);
  toast().success.mockReset();
  toast().error.mockReset();
});

describe("TranslateCard - stan wyjściowy i ostrzeżenia", () => {
  it("wyjaśnia, co karta robi, i zaprasza do uruchomienia tłumaczenia", () => {
    renderCard();

    expect(screen.getByText("adminPostPanes.translate.hint")).toBeInTheDocument();
    expect(runButton()).toHaveTextContent("adminPostPanes.translate.run");
    expect(runButton().disabled).toBe(false);
  });

  it("gdy wersja EN już istnieje, karta OSTRZEGA o nadpisaniu szkicu", () => {
    renderCard({ hasEnContent: true });

    expect(screen.getByText("adminPostPanes.translate.overwriteWarning")).toBeInTheDocument();
  });

  it("bez treści EN nie strasz ostrzeżeniem, którego nie ma o co", () => {
    renderCard({ hasEnContent: false });

    expect(screen.queryByText("adminPostPanes.translate.overwriteWarning")).not.toBeInTheDocument();
  });

  it("bez tytułu PL nie ma czego tłumaczyć - przycisk jest zablokowany", () => {
    renderCard({ source: { title_pl: "" } });

    expect(runButton().disabled).toBe(true);
  });

  it("tytuł ze samych spacji też blokuje (nie wysyłamy pustego zadania do modelu)", () => {
    renderCard({ source: { title_pl: "   " } });

    expect(runButton().disabled).toBe(true);
  });
});

describe("TranslateCard - wysyłka do serwera", () => {
  it("wysyła wszystkie pola PL i bloki w wersjonowanej kopercie", async () => {
    renderCard();

    fireEvent.click(runButton());

    await waitFor(() => expect(translate()).toHaveBeenCalledTimes(1));
    expect(translate()).toHaveBeenCalledWith({
      data: {
        title_pl: SOURCE.title_pl,
        excerpt_pl: SOURCE.excerpt_pl,
        takeaways_pl: SOURCE.takeaways_pl,
        seo_title_pl: SOURCE.seo_title_pl,
        seo_description_pl: SOURCE.seo_description_pl,
        content_pl: SOURCE.content_pl,
        blocks_doc_pl: { version: 1, blocks: BLOCKS },
      },
    });
  });

  it("wpis bez bloków wysyła jawny brak dokumentu, a nie pustą kopertę", async () => {
    renderCard({ source: { blocks_pl: null } });

    fireEvent.click(runButton());

    await waitFor(() => expect(translate()).toHaveBeenCalledTimes(1));
    const payload = translate().mock.calls[0][0] as { data: { blocks_doc_pl: unknown } };
    expect(payload.data.blocks_doc_pl).toBeNull();
  });

  it("puste pola opcjonalne jadą jako null (serwer ma wiedzieć, że ich NIE MA)", async () => {
    renderCard({
      source: { excerpt_pl: null, seo_title_pl: null, seo_description_pl: null, content_pl: null },
    });

    fireEvent.click(runButton());

    await waitFor(() => expect(translate()).toHaveBeenCalledTimes(1));
    const payload = translate().mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(payload.data.excerpt_pl).toBeNull();
    expect(payload.data.seo_title_pl).toBeNull();
    expect(payload.data.seo_description_pl).toBeNull();
    expect(payload.data.content_pl).toBeNull();
  });
});

describe("TranslateCard - wynik tłumaczenia", () => {
  it("wynik wraca do formularza w całości i jest potwierdzony", async () => {
    const { onTranslated } = renderCard();

    fireEvent.click(runButton());

    await waitFor(() => expect(onTranslated).toHaveBeenCalledWith(RESULT));
    expect(toast().success).toHaveBeenCalledWith("adminPostPanes.translate.done");
  });

  it("podczas pracy przycisk jest zablokowany i mówi, że tłumaczy", async () => {
    const gate = deferred<TranslateOutput>();
    translate().mockReturnValue(gate.promise);
    renderCard();

    fireEvent.click(runButton());

    await waitFor(() => expect(runButton().disabled).toBe(true));
    expect(runButton()).toHaveTextContent("adminPostPanes.translate.working");
    gate.resolve(RESULT);
    await waitFor(() => expect(runButton().disabled).toBe(false));
    expect(runButton()).toHaveTextContent("adminPostPanes.translate.run");
    // Jedno kliknięcie = jedno (płatne) zadanie tłumaczenia.
    expect(translate()).toHaveBeenCalledTimes(1);
  });
});

describe("TranslateCard - błędy", () => {
  it("błąd serwera jest pokazany i NIE podmienia treści EN", async () => {
    translate().mockRejectedValue(new Error("limit tokenów przekroczony"));
    const { onTranslated } = renderCard();

    fireEvent.click(runButton());

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("limit tokenów przekroczony"));
    expect(onTranslated).not.toHaveBeenCalled();
    expect(toast().success).not.toHaveBeenCalled();
  });

  it("awaria bez klasy Error trafia do toastu jako tekst", async () => {
    translate().mockRejectedValue("model niedostępny");
    renderCard();

    fireEvent.click(runButton());

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("model niedostępny"));
  });

  it("po błędzie karta wraca do stanu gotowości (można spróbować ponownie)", async () => {
    translate().mockRejectedValueOnce(new Error("chwilowa awaria"));
    const { onTranslated } = renderCard();

    fireEvent.click(runButton());
    await waitFor(() => expect(toast().error).toHaveBeenCalled());
    expect(runButton().disabled).toBe(false);

    translate().mockResolvedValue(RESULT);
    fireEvent.click(runButton());

    await waitFor(() => expect(onTranslated).toHaveBeenCalledWith(RESULT));
  });
});
