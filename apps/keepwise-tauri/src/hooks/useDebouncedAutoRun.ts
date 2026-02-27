import { useEffect, useRef } from "react";

export function useDebouncedAutoRun(
  task: () => void | Promise<void>,
  deps: ReadonlyArray<unknown>,
  options?: { enabled?: boolean; delayMs?: number },
) {
  const taskRef = useRef(task);
  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  const enabled = options?.enabled ?? true;
  const delayMs = options?.delayMs ?? 260;

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => {
      void taskRef.current();
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [enabled, delayMs, ...deps]);
}
