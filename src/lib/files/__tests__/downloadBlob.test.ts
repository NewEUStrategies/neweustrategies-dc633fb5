// Pobieranie pliku zbudowanego w przeglądarce.
//
// STAWKI: (1) adres `blob:` zwalniany PO sekundzie, nie od razu - natychmiastowe
// `revokeObjectURL` gubi plik w Safari i części Chromium; (2) kotwica nie
// zostaje w dokumencie; (3) BOM tylko na żądanie (CSV dla Excela), bo
// kalendarzom i parserom szkodzi; (4) bajty base64 trafiają do pliku 1:1.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OBJECT_URL_REVOKE_DELAY_MS,
  downloadBase64File,
  downloadBase64Pdf,
  downloadBlob,
  downloadTextFile,
} from "@/lib/files/downloadBlob";

let created: Blob[] = [];
let clicked: { href: string; download: string; attached: boolean }[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  created = [];
  clicked = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob: Blob | MediaSource) => {
    created.push(blob as Blob);
    return `blob:test-${created.length}`;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ href: this.href, download: this.download, attached: this.isConnected });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("downloadBlob", () => {
  it("klika kotwicę z nazwą pliku, sprząta ją i zwalnia adres po sekundzie", () => {
    downloadBlob(new Blob(["x"]), "plan.ics");
    expect(clicked).toEqual([{ href: "blob:test-1", download: "plan.ics", attached: true }]);
    expect(document.querySelector("a[download]")).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(OBJECT_URL_REVOKE_DELAY_MS - 1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-1");
    expect(OBJECT_URL_REVOKE_DELAY_MS).toBe(1000);
  });
});

describe("downloadBase64File / downloadBase64Pdf", () => {
  it("bajty 1:1 i typ MIME", async () => {
    downloadBase64File(btoa("\u0000ÿ%PDF"), "a.bin", "application/octet-stream");
    expect(created[0].type).toBe("application/octet-stream");
    expect([...new Uint8Array(await created[0].arrayBuffer())]).toEqual([0, 255, 37, 80, 68, 70]);
  });

  it("PDF", () => {
    downloadBase64Pdf(btoa("%PDF-1.7"), "certyfikat.pdf");
    expect(created[0].type).toBe("application/pdf");
    expect(clicked[0].download).toBe("certyfikat.pdf");
  });
});

describe("downloadTextFile", () => {
  it("domyślnie bez BOM", async () => {
    downloadTextFile("BEGIN:VCALENDAR", "plan.ics", "text/calendar;charset=utf-8");
    expect(created[0].type).toBe("text/calendar;charset=utf-8");
    expect(await created[0].text()).toBe("BEGIN:VCALENDAR");
  });

  it("z BOM na żądanie (CSV dla Excela)", async () => {
    downloadTextFile("a;b", "wyniki.csv", "text/csv;charset=utf-8", true);
    const bytes = new Uint8Array(await created[0].arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(await created[0].text()).toBe("﻿a;b");
  });
});
