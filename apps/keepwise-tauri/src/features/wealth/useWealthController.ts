import { startTransition, useState } from "react";

import { queryWealthCurve, queryWealthOverview, type WealthCurvePayload, type WealthOverviewPayload } from "../../api/desktop";
import { buildWealthCurveRequest, buildWealthOverviewRequest, toErrorMessage } from "../../app/requestBuilders";
import { type BoolString } from "../../types/app";

export type WealthAssetFilters = {
  include_investment: BoolString;
  include_cash: BoolString;
  include_real_estate: BoolString;
  include_liability: BoolString;
};
export type WealthOverviewQuery = WealthAssetFilters & { as_of: string };
export type WealthCurveQuery = WealthAssetFilters & { preset: string; from: string; to: string };

const initialFilters: WealthAssetFilters = {
  include_investment: "true",
  include_cash: "true",
  include_real_estate: "true",
  include_liability: "true",
};

export function useWealthController() {
  const [overviewBusy, setOverviewBusy] = useState(false);
  const [overviewError, setOverviewError] = useState("");
  const [overviewResult, setOverviewResult] = useState<WealthOverviewPayload | null>(null);
  const [overviewQuery, setOverviewQuery] = useState<WealthOverviewQuery>({ as_of: "", ...initialFilters });
  const [curveBusy, setCurveBusy] = useState(false);
  const [curveError, setCurveError] = useState("");
  const [curveResult, setCurveResult] = useState<WealthCurvePayload | null>(null);
  const [curveQuery, setCurveQuery] = useState<WealthCurveQuery>({ preset: "ytd", from: "", to: "", ...initialFilters });

  function setSharedAssetFilters(updater: (previous: WealthAssetFilters) => WealthAssetFilters) {
    setCurveQuery((previous) => {
      const next = updater(previous);
      setOverviewQuery((overview) => ({ ...overview, ...next }));
      return { ...previous, ...next };
    });
  }

  function toggleAssetFilter(key: keyof WealthAssetFilters) {
    setSharedAssetFilters((previous) => {
      const nextValue: BoolString = previous[key] === "true" ? "false" : "true";
      if (nextValue === "false" && key !== "include_liability") {
        const positiveKeys: Array<keyof WealthAssetFilters> = ["include_investment", "include_cash", "include_real_estate"];
        if (!positiveKeys.some((candidate) => candidate !== key && previous[candidate] === "true")) return previous;
      }
      return { ...previous, [key]: nextValue };
    });
  }

  async function refreshOverview() {
    setOverviewBusy(true);
    setOverviewError("");
    try {
      const payload = await queryWealthOverview(buildWealthOverviewRequest(overviewQuery, curveQuery));
      startTransition(() => setOverviewResult(payload));
    } catch (err) {
      setOverviewError(toErrorMessage(err));
    } finally {
      setOverviewBusy(false);
    }
  }

  async function refreshCurve() {
    setCurveBusy(true);
    setCurveError("");
    try {
      const payload = await queryWealthCurve(buildWealthCurveRequest(curveQuery));
      startTransition(() => setCurveResult(payload));
    } catch (err) {
      setCurveError(toErrorMessage(err));
    } finally {
      setCurveBusy(false);
    }
  }

  return {
    overviewBusy, overviewError, overviewResult, overviewQuery, setOverviewQuery, setOverviewError, setOverviewResult,
    curveBusy, curveError, curveResult, curveQuery, setCurveQuery, setCurveError, setCurveResult,
    setSharedAssetFilters, toggleAssetFilter, refreshOverview, refreshCurve,
  };
}
