// Idempotencja komend end-to-end (spójność między modułami, część 4/5).
//
// Frontend generuje klucz idempotencji per AKCJA użytkownika (nie per próba -
// retry i podwójny klik współdzielą klucz), serwer "claimuje" komendę w
// public.command_idempotency zanim wykona pracę:
//   * pierwszy claim wygrywa i wykonuje run();
//   * duplikat ze statusem succeeded dostaje zapamiętany wynik (replay);
//   * duplikat in_progress dostaje błąd "spróbuj ponownie" zamiast
//     zdublowanego efektu ubocznego.
// Correlation id żądania (x-correlation-id) jest zapisywany przy claimie,
// więc getCorrelatedEvents łączy komendę z jej zdarzeniami domenowymi.
import { newCorrelationId } from "@/lib/realtime/correlationContext";

/** Klucz idempotencji dla akcji użytkownika: `<komenda>:<uuid>`. */
export function newIdempotencyKey(command: string): string {
  return `${command}:${newCorrelationId()}`;
}

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

/** Minimalny strukturalny typ klienta z RPC (user-scoped klient z middleware). */
export interface RpcClient {
  rpc: (
    fn: "claim_command" | "complete_command",
    args: Record<string, unknown>,
  ) => PromiseLike<RpcResult>;
}

interface ClaimResponse {
  claimed: boolean;
  status: string;
  result?: unknown;
}

function parseClaim(data: unknown): ClaimResponse {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    return {
      claimed: record.claimed === true,
      status: typeof record.status === "string" ? record.status : "invalid",
      result: record.result,
    };
  }
  return { claimed: false, status: "invalid" };
}

export class CommandInProgressError extends Error {
  constructor(command: string) {
    super(`Command ${command} is already in progress - retry in a moment`);
    this.name = "CommandInProgressError";
  }
}

export interface IdempotentOutcome<T> {
  /** true = wynik odtworzony z poprzedniego wykonania (duplikat komendy). */
  replayed: boolean;
  result: T;
}

/**
 * Wykonaj komendę pod ochroną klucza idempotencji. `run()` musi zwracać
 * wartość serializowalną do JSON (ląduje w command_idempotency.result i jest
 * odtwarzana przy replayu).
 */
export async function withCommandIdempotency<T>(
  client: RpcClient,
  options: { key: string; command: string; run: () => Promise<T> },
): Promise<IdempotentOutcome<T>> {
  const { key, command, run } = options;
  const { data, error } = await client.rpc("claim_command", {
    p_key: key,
    p_command: command,
  });
  if (error) throw new Error(`idempotency claim failed: ${error.message}`);
  const claim = parseClaim(data);

  if (!claim.claimed) {
    if (claim.status === "succeeded") {
      return { replayed: true, result: claim.result as T };
    }
    if (claim.status === "in_progress") {
      throw new CommandInProgressError(command);
    }
    if (claim.status === "conflict" || claim.status === "invalid") {
      throw new Error(`idempotency: cannot claim command (${claim.status})`);
    }
    // status 'failed': poprzednia próba poległa - wykonujemy ponownie niżej.
  }

  try {
    const result = await run();
    await client.rpc("complete_command", {
      p_key: key,
      p_succeeded: true,
      p_result: result === undefined ? null : result,
    });
    return { replayed: false, result };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    await client.rpc("complete_command", {
      p_key: key,
      p_succeeded: false,
      p_result: { message },
    });
    throw e;
  }
}
