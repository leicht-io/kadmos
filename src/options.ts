/** Reads a boolean-ish option such as `data-dimensions="false"`. */
export function parseFlag(
  raw: string | boolean | null | undefined,
): boolean | undefined {
  if (typeof raw === "boolean") {
    return raw;
  }

  const value = raw?.trim().toLowerCase();
  if (value === "true" || value === "1" || value === "on") {
    return true;
  }
  if (value === "false" || value === "0" || value === "off") {
    return false;
  }

  return undefined;
}
