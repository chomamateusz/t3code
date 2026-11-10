import { appendFileSync, existsSync, readFileSync } from "node:fs";

export function parseJsonRecords(text: string): unknown[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("Expected a JSON array");
    return parsed;
  }
  return trimmed.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line));
}

export function readOptionalJson(path: string | undefined): unknown {
  if (!path || !existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8").trim();
  return text === "" ? undefined : JSON.parse(text);
}

export function writeGithubOutput(values: Record<string, string | number | boolean>): void {
  const target = process.env.GITHUB_OUTPUT;
  if (!target) throw new Error("GITHUB_OUTPUT is not set");
  for (const [key, value] of Object.entries(values)) {
    const text = String(value);
    if (text.includes("\n")) throw new Error(`Output ${key} must be a single line`);
    appendFileSync(target, `${key}=${text}\n`);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
