import { invoke as tauriInvoke } from "@tauri-apps/api/core";

function normalizeTauriValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    const min = BigInt(Number.MIN_SAFE_INTEGER);
    if (value <= max && value >= min) return Number(value);
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeTauriValue(item));
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = normalizeTauriValue(item);
    }
    return out;
  }

  return value;
}

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const raw = await tauriInvoke<unknown>(command, args);
  return normalizeTauriValue(raw) as T;
}
