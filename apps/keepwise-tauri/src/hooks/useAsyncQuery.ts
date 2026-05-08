import { startTransition, useCallback, useState, type Dispatch, type SetStateAction } from "react";

export type AsyncQueryState<TReq, TRes> = {
  busy: boolean;
  error: string;
  result: TRes | null;
  query: TReq;
  setQuery: Dispatch<SetStateAction<TReq>>;
  setError: Dispatch<SetStateAction<string>>;
  setResult: Dispatch<SetStateAction<TRes | null>>;
  run: (overrideReq?: TReq) => Promise<TRes>;
  lastRunAt: number | null;
};

export function useAsyncQuery<TReq, TRes>(
  apiFn: (req: TReq) => Promise<TRes>,
  initialQuery: TReq,
  errorMessage?: (err: unknown) => string,
): AsyncQueryState<TReq, TRes> {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TRes | null>(null);
  const [query, setQuery] = useState<TReq>(initialQuery);
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);

  const run = useCallback(
    async (overrideReq?: TReq) => {
      const req = overrideReq ?? query;
      setBusy(true);
      setError("");
      try {
        const payload = await apiFn(req);
        startTransition(() => {
          setResult(payload);
          setLastRunAt(Date.now());
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
    lastRunAt,
  };
}
