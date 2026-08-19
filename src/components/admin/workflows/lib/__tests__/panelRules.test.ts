import { describe, expect, it } from "vitest";
import type { WorkflowDefinitionRow } from "@/lib/admin/workflows";
import {
  ALL_SENTINEL,
  RUNS_PAGE_LIMIT,
  fromSelectValue,
  installedTemplateKeys,
  isTemplateInstalled,
  runsQueryParams,
  toSelectValue,
  traceQueryEnabled,
  traceSubmission,
} from "../panelRules";

function definition(over: Partial<WorkflowDefinitionRow> = {}): WorkflowDefinitionRow {
  return {
    template_key: null,
    enabled: true,
    ...over,
  } as WorkflowDefinitionRow;
}

const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("wartownik „wszystkie” w filtrach", () => {
  it("brak filtra pokazuje się jako wartownik, nie pusty string", () => {
    // Radiksowy `Select` REZERWUJE pusty string (czyści zaznaczenie i wywala
    // się na `SelectItem value="">`), więc „bez filtra" musi mieć własną,
    // niepustą reprezentację.
    expect(toSelectValue(null)).toBe(ALL_SENTINEL);
    expect(ALL_SENTINEL).not.toBe("");
  });

  it("konkretna wartość filtra przechodzi bez zmian", () => {
    expect(toSelectValue("wf-1")).toBe("wf-1");
  });

  it("wybór wartownika znaczy „bez filtra”", () => {
    expect(fromSelectValue(ALL_SENTINEL)).toBeNull();
    expect(fromSelectValue("wf-1")).toBe("wf-1");
  });

  it("obie strony mapowania są odwracalne", () => {
    for (const value of [null, "wf-1"]) {
      expect(fromSelectValue(toSelectValue(value))).toBe(value);
    }
  });
});

describe("installedTemplateKeys", () => {
  it("REGRESJA: szablon WYŁĄCZONEGO przepisu nadal liczy się jako zainstalowany", () => {
    // Instalacja jest w bazie idempotentna per (tenant, template_key) i
    // RE-AKTYWUJE istniejący przepis. Pokazanie wyłączonego szablonu jako
    // „do zainstalowania" obiecywałoby nowy przepis, a dałoby reaktywację
    // starego - razem z jego zmodyfikowanymi krokami.
    const keys = installedTemplateKeys([definition({ template_key: "welcome", enabled: false })]);
    expect(keys.has("welcome")).toBe(true);
  });

  it("pomija przepisy utworzone ręcznie (bez klucza szablonu)", () => {
    const keys = installedTemplateKeys([definition(), definition({ template_key: "welcome" })]);
    expect([...keys]).toEqual(["welcome"]);
  });

  it("deduplikuje ten sam klucz z wielu przepisów", () => {
    const keys = installedTemplateKeys([
      definition({ template_key: "welcome" }),
      definition({ template_key: "welcome" }),
    ]);
    expect(keys.size).toBe(1);
  });

  it("pusta lista przepisów daje pusty zbiór", () => {
    expect(installedTemplateKeys([]).size).toBe(0);
  });
});

describe("isTemplateInstalled", () => {
  const definitions = [definition({ template_key: "welcome" })];

  it("rozpoznaje zainstalowany i niezainstalowany szablon", () => {
    expect(isTemplateInstalled("welcome", definitions)).toBe(true);
    expect(isTemplateInstalled("digest", definitions)).toBe(false);
  });

  it("szablon bez klucza nigdy nie jest „zainstalowany”", () => {
    expect(isTemplateInstalled(null, definitions)).toBe(false);
  });
});

describe("runsQueryParams", () => {
  it("REGRESJA: puste filtry są POMIJANE, nie wysyłane jako null", () => {
    // Warstwa danych buduje z nich łańcuch PostgREST, więc `workflowId: null`
    // zawęziłoby wynik do przebiegów o pustym `workflow_id` - czyli do zera -
    // zamiast pokazać wszystkie.
    const params = runsQueryParams({ workflowId: null, status: null });
    expect(params).toEqual({ limit: RUNS_PAGE_LIMIT });
    expect("workflowId" in params).toBe(false);
    expect("status" in params).toBe(false);
  });

  it("przekazuje filtry, które zostały wybrane", () => {
    expect(runsQueryParams({ workflowId: "wf-1", status: "failed" })).toEqual({
      limit: RUNS_PAGE_LIMIT,
      workflowId: "wf-1",
      status: "failed",
    });
  });

  it("filtruje po jednym wymiarze niezależnie od drugiego", () => {
    expect(runsQueryParams({ workflowId: "wf-1", status: null })).toEqual({
      limit: RUNS_PAGE_LIMIT,
      workflowId: "wf-1",
    });
    expect(runsQueryParams({ workflowId: null, status: "succeeded" })).toEqual({
      limit: RUNS_PAGE_LIMIT,
      status: "succeeded",
    });
  });

  it("zawsze niesie limit strony", () => {
    expect(runsQueryParams({ workflowId: null, status: null }).limit).toBe(RUNS_PAGE_LIMIT);
  });
});

describe("traceSubmission", () => {
  it("przyjmuje poprawny identyfikator korelacji", () => {
    expect(traceSubmission(UUID)).toEqual({ kind: "search", correlationId: UUID });
  });

  it("obcina białe znaki - identyfikator kopiuje się z logów i nagłówków", () => {
    expect(traceSubmission(`  ${UUID}\n`)).toEqual({ kind: "search", correlationId: UUID });
  });

  it("odrzuca wszystko, co nie jest UUID-em, PRZED zapytaniem", () => {
    // `fetchCorrelationTrace` z byle napisem kończy się błędem PostgREST-a
    // o niepoprawnym typie - komunikatem, z którego administrator nie wyczyta,
    // że po prostu wkleił nie to pole.
    for (const bad of ["", "   ", "abc", "12345", `${UUID}x`, "0f8fad5b-d9cb-469f-a165"]) {
      expect(traceSubmission(bad), `powinno odrzucić: ${JSON.stringify(bad)}`).toEqual({
        kind: "invalid",
      });
    }
  });
});

describe("traceQueryEnabled", () => {
  it("nie startuje zapytania bez identyfikatora", () => {
    expect(traceQueryEnabled(null)).toBe(false);
  });

  it("nie startuje zapytania dla identyfikatora z adresu, który nie jest UUID-em", () => {
    // Deep-link może przynieść w adresie dowolny napis; `enabled: false` jest
    // tańsze niż okrągły obieg zakończony błędem typu.
    expect(traceQueryEnabled("cokolwiek")).toBe(false);
  });

  it("startuje dla poprawnego identyfikatora", () => {
    expect(traceQueryEnabled(UUID)).toBe(true);
  });
});
