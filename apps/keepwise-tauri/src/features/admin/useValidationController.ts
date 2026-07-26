import { startTransition, useState } from "react";

import { queryInvestmentCurve, queryInvestmentReturn, queryWealthCurve, queryWealthOverview, type LedgerDbImportRepoRuntimeResult } from "../../api/desktop";
import { makeInitialSmokeRows, withSmokeResult } from "../../app/helpers";
import {
  buildInvestmentCurveRequest, buildInvestmentReturnRequest, buildWealthCurveRequest,
  buildWealthOverviewRequest, toErrorMessage,
} from "../../app/requestBuilders";
import {
  summarizeInvestmentCurvePayload, summarizeInvestmentReturnPayload,
  summarizeWealthCurvePayload, summarizeWealthOverviewPayload,
} from "../../app/summaries";
import { type PipelineStatus, type SmokeRow } from "../../types/app";
import { useInvestmentController } from "../investment/useInvestmentController";
import { useWealthController } from "../wealth/useWealthController";

export function useValidationController({
  investment,
  wealth,
  dbImportPath,
  importDatabase,
  refreshHealth,
}: {
  investment: ReturnType<typeof useInvestmentController>;
  wealth: ReturnType<typeof useWealthController>;
  dbImportPath: string;
  importDatabase: () => Promise<LedgerDbImportRepoRuntimeResult>;
  refreshHealth: () => Promise<void>;
}) {
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>("idle");
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [pipelineLastRunAt, setPipelineLastRunAt] = useState<number | null>(null);
  const [pipelineMessage, setPipelineMessage] = useState("");
  const [smokeBusy, setSmokeBusy] = useState(false);
  const [smokeRows, setSmokeRows] = useState<SmokeRow[]>(() => makeInitialSmokeRows());
  const [smokeLastRunAt, setSmokeLastRunAt] = useState<number | null>(null);

  async function runSmokeSequence(): Promise<SmokeRow[]> {
    setSmokeBusy(true);
    let nextRows = makeInitialSmokeRows();
    startTransition(() => setSmokeRows(nextRows));
    const commit = (row: SmokeRow) => {
      nextRows = withSmokeResult(nextRows, row);
      startTransition(() => setSmokeRows(nextRows));
    };
    const runOne = async <T,>(
      base: Pick<SmokeRow, "key" | "label">,
      run: () => Promise<T>,
      onSuccess: (payload: T) => void,
      onError: (message: string) => void,
      summarize: (payload: T) => string,
    ) => {
      const started = Date.now();
      try {
        const payload = await run(); onSuccess(payload);
        commit({ ...base, status: "pass", durationMs: Date.now() - started, detail: summarize(payload) });
      } catch (err) {
        const message = toErrorMessage(err); onError(message);
        commit({ ...base, status: "fail", durationMs: Date.now() - started, detail: message });
      }
    };
    try {
      await runOne(
        { key: "investment-return", label: "投资区间收益率" },
        () => queryInvestmentReturn(buildInvestmentReturnRequest(investment.query)),
        (payload) => { startTransition(() => { investment.setResult(payload); investment.setError(""); }); },
        investment.setError, summarizeInvestmentReturnPayload,
      );
      await runOne(
        { key: "investment-curve", label: "投资曲线" },
        () => queryInvestmentCurve(buildInvestmentCurveRequest(investment.curveQuery)),
        (payload) => { startTransition(() => { investment.setCurveResult(payload); investment.setCurveError(""); }); },
        investment.setCurveError, summarizeInvestmentCurvePayload,
      );
      await runOne(
        { key: "wealth-overview", label: "财富总览" },
        () => queryWealthOverview(buildWealthOverviewRequest(wealth.overviewQuery, wealth.curveQuery)),
        (payload) => { startTransition(() => { wealth.setOverviewResult(payload); wealth.setOverviewError(""); }); },
        wealth.setOverviewError, summarizeWealthOverviewPayload,
      );
      await runOne(
        { key: "wealth-curve", label: "财富曲线" },
        () => queryWealthCurve(buildWealthCurveRequest(wealth.curveQuery)),
        (payload) => { startTransition(() => { wealth.setCurveResult(payload); wealth.setCurveError(""); }); },
        wealth.setCurveError, summarizeWealthCurvePayload,
      );
      startTransition(() => setSmokeLastRunAt(Date.now()));
      return nextRows;
    } finally { setSmokeBusy(false); }
  }

  async function runSmoke() { await runSmokeSequence(); }

  async function runPipeline() {
    if (pipelineBusy) return;
    setPipelineBusy(true); setPipelineStatus("running"); setPipelineMessage("");
    try {
      if (!dbImportPath.trim()) {
        startTransition(() => { setPipelineStatus("fail"); setPipelineLastRunAt(Date.now()); setPipelineMessage("请先选择要导入的 keepwise.db 文件"); });
        return;
      }
      const imported = await importDatabase();
      const rows = await runSmokeSequence();
      void refreshHealth();
      const passed = rows.every((row) => row.status === "pass");
      startTransition(() => {
        setPipelineStatus(passed ? "pass" : "fail"); setPipelineLastRunAt(Date.now());
        setPipelineMessage(`导入成功 from selected path | copied=${imported.copied_bytes} bytes | smoke ${passed ? "PASS" : "FAIL"}`);
      });
    } catch (err) {
      startTransition(() => { setPipelineStatus("fail"); setPipelineLastRunAt(Date.now()); setPipelineMessage(toErrorMessage(err)); });
    } finally { setPipelineBusy(false); }
  }

  return { pipelineStatus, pipelineBusy, pipelineLastRunAt, pipelineMessage, smokeBusy, smokeRows, smokeLastRunAt, runSmoke, runPipeline };
}
