import { describe, expect, it } from "vitest";
import { WIDGETS } from "../registry";

describe("newsletter widget defaults", () => {
  it("włącza domyślnie ten sam zestaw pól co formularz pod artykułem", () => {
    const defaults = WIDGETS.find((widget) => widget.type === "newsletter")?.defaults();

    expect(defaults).toMatchObject({
      requireEmail: "1",
      showFirstName: "1",
      showLastName: "1",
      showCompany: "1",
      showPosition: "1",
      showPhone: "1",
      requireFirstName: "0",
      requireLastName: "0",
      requireCompany: "0",
      requirePosition: "0",
      requirePhone: "0",
    });
  });
});