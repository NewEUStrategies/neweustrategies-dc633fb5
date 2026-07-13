import { describe, it, expect } from "vitest";
import { isPrivateOrReservedIp, assertPublicHttpUrl } from "@/lib/http/egressGuard.server";

describe("isPrivateOrReservedIp", () => {
  it("flags private / loopback / link-local / metadata IPv4", () => {
    for (const ip of [
      "10.0.0.1",
      "127.0.0.1",
      "169.254.169.254", // cloud metadata
      "192.168.1.1",
      "172.16.0.1",
      "172.31.255.255",
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "224.0.0.1", // multicast
    ]) {
      expect(isPrivateOrReservedIp(ip)).toBe(true);
    }
  });

  it("allows public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34"]) {
      expect(isPrivateOrReservedIp(ip)).toBe(false);
    }
  });

  it("flags loopback / link-local / ULA / IPv4-mapped IPv6", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateOrReservedIp(ip)).toBe(true);
    }
  });

  it("allows public IPv6", () => {
    expect(isPrivateOrReservedIp("2606:4700:4700::1111")).toBe(false);
  });

  it("refuses anything that is not a recognisable IP", () => {
    expect(isPrivateOrReservedIp("not-an-ip")).toBe(true);
  });
});

describe("assertPublicHttpUrl (paths that never touch DNS)", () => {
  it("rejects non-https schemes", async () => {
    await expect(assertPublicHttpUrl("http://example.com/")).rejects.toThrow(/blocked_url:scheme/);
    await expect(assertPublicHttpUrl("ftp://example.com/")).rejects.toThrow(/blocked_url:scheme/);
  });

  it("rejects unparseable input", async () => {
    await expect(assertPublicHttpUrl("not a url")).rejects.toThrow(/blocked_url:unparseable/);
  });

  it("rejects literal private / metadata IP hosts", async () => {
    for (const u of [
      "https://169.254.169.254/latest/meta-data/",
      "https://127.0.0.1/",
      "https://10.0.0.1/",
      "https://[::1]/",
    ]) {
      await expect(assertPublicHttpUrl(u)).rejects.toThrow(/blocked_url:ip/);
    }
  });

  it("rejects localhost and internal-only suffixes", async () => {
    for (const u of ["https://localhost/", "https://svc.internal/", "https://db.local/"]) {
      await expect(assertPublicHttpUrl(u)).rejects.toThrow(/blocked_url:host/);
    }
  });

  it("allows a literal public IP host without a DNS lookup", async () => {
    const url = await assertPublicHttpUrl("https://8.8.8.8/hook");
    expect(url.hostname).toBe("8.8.8.8");
  });
});
