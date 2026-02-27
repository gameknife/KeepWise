import { startTransition, useCallback, useState } from "react";

export function useAsyncQuery<TReq, TRes>(
  apiFn: (req: TReq) => Promise<TRes>,
  initialQuery: TReq,
  errorMessage?: (err: unknown) => string,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TRes | null>(null);
  const [query, setQuery] = useState<TReq>(initialQuery);

  const run = useCallback(
    async (overrideReq?: TReq) => {
      const req = overrideReq ?? query;
      setBusy(true);
      setError("");
      try {
        const payload = await apiFn(req);
        startTransition(() => {
          setResult(payload);
        });
        return payload;
      } catch (err) {
        const message = errorMessage
          ? errorMessage(err)
          : err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "Unknown error";
        setError(message);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [apiFn, errorMessage, query],
  );

  return {
    busy,
    error,
    result,
    query,
    setQuery,
    setError,
    setResult,
    run,
  };
}
