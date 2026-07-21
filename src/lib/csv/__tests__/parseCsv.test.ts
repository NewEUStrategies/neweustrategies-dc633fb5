import { describe, expect, it } from "vitest";
import { detectCsvDelimiter, parseCsv } from "../parseCsv";

describe("detectCsvDelimiter", () => {
  it("picks the more frequent separator in the header line", () => {
    expect(detectCsvDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectCsvDelimiter("a;b;c\n1;2;3")).toBe(";");
  });

  it("ignores separators inside quoted fields", () => {
    expect(detectCsvDelimiter('"a,b";c;d\n')).toBe(";");
  });

  it("defaults to comma on a tie or when neither occurs", () => {
    expect(detectCsvDelimiter("email\nx@y.z")).toBe(",");
  });
});

describe("parseCsv", () => {
  it("parses header + rows with a comma delimiter", () => {
    const { header, rows } = parseCsv("email,name\nanna@example.com,Anna\n");
    expect(header).toEqual(["email", "name"]);
    expect(rows).toEqual([["anna@example.com", "Anna"]]);
  });

  it("parses semicolon files with commas inside quoted values", () => {
    const { header, rows } = parseCsv('email;company\njan@x.pl;"Firma, sp. z o.o."\n');
    expect(header).toEqual(["email", "company"]);
    expect(rows).toEqual([["jan@x.pl", "Firma, sp. z o.o."]]);
  });

  it("unescapes doubled quotes and skips CR and empty lines", () => {
    const { rows } = parseCsv('email,note\r\n\r\nx@y.z,"po ""cudzyslowie"""\r\n');
    expect(rows).toEqual([["x@y.z", 'po "cudzyslowie"']]);
  });

  it("keeps the last row without a trailing newline", () => {
    const { rows } = parseCsv("email\na@b.c\nd@e.f");
    expect(rows).toEqual([["a@b.c"], ["d@e.f"]]);
  });
});
