import {
  summarizeCmbBankPdfImportPayload,
  summarizeCmbBankPdfPreviewPayload,
  summarizeCmbEmlImportPayload,
  summarizeCmbEmlPreviewPayload,
  summarizeYzxyImportPayload,
  summarizeYzxyPreviewPayload,
} from "../../app/summaries";

function formatImportJobRange(row: Record<string, any>) {
  const from = typeof row?.data_date_from === "string" ? row.data_date_from : "";
  const to = typeof row?.data_date_to === "string" ? row.data_date_to : "";
  if (!from && !to) return "-";
  if (from && to) return from === to ? from : `${from} ~ ${to}`;
  return from || to;
}

function mapImportJobStatusTone(status: string) {
  if (status === "success") return "ready";
  if (status === "failed") return "error";
  if (status === "running") return "loading";
  return "idle";
}

function resolveImportFlowState(args: Record<string, any>) {
  const {
    path,
    previewBusy,
    importBusy,
    previewError,
    importError,
    previewResult,
    importResult,
    summarizePreview,
    summarizeImport,
    emptyHint,
  } = args;

  if (!path.trim()) {
    return {
      tone: "idle",
      label: "待选择文件",
      detail: emptyHint,
    };
  }
  if (previewBusy) {
    return {
      tone: "loading",
      label: "正在预检",
      detail: "正在解析文件并检查可导入内容。",
    };
  }
  if (importBusy) {
    return {
      tone: "loading",
      label: "正在导入",
      detail: "预检已完成，正在写入账本。",
    };
  }
  if (previewError) {
    return {
      tone: "error",
      label: "预检失败",
      detail: previewError,
    };
  }
  if (importError) {
    return {
      tone: "error",
      label: "导入失败",
      detail: importError,
    };
  }
  if (importResult) {
    return {
      tone: "ready",
      label: "导入完成",
      detail: summarizeImport(importResult) || "已完成导入，可到导入记录确认结果。",
    };
  }
  if (previewResult) {
    return {
      tone: "ready",
      label: "预检完成",
      detail: summarizePreview(previewResult) || "预检通过，准备继续导入。",
    };
  }
  return {
    tone: "idle",
    label: "等待开始",
    detail: "点击按钮后会自动先预检，再继续导入。",
  };
}

type ImportFlowCardProps = Record<string, unknown>;

function ImportFlowCard(props: ImportFlowCardProps) {
  const {
    title,
    description,
    pathLabel,
    pathValue,
    onPathChange,
    browseButtons,
    actionLabel,
    onRun,
    disabled,
    status,
  } = props as Record<string, any>;

  return (
    <section className="card panel">
      <div className="panel-header">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>

      <div className="db-import-path-row">
        <label className="field db-import-path-field">
          <span>{pathLabel}</span>
          <input value={pathValue} onChange={(e: { target: { value: string; checked?: boolean } }) => onPathChange(e.target.value)} />
        </label>
        {browseButtons}
      </div>

      <div className="db-actions">
        <button type="button" className="primary-btn" onClick={() => void onRun()} disabled={disabled}>
          {actionLabel}
        </button>
      </div>

      <div className="subcard import-flow-status">
        <div className="smoke-row-head import-flow-status-head">
          <h3>当前状态</h3>
          <span className={`status-pill status-${status.tone}`}>{status.label}</span>
        </div>
        <p className="pipeline-message">{status.detail}</p>
      </div>
    </section>
  );
}

type ImportCenterSectionsProps = Record<string, unknown>;

