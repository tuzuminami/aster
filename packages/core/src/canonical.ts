import { createHash } from "node:crypto";

export const ASTER_CANONICALIZATION = "aster-canonical-json/1";
export const ASTER_INTEGRITY_ENCODING = "utf-8";

export const canonicalJson = (value: unknown): string => JSON.stringify(canonicalize(value));

export const sha256Hex = (value: unknown): string =>
  createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value), "utf8").digest("hex");

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        const item = record[key];
        if (item !== undefined) {
          accumulator[key] = canonicalize(item);
        }
        return accumulator;
      }, {});
  }
  return value;
};
