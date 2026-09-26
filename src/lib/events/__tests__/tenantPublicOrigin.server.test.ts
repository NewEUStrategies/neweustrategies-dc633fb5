// Publiczny adres najemcy w linkach wiadomości.
//
// STAWKA (R12): zadanie w tle działa bez nagłówka hosta. Link zbudowany ze
// stałej wysłałby uczestnika najemcy B na stronę najemcy A. Katalog najemców
// jest atrapą (granica: baza), reszta - prawdziwa.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TenantDirectory, TenantDirectoryEntry } from "@/lib/server/tenant.server";

const dir = vi.hoisted(() => ({ getTenantDirectory: vi.fn() }));
vi.mock("@/lib/server/tenant.server", () => dir);

import {
  DEFAULT_PUBLIC_ORIGIN,
  tenantPublicOrigin,
  tenantPublicUrl,
} from "@/lib/events/tenantPublicOrigin.server";

const A: TenantDirectoryEntry = {
  id: "tenant-a",
  slug: "a",
  domain: "a.example.org",
  isDefault: true,
};
const B: TenantDirectoryEntry = {
  id: "tenant-b",
  slug: "b",
  domain: "B.Example.com",
  isDefault: false,
};

function directory(
  entries: TenantDirectoryEntry[],
  defaultTenant: TenantDirectoryEntry | null,
): TenantDirectory {
  const byDomain = new Map<string, TenantDirectoryEntry>();
  for (const entry of entries) {
    if (entry.domain) byDomain.set(entry.domain.toLowerCase(), entry);
  }
  return { byDomain, defaultTenant };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("tenantPublicOrigin", () => {
  it("domena najemcy z katalogu (małe litery)", async () => {
    dir.getTenantDirectory.mockResolvedValue(directory([A, B], A));
    await expect(tenantPublicOrigin("tenant-b")).resolves.toBe("https://b.example.com");
    await expect(tenantPublicOrigin("tenant-a")).resolves.toBe("https://a.example.org");
  });

  it("najemca bez domeny -> domena najemcy domyślnego", async () => {
    dir.getTenantDirectory.mockResolvedValue(directory([A], A));
    await expect(tenantPublicOrigin("tenant-c")).resolves.toBe("https://a.example.org");
  });

  it("brak najemcy domyślnego albo jego domeny -> stała", async () => {
    dir.getTenantDirectory.mockResolvedValue(directory([B], null));
    await expect(tenantPublicOrigin("tenant-c")).resolves.toBe(DEFAULT_PUBLIC_ORIGIN);
    dir.getTenantDirectory.mockResolvedValue(
      directory([], { id: "d", slug: "d", domain: "  ", isDefault: true }),
    );
    await expect(tenantPublicOrigin("tenant-c")).resolves.toBe(DEFAULT_PUBLIC_ORIGIN);
    dir.getTenantDirectory.mockResolvedValue(
      directory([], { id: "d", slug: "d", domain: null, isDefault: true }),
    );
    await expect(tenantPublicOrigin("tenant-c")).resolves.toBe(DEFAULT_PUBLIC_ORIGIN);
  });

  it("nigdy nie rzuca - awaria katalogu daje stałą", async () => {
    dir.getTenantDirectory.mockRejectedValue(new Error("db down"));
    await expect(tenantPublicOrigin("tenant-a")).resolves.toBe(DEFAULT_PUBLIC_ORIGIN);
    expect(console.warn).toHaveBeenCalled();
  });

  it("stała to domena marki", () => {
    expect(DEFAULT_PUBLIC_ORIGIN).toBe("https://neweuropeanstrategies.com");
  });
});

describe("tenantPublicUrl", () => {
  beforeEach(() => {
    dir.getTenantDirectory.mockResolvedValue(directory([A, B], A));
  });

  it("PL bez prefiksu, EN z /en", async () => {
    await expect(tenantPublicUrl("tenant-b", "/events/forum", "pl")).resolves.toBe(
      "https://b.example.com/events/forum",
    );
    await expect(tenantPublicUrl("tenant-b", "/events/forum", "en")).resolves.toBe(
      "https://b.example.com/en/events/forum",
    );
  });

  it("zapytanie i fragment zostają nietknięte (link gościa w fragmencie)", async () => {
    await expect(
      tenantPublicUrl("tenant-a", "/events/forum/me?tab=schedule#event-session-1", "en"),
    ).resolves.toBe("https://a.example.org/en/events/forum/me?tab=schedule#event-session-1");
    await expect(tenantPublicUrl("tenant-a", "/events/forum/follow-up#t=abc", "pl")).resolves.toBe(
      "https://a.example.org/events/forum/follow-up#t=abc",
    );
  });

  it("ścieżki nielokalizowane (/profile) bez prefiksu i ścieżka już z prefiksem", async () => {
    await expect(tenantPublicUrl("tenant-a", "/profile/tickets", "en")).resolves.toBe(
      "https://a.example.org/profile/tickets",
    );
    await expect(tenantPublicUrl("tenant-a", "/en/events/forum", "pl")).resolves.toBe(
      "https://a.example.org/events/forum",
    );
  });
});