export function ImportCenterSections(props: ImportCenterSectionsProps) {
  const {
    isTab,
    handleImportJobsQuery,
    importJobsBusy,
    importJobsError,
    importJobsResult,
    importJobsLastRunAt,
    yzxyFilePath,
    setYzxyFilePath,
    handlePickYzxyFilePath,
    handleYzxyRunImportFlow,
    yzxyPreviewBusy,
    yzxyImportBusy,
    yzxyPreviewError,
    yzxyImportError,
    yzxyPreviewResult,
    yzxyImportResult,
    emlSourcePath,
    setEmlSourcePath,
    handlePickEmlFile,
    handlePickEmlFolder,
    handleCmbEmlRunImportFlow,
    emlPreviewBusy,
    emlImportBusy,
    emlPreviewError,
    emlImportError,
    emlPreviewResult,
    emlImportResult,
    cmbPdfPath,
    setCmbPdfPath,
    handlePickCmbPdfFile,
    handleCmbBankPdfRunImportFlow,
    cmbPdfPreviewBusy,
    cmbPdfImportBusy,
    cmbPdfPreviewError,
    cmbPdfImportError,
    cmbPdfPreviewResult,
    cmbPdfImportResult,
    PreviewStat,
  } = props as Record<string, any>;

  const importJobRows = Array.isArray(importJobsResult?.rows) ? importJobsResult.rows : [];
  const importJobsSummary = importJobsResult?.summary ?? {};
  const yzxyStatus = resolveImportFlowState({
    path: yzxyFilePath,
    previewBusy: yzxyPreviewBusy,
    importBusy: yzxyImportBusy,
    previewError: yzxyPreviewError,
    importError: yzxyImportError,
    previewResult: yzxyPreviewResult,
    importResult: yzxyImportResult,
    summarizePreview: summarizeYzxyPreviewPayload,
    summarizeImport: summarizeYzxyImportPayload,
    emptyHint: "请选择有知有行导出文件。",
  });
  const emlStatus = resolveImportFlowState({
    path: emlSourcePath,
    previewBusy: emlPreviewBusy,
    importBusy: emlImportBusy,
    previewError: emlPreviewError,
    importError: emlImportError,
    previewResult: emlPreviewResult,
    importResult: emlImportResult,
    summarizePreview: summarizeCmbEmlPreviewPayload,
    summarizeImport: summarizeCmbEmlImportPayload,
    emptyHint: "请选择招行 EML 文件，或选择包含账单的目录。",
  });
  const cmbPdfStatus = resolveImportFlowState({
    path: cmbPdfPath,
    previewBusy: cmbPdfPreviewBusy,
    importBusy: cmbPdfImportBusy,
    previewError: cmbPdfPreviewError,
    importError: cmbPdfImportError,
    previewResult: cmbPdfPreviewResult,
    importResult: cmbPdfImportResult,
    summarizePreview: summarizeCmbBankPdfPreviewPayload,
    summarizeImport: summarizeCmbBankPdfImportPayload,
    emptyHint: "请选择招行银行流水 PDF 文件。",
  });

  return (
    <>
      {isTab("import-center") ? (
        <ImportFlowCard
          title="有知有行导入"
          description="选择导出文件后，系统会自动先预检，再写入账本。"
          pathLabel="有知有行导出文件"
          pathValue={yzxyFilePath}
          onPathChange={setYzxyFilePath}
          browseButtons={
            <button
              type="button"
              className="secondary-btn"
              onClick={() => void handlePickYzxyFilePath()}
              disabled={yzxyPreviewBusy || yzxyImportBusy}
            >
              浏览...
            </button>
          }
          actionLabel={yzxyPreviewBusy ? "正在预检..." : yzxyImportBusy ? "正在导入..." : "开始导入"}
          onRun={handleYzxyRunImportFlow}
          disabled={yzxyPreviewBusy || yzxyImportBusy || !yzxyFilePath.trim()}
          status={yzxyStatus}
        />
      ) : null}

      {isTab("import-center") ? (
        <ImportFlowCard
          title="招行信用卡 EML 导入"
          description="支持单个 `.eml` 文件或账单目录，点击后自动完成预检和导入。"
          pathLabel="EML 文件 / 目录"
          pathValue={emlSourcePath}
          onPathChange={setEmlSourcePath}
          browseButtons={
            <>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => void handlePickEmlFile()}
                disabled={emlPreviewBusy || emlImportBusy}
              >
                选择文件...
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => void handlePickEmlFolder()}
                disabled={emlPreviewBusy || emlImportBusy}
              >
                选择目录...
              </button>
            </>
          }
          actionLabel={emlPreviewBusy ? "正在预检..." : emlImportBusy ? "正在导入..." : "开始导入"}
          onRun={handleCmbEmlRunImportFlow}
          disabled={emlPreviewBusy || emlImportBusy || !emlSourcePath.trim()}
          status={emlStatus}
        />
      ) : null}

      {isTab("import-center") ? (
        <ImportFlowCard
          title="招行银行流水 PDF 导入"
          description="选择 PDF 后自动执行预检与导入，适合银行流水批量入账。"
          pathLabel="银行流水 PDF"
          pathValue={cmbPdfPath}
          onPathChange={setCmbPdfPath}
          browseButtons={
            <button
              type="button"
              className="secondary-btn"
              onClick={() => void handlePickCmbPdfFile()}
              disabled={cmbPdfPreviewBusy || cmbPdfImportBusy}
            >
              选择 PDF...
            </button>
          }
          actionLabel={cmbPdfPreviewBusy ? "正在预检..." : cmbPdfImportBusy ? "正在导入..." : "开始导入"}
          onRun={handleCmbBankPdfRunImportFlow}
          disabled={cmbPdfPreviewBusy || cmbPdfImportBusy || !cmbPdfPath.trim()}
          status={cmbPdfStatus}
        />
      ) : null}

      {isTab("import-center") ? (
        <section className="card panel">
          <div className="panel-header">
            <h2>导入记录</h2>
            <p>展示最近导入任务，方便确认是否已导入，以及每次导入覆盖的数据范围。</p>
          </div>

          <div className="db-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => void handleImportJobsQuery()}
              disabled={importJobsBusy}
            >
              {importJobsBusy ? "刷新中..." : "刷新导入记录"}
            </button>
            <div className="smoke-last-run">
              最近刷新：{importJobsLastRunAt ? new Date(importJobsLastRunAt).toLocaleTimeString() : "-"}
            </div>
          </div>

          <div className="preview-stat-grid">
            <PreviewStat label="总记录数" value={typeof importJobsSummary.total_count === "number" ? importJobsSummary.total_count : 0} />
            <PreviewStat label="成功" value={typeof importJobsSummary.success_count === "number" ? importJobsSummary.success_count : 0} tone="good" />
            <PreviewStat label="失败" value={typeof importJobsSummary.failed_count === "number" ? importJobsSummary.failed_count : 0} tone={importJobsSummary.failed_count > 0 ? "warn" : "default"} />
            <PreviewStat label="运行中" value={typeof importJobsSummary.running_count === "number" ? importJobsSummary.running_count : 0} />
          </div>

          {importJobsError ? (
            <div className="inline-error" role="alert">
              {importJobsError}
            </div>
          ) : null}

          {importJobRows.length > 0 ? (
            <div className="table-wrap">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>状态</th>
                    <th>来源</th>
                    <th>时间范围</th>
                    <th>导入结果</th>
                  </tr>
                </thead>
                <tbody>
                  {importJobRows.map((row: Record<string, any>, index: number) => {
                    const status = typeof row?.status === "string" ? row.status : "unknown";
                    const statusTone = mapImportJobStatusTone(status);
                    const sourceType = typeof row?.source_type === "string" ? row.source_type : "-";
                    const rangeLabel = typeof row?.data_label === "string" ? row.data_label : "时间范围";
                    const rangeText = formatImportJobRange(row);
                    const totalCount = typeof row?.total_count === "number" ? row.total_count : 0;
                    const importedCount = typeof row?.imported_count === "number" ? row.imported_count : 0;
                    const errorCount = typeof row?.error_count === "number" ? row.error_count : 0;
                    return (
                      <tr key={typeof row?.id === "string" ? row.id : `${sourceType}-${index}`}>
                        <td>
                          <span className={`status-pill status-${statusTone}`}>{status.toUpperCase()}</span>
                        </td>
                        <td>{sourceType}</td>
                        <td style={{ whiteSpace: "normal", minWidth: "158px" }} title={rangeText}>
                          <div>{rangeLabel}</div>
                          <div className="pipeline-last-run">{rangeText}</div>
                        </td>
                        <td style={{ whiteSpace: "normal", minWidth: "138px" }}>
                          <div>{importedCount} / {totalCount}</div>
                          <div className="pipeline-last-run">错误：{errorCount}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="placeholder">暂无导入记录。完成任一导入后，这里会显示最近任务及其数据时间范围。</p>
          )}
        </section>
      ) : null}
    </>
  );
}
