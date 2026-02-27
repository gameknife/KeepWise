export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const part of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

export function readString(root: unknown, path: string): string | undefined {
  const value = readPath(root, path);
  return typeof value === "string" ? value : undefined;
}

export function readNumber(root: unknown, path: string): number | undefined {
  const value = readPath(root, path);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readBool(root: unknown, path: string): boolean | undefined {
  const value = readPath(root, path);
  return typeof value === "boolean" ? value : undefined;
}

export function readArray(root: unknown, path: string): unknown[] {
  const value = readPath(root, path);
  return Array.isArray(value) ? value : [];
}
