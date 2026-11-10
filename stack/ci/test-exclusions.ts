import { readFileSync } from "node:fs";
import { isRecord } from "./lib.ts";

const FIELDS = ["package", "name", "file", "reason", "evidence", "removeWhen"] as const;

export type TestExclusion = Record<(typeof FIELDS)[number], string>;

export function parseExclusions(text: string): TestExclusion[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("Test exclusions must be a JSON array");
  return parsed.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Test exclusion ${index} must be an object`);
    const unknownKeys = Object.keys(entry).filter((key) => !(FIELDS as readonly string[]).includes(key));
    if (unknownKeys.length > 0) throw new Error(`Test exclusion ${index} has unknown fields: ${unknownKeys.join(", ")}`);
    for (const field of FIELDS) {
      const value = entry[field];
      if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`Test exclusion ${index} needs a non-empty string "${field}"`);
      }
    }
    return entry as TestExclusion;
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

export function exclusionPattern(exclusions: readonly TestExclusion[], packageName: string): string {
  const names = [...new Set(exclusions.filter((entry) => entry.package === packageName).map((entry) => entry.name))];
  if (names.length === 0) return "";
  return `^(?!(?:${names.map(escapeRegExp).join("|")})$)`;
}

if (import.meta.main) {
  const [packageName, ...rest] = process.argv.slice(2);
  if (!packageName || rest.length > 0) throw new Error("Usage: test-exclusions.ts <workspace-package>");
  const file = new URL("./test-exclusions.json", import.meta.url);
  const pattern = exclusionPattern(parseExclusions(readFileSync(file, "utf8")), packageName);
  if (pattern !== "") console.log(pattern);
}
