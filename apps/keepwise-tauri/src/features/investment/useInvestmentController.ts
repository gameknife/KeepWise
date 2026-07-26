import { startTransition, useRef, useState } from "react";

import {
  queryInvestmentCurve,
  queryInvestmentCurveBenchmarks,
  queryInvestmentReturn,
  queryInvestmentReturns,
  type InvestmentCurvePayload,
  type InvestmentCurveQueryRequest,
  type InvestmentReturnPayload,
  type InvestmentReturnsPayload,
} from "../../api/desktop";
import {
  buildInvestmentCurveRequest,
  buildInvestmentReturnRequest,
  buildInvestmentReturnsRequest,
  buildReturnTabQuickMetricRequest,
} from "../../app/requestBuilders";
import { type BenchmarkMarketDataSource } from "../../types/app";
import { readNumber } from "../../utils/value";

export type InvestmentAnalysisQuery = {
  account_id: string;
  preset: string;
  from: string;
  to: string;
};

function toErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
}

export function useInvestmentController({ benchmarkSource }: { benchmarkSource: BenchmarkMarketDataSource }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<InvestmentReturnPayload | null>(null);
  const [lastQueryKey, setLastQueryKey] = useState("");
  const [query, setQuery] = useState<InvestmentAnalysisQuery>({
    account_id: "__portfolio__", preset: "ytd", from: "", to: "",
  });
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState("");
  const [batchResult, setBatchResult] = useState<InvestmentReturnsPayload | null>(null);
  const [batchLastQueryKey, setBatchLastQueryKey] = useState("");
  const [curveBusy, setCurveBusy] = useState(false);
  const [curveError, setCurveError] = useState("");
  const [curveResult, setCurveResult] = useState<InvestmentCurvePayload | null>(null);
  const [curveBenchmarksBusy, setCurveBenchmarksBusy] = useState(false);
  const [curveLastQueryKey, setCurveLastQueryKey] = useState("");
  const [curveQuery, setCurveQuery] = useState<InvestmentAnalysisQuery>({
    account_id: "__portfolio__", preset: "ytd", from: "", to: "",
  });
  const [ytdAnnualizedRate, setYtdAnnualizedRate] = useState<number | null>(null);
  const [ytdNetGrowthCents, setYtdNetGrowthCents] = useState<number | null>(null);
  const curveRequestSeqRef = useRef(0);
  const curveRequestRef = useRef<InvestmentCurveQueryRequest | null>(null);

  function setSharedQuery(updater: (previous: InvestmentAnalysisQuery) => InvestmentAnalysisQuery) {
    setCurveQuery((previous) => {
      const next = updater(previous);
      setQuery(next);
      return next;
    });
  }

  async function refreshReturn() {
    const request = buildInvestmentReturnRequest(query);
    const queryKey = JSON.stringify(request);
    setBusy(true);
    setError("");
    try {
      const [payload, quickMetricPayload] = await Promise.all([
        queryInvestmentReturn(request),
        queryInvestmentReturn(buildReturnTabQuickMetricRequest(query)),
      ]);
      startTransition(() => {
        setResult(payload);
        setLastQueryKey(queryKey);
        setYtdAnnualizedRate(readNumber(quickMetricPayload, "metrics.annualized_rate") ?? null);
        setYtdNetGrowthCents(readNumber(quickMetricPayload, "metrics.net_growth_cents") ?? null);
      });
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function refreshReturns() {
    const request = buildInvestmentReturnsRequest(curveQuery);
    const queryKey = JSON.stringify(request);
    setBatchBusy(true);
    setBatchError("");
    try {
      const payload = await queryInvestmentReturns(request);
      startTransition(() => {
        setBatchResult(payload);
        setBatchLastQueryKey(queryKey);
      });
    } catch (err) {
      setBatchError(toErrorMessage(err));
    } finally {
      setBatchBusy(false);
    }
  }

  async function hydrateBenchmarks(request: InvestmentCurveQueryRequest, requestSeq: number) {
    if (requestSeq !== curveRequestSeqRef.current) return;
    setCurveBenchmarksBusy(true);
    try {
      const benchmarks = await queryInvestmentCurveBenchmarks({ ...request, benchmark_source: benchmarkSource });
      if (requestSeq !== curveRequestSeqRef.current) return;
      startTransition(() => setCurveResult((previous) => previous ? { ...previous, benchmarks } : previous));
    } catch {
      if (requestSeq !== curveRequestSeqRef.current) return;
      startTransition(() => setCurveResult((previous) => previous ? {
        ...previous,
        benchmarks: {
          source: "",
          summary: { requested_count: 0, available_count: 0, warning_count: 1 },
          curves: [],
          warnings: ["拉取对比指标失败"],
          load_failed: true,
        },
      } : previous));
    } finally {
      if (requestSeq === curveRequestSeqRef.current) setCurveBenchmarksBusy(false);
    }
  }

  function scheduleBenchmarkHydration(request: InvestmentCurveQueryRequest, requestSeq: number) {
    const run = () => void hydrateBenchmarks(request, requestSeq);
    if (typeof window === "undefined") {
      setTimeout(run, 0);
    } else if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => window.setTimeout(run, 0));
    } else {
      window.setTimeout(run, 0);
    }
  }

  async function refreshCurve() {
    const request = buildInvestmentCurveRequest(curveQuery);
    const queryKey = JSON.stringify(request);
    const requestSeq = curveRequestSeqRef.current + 1;
    curveRequestSeqRef.current = requestSeq;
    curveRequestRef.current = request;
    setCurveBusy(true);
    setCurveError("");
    try {
      const payload = await queryInvestmentCurve(request);
      if (requestSeq !== curveRequestSeqRef.current) return;
      startTransition(() => {
        setCurveResult(payload);
        setCurveLastQueryKey(queryKey);
      });
      scheduleBenchmarkHydration(request, requestSeq);
    } catch (err) {
      if (requestSeq === curveRequestSeqRef.current) setCurveError(toErrorMessage(err));
    } finally {
      if (requestSeq === curveRequestSeqRef.current) setCurveBusy(false);
    }
  }

  async function retryBenchmarks() {
    const request = curveRequestRef.current ?? buildInvestmentCurveRequest(curveQuery);
    curveRequestRef.current = request;
    await hydrateBenchmarks(request, curveRequestSeqRef.current);
  }

  return {
    busy, error, result, lastQueryKey, query, setQuery,
    batchBusy, batchError, batchResult, batchLastQueryKey,
    curveBusy, curveError, curveResult, curveBenchmarksBusy, curveLastQueryKey, curveQuery, setCurveQuery,
    ytdAnnualizedRate, ytdNetGrowthCents,
    setResult, setError, setCurveResult, setCurveError,
    setSharedQuery, refreshReturn, refreshReturns, refreshCurve, retryBenchmarks,
  };
}
