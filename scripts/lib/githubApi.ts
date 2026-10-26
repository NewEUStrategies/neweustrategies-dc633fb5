/**
 * Minimalny klient REST API GitHuba dla skryptów governance (bez zależności).
 * Token: `GH_TOKEN` albo `GITHUB_TOKEN`; bez tokena działają tylko publiczne
 * odczyty (repozytorium jest publiczne, limit 60 zapytań na godzinę).
 */
import { spawnSync } from "node:child_process";

const API = "https://api.github.com";

/** `owner/name` z `GITHUB_REPOSITORY` (Actions) albo z adresu `origin`. */
export function githubRepository(): string {
  const fromEnv = process.env["GITHUB_REPOSITORY"];
  if (fromEnv) return fromEnv;
  const remote = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" });
  const match = /([^/:]+)\/([^/]+?)(?:\.git)?\s*$/.exec(remote.stdout ?? "");
  if (!match) throw new Error("nie ustalono repozytorium: ustaw GITHUB_REPOSITORY=owner/name");
  return `${match[1]}/${match[2]}`;
}

export async function githubApi<T>(
  path: string,
  init: { readonly method?: string; readonly body?: unknown } = {},
): Promise<T> {
  const token = process.env["GH_TOKEN"] ?? process.env["GITHUB_TOKEN"];
  const response = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(
      `${init.method ?? "GET"} ${path}: HTTP ${response.status} ${text.slice(0, 400)}`,
    );
  return (text === "" ? null : JSON.parse(text)) as T;
}
