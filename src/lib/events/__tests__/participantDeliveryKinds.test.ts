// Katalog dziennika doręczeń: PARYTET z nazwanymi CHECK-ami i pełne klucze etykiet.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DELIVERY_CHANNELS,
  DELIVERY_CHANNEL_LABEL_KEYS,
  DELIVERY_KINDS,
  DELIVERY_KIND_LABEL_KEYS,
  DELIVERY_STATUSES,
  DELIVERY_STATUS_LABEL_KEYS,
  isDeliveryChannel,
  isDeliveryKind,
  isDeliveryStatus,
} from "@/lib/events/participantDeliveryKinds";

const DIR = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(DIR).filter((name) => name.endsWith("_event_participant_foundation.sql"));
const SQL = readFileSync(join(DIR, files[0]), "utf8");

function checkValues(constraint: string): string[] {
  const re = new RegExp(`CONSTRAINT ${constraint}\\s+CHECK \\([a-z_]+ IN \\(([^)]*)\\)\\)`);
  const match = re.exec(SQL);
  expect(match, constraint).not.toBeNull();
  return (match?.[1] ?? "")
    .split(",")
    .map((value) => value.trim().replace(/^'|'$/g, ""))
    .filter((value) => value !== "");
}

function camel(value: string): string {
  return value.replace(/_([a-z])/g, (_all, chr: string) => chr.toUpperCase());
}

describe("parytet z migracją", () => {
  it("migracja jest jedna (szukana po sufiksie)", () => {
    expect(files).toHaveLength(1);
  });

  it("rodzaje = event_message_deliveries_kind_values", () => {
    expect(checkValues("event_message_deliveries_kind_values")).toEqual([...DELIVERY_KINDS]);
    expect(DELIVERY_KINDS).toHaveLength(11);
  });

  it("kanały = event_message_deliveries_channel_values", () => {
    expect(checkValues("event_message_deliveries_channel_values")).toEqual([...DELIVERY_CHANNELS]);
  });

  it("stany = event_message_deliveries_status_values", () => {
    expect(checkValues("event_message_deliveries_status_values")).toEqual([...DELIVERY_STATUSES]);
  });
});

describe("etykiety - pełne, literalne klucze", () => {
  it.each(DELIVERY_KINDS.map((kind) => [kind]))("rodzaj %s", (kind) => {
    expect(DELIVERY_KIND_LABEL_KEYS[kind]).toBe(
      `adminEventParticipant.deliveries.kind.${camel(kind)}`,
    );
  });

  it.each(DELIVERY_CHANNELS.map((channel) => [channel]))("kanał %s", (channel) => {
    expect(DELIVERY_CHANNEL_LABEL_KEYS[channel]).toBe(
      `adminEventParticipant.deliveries.channel.${channel}`,
    );
  });

  it.each(DELIVERY_STATUSES.map((status) => [status]))("stan %s", (status) => {
    expect(DELIVERY_STATUS_LABEL_KEYS[status]).toBe(
      `adminEventParticipant.deliveries.status.${status}`,
    );
  });

  it("mapy nie mają kluczy spoza katalogu", () => {
    expect(Object.keys(DELIVERY_KIND_LABEL_KEYS)).toEqual([...DELIVERY_KINDS]);
    expect(Object.keys(DELIVERY_CHANNEL_LABEL_KEYS)).toEqual([...DELIVERY_CHANNELS]);
    expect(Object.keys(DELIVERY_STATUS_LABEL_KEYS)).toEqual([...DELIVERY_STATUSES]);
  });
});

describe("strażnicy typów", () => {
  it("rodzaj", () => {
    expect(isDeliveryKind("survey_invite")).toBe(true);
    expect(isDeliveryKind("newsletter")).toBe(false);
    expect(isDeliveryKind(1)).toBe(false);
  });

  it("kanał", () => {
    expect(isDeliveryChannel("inapp")).toBe(true);
    expect(isDeliveryChannel("push")).toBe(false);
    expect(isDeliveryChannel(null)).toBe(false);
  });

  it("stan", () => {
    expect(isDeliveryStatus("skipped")).toBe(true);
    expect(isDeliveryStatus("queued")).toBe(false);
    expect(isDeliveryStatus(undefined)).toBe(false);
  });
});
