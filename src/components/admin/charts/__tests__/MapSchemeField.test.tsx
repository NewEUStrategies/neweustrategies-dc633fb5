// POLE SCHEMATU BARW MAPY W PANELU BUILDERA - zaślepka P0a (`mapScheme`).
//
// Typ pola istnieje od P0a, zanim edytor mapy dostanie wybór schematu
// z próbkami skali. `SchemaFieldControl` kieruje go do `MapSchemeField`, a ten
// plik pilnuje, że rysuje DZIAŁAJĄCE pole związane z kluczem - panel nie może
// pokazać pustki nad ustawieniem, które schemat oferuje. Pełny komponent
// zastępuje zaślepkę RAZEM z tymi przypadkami.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Json } from "@/lib/builder/types";
import type { SchemaField } from "@/lib/builder/schemas";
import { optionValues, selectWithOption } from "@/test/builder/panels";
import { SchemaFieldControl } from "@/components/admin/builder/ui/molecules/SchemaFieldControl";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

type Written = Array<[string, Json]>;

function renderField(field: SchemaField, content: Record<string, unknown> = {}) {
  const written: Written = [];
  render(
    <SchemaFieldControl
      field={field}
      lang="pl"
      content={content}
      setContent={(key, value) => written.push([key, value])}
    />,
  );
  return { written, last: () => written.at(-1) };
}

describe("mapScheme - lista z opcji schematu albo pole tekstowe", () => {
  const OPTIONS = [
    { value: "blue", label: "niebieski" },
    { value: "slate", label: "łupkowy" },
  ];

  it("z opcjami: lista wyboru, pusta treść pokazuje pierwszą opcję", () => {
    const { last } = renderField(
      { key: "scheme", type: "mapScheme", label: "Schemat", options: OPTIONS },
      {},
    );
    const lista = selectWithOption("slate");
    expect(lista.value).toBe("blue");
    expect(optionValues(lista)).toEqual(["blue", "slate"]);
    fireEvent.change(lista, { target: { value: "slate" } });
    expect(last()).toEqual(["scheme", "slate"]);
  });

  it("bez opcji: pole tekstowe związane z kluczem", () => {
    const { last } = renderField({ key: "scheme", type: "mapScheme", label: "Schemat" }, {});
    fireEvent.change(screen.getByRole("textbox", { name: "Schemat" }), {
      target: { value: " accent " },
    });
    expect(last()).toEqual(["scheme", "accent"]);
  });
});
