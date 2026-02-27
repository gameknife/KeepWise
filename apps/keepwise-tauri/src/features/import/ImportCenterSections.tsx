// @ts-nocheck
export function ImportCenterSections(props: any) {
  const {
    isTab,
    importCenterLastRunAt,
    importCenterStatus,
    importCenterMessage,
    importCenterRows,
    yzxyFilePath,
    setYzxyFilePath,
    handlePickYzxyFilePath,
    yzxyPreviewBusy,
    yzxyImportBusy,
    yzxySourceType,
    setYzxySourceType,
    handleYzxyPreview,
    handleYzxyImport,
    yzxyPreviewError,
    yzxyImportError,
    yzxyPreviewResult,
    yzxyImportResult,
    PreviewStat,
    showRawJson,
    JsonResultCard,
    emlSourcePath,
    setEmlSourcePath,
    handlePickEmlFile,
    handlePickEmlFolder,
    emlPreviewBusy,
    emlImportBusy,
    safeNumericInputValue,
    emlReviewThreshold,
    setEmlReviewThreshold,
    parseNumericInputWithFallback,
    emlSourceType,
    setEmlSourceType,
    handleCmbEmlPreview,
    handleCmbEmlImport,
    emlPreviewError,
    emlImportError,
    emlPreviewResult,
    emlImportResult,
    cmbPdfPath,
    setCmbPdfPath,
    handlePickCmbPdfFile,
    cmbPdfPreviewBusy,
    cmbPdfImportBusy,
    cmbPdfReviewThreshold,
    setCmbPdfReviewThreshold,
    cmbPdfSourceType,
    setCmbPdfSourceType,
    handleCmbBankPdfPreview,
    handleCmbBankPdfImport,
    cmbPdfPreviewError,
    cmbPdfImportError,
    cmbPdfPreviewResult,
    cmbPdfImportResult,
    formatCentsShort,
    YzxyPreviewSummaryReport,
    YzxyImportSummaryReport,
    CmbEmlPreviewSummaryReport,
    CmbEmlImportSummaryReport,
    CmbBankPdfPreviewSummaryReport,
    CmbBankPdfImportSummaryReport,
    RulesAdminPanel,
    BoolField,
    DateInput,
    AutoRefreshHint,
    maskAmountDisplayText,
  } = props;
  return (
    <>
      {isTab("import-center") ? <section className="card panel">
        <div className="panel-header">
          <h2>导入中心（桌面）</h2>
          <p>统一展示三条 Rust 导入链路的手动导入准备状态、Preview 摘要与最近 Import 结果（不在此处批量执行）。</p>
        </div>

        <div className="db-actions">
          <div className="smoke-last-run">
            状态更新时间：{importCenterLastRunAt ? new Date(importCenterLastRunAt).toLocaleTimeString() : "-"}
          </div>
        </div>

        <div className="pipeline-status-row">
          <span
            className={`status-pill status-${
              importCenterStatus === "idle"
                ? "idle"
                : importCenterStatus === "running"
                  ? "loading"
                  : importCenterStatus === "pass"
                    ? "ready"
                    : "error"
            }`}
          >
            导入中心 {importCenterStatus.toUpperCase()}
          </span>
          <span className="pipeline-last-run">
            手动流程：先 Preview 确认，再 Import（每条导入链路独立执行）
          </span>
        </div>
        {importCenterMessage ? <p className="pipeline-message">{importCenterMessage}</p> : null}

        <div className="smoke-grid">
          {importCenterRows.map((row) => {
            const rowTone =
              row.status === "pass"
                ? "smoke-pass"
                : row.status === "fail"
                  ? "smoke-fail"
                  : "";
            const pillTone =
              row.status === "pass"
                ? "ready"
                : row.status === "fail"
                  ? "error"
                  : row.status === "running"
                    ? "loading"
                    : "idle";
            return (
              <div key={row.key} className={`smoke-row ${rowTone}`.trim()}>
                <div className="smoke-row-head">
                  <code>{row.label}</code>
                  <span className={`status-pill status-${pillTone}`}>{row.status.toUpperCase()}</span>
                </div>
                <div className="smoke-row-meta">
                  <span>{typeof row.durationMs === "number" ? `${row.durationMs} ms` : "-"}</span>
                </div>
                <div className="smoke-row-detail" title={row.detail}>
                  {row.detail ?? "尚未执行"}
                </div>
              </div>
            );
          })}
        </div>

        <p className="inline-hint">
          此处仅展示三种导入方式的“路径是否已选择 / Preview 是否完成 / Import 最近结果”。实际操作请在下方各面板逐项手动执行。
        </p>
      </section> : null}

      {isTab("import-center") ? <section className="card panel">
        <div className="panel-header">
          <h2>有知有行导入</h2>
          <p>Rust 原生解析并导入有知有行导出文件（`.csv` / `.xlsx`），用于构建 desktop 端完整导入验证闭环。</p>
        </div>

        <div className="db-import-path-row">
          <label className="field db-import-path-field">
            <span>有知有行导出文件</span>
            <input
              value={yzxyFilePath}
              onChange={(e) => setYzxyFilePath(e.target.value)}
              placeholder="/absolute/path/to/youzhiyouxing.xlsx"
            />
          </label>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void handlePickYzxyFilePath()}
            disabled={yzxyPreviewBusy || yzxyImportBusy}
          >
            浏览...
          </button>
        </div>

        <div className="query-form-grid query-form-grid-compact">
          <label className="field">
            <span>来源类型</span>
            <input
              value={yzxySourceType}
              onChange={(e) => setYzxySourceType(e.target.value)}
              placeholder="yzxy_xlsx"
            />
          </label>
        </div>

        <div className="db-actions">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void handleYzxyPreview()}
            disabled={yzxyPreviewBusy || yzxyImportBusy || !yzxyFilePath.trim()}
          >
            {yzxyPreviewBusy ? "预览中..." : "预览有知有行文件"}
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleYzxyImport()}
            disabled={yzxyImportBusy || yzxyPreviewBusy || !yzxyFilePath.trim()}
            title="导入到 Tauri app 本地账本；导入成功后会自动刷新投资相关查询与分析面板"
          >
            {yzxyImportBusy ? "导入中..." : "导入有知有行到桌面数据库"}
          </button>
        </div>

        <p className="inline-hint">
          建议流程：先 `Preview` 确认映射与样例，再 `Import`。导入成功后会自动刷新 `Investments / Meta Accounts /
          账户目录 / Analytics` 面板，便于立即验证结果。
        </p>

        {yzxyPreviewError ? (
          <div className="inline-error" role="alert">
            {yzxyPreviewError}
          </div>
        ) : null}
        {yzxyImportError ? (
          <div className="inline-error" role="alert">
            {yzxyImportError}
          </div>
        ) : null}

        <div className="db-grid">
          <div className="subcard">
            <h3>预览结果</h3>
            <YzxyPreviewSummaryReport data={yzxyPreviewResult} PreviewStat={PreviewStat} />
            {showRawJson ? (
              <JsonResultCard title="有知有行预览 JSON" data={yzxyPreviewResult} emptyText="尚未预览。请选择有知有行文件后执行预览。" />
            ) : null}
          </div>
          <div className="subcard">
            <h3>导入结果</h3>
            <YzxyImportSummaryReport data={yzxyImportResult} PreviewStat={PreviewStat} />
            {showRawJson ? (
              <JsonResultCard title="有知有行导入 JSON" data={yzxyImportResult} emptyText="尚未导入。请在预览确认后执行导入。" />
            ) : null}
          </div>
        </div>
      </section> : null}

      {isTab("import-center") ? <section className="card panel">
        <div className="panel-header">
          <h2>招行信用卡 EML 导入</h2>
          <p>Rust 原生解析招行信用卡 EML（支持单文件或目录递归扫描），完成 preview + import 并写入 `transactions`。</p>
        </div>

        <div className="db-import-path-row">
          <label className="field db-import-path-field">
            <span>EML 文件 / 目录</span>
            <input
              value={emlSourcePath}
              onChange={(e) => setEmlSourcePath(e.target.value)}
              placeholder="/absolute/path/to/file.eml or /dir/of/eml/"
            />
          </label>
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
        </div>

        <div className="query-form-grid query-form-grid-compact">
          <label className="field">
            <span>复核阈值</span>
            <input
              type="number"
              min={0}
              max={1}
              step="0.01"
              value={safeNumericInputValue(emlReviewThreshold, 0.7)}
              onChange={(e) => setEmlReviewThreshold(parseNumericInputWithFallback(e.target.value || "0.7", 0.7))}
            />
          </label>
          <label className="field">
            <span>来源类型</span>
            <input
              value={emlSourceType}
              onChange={(e) => setEmlSourceType(e.target.value)}
              placeholder="cmb_eml"
            />
          </label>
        </div>

        <div className="db-actions">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void handleCmbEmlPreview()}
            disabled={emlPreviewBusy || emlImportBusy || !emlSourcePath.trim()}
          >
            {emlPreviewBusy ? "预览中..." : "预览招行 EML"}
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleCmbEmlImport()}
            disabled={emlImportBusy || emlPreviewBusy || !emlSourcePath.trim()}
            title="导入到 desktop 本地库，导入成功后自动刷新 Transactions/Admin Health 等面板"
          >
            {emlImportBusy ? "导入中..." : "导入招行 EML 到桌面数据库"}
          </button>
        </div>

        <p className="inline-hint">
          支持直接选择单个 `.eml` 或选择目录进行递归扫描。建议先 `Preview` 查看解析/分类结果摘要，再执行 `Import`。
        </p>

        {emlPreviewError ? (
          <div className="inline-error" role="alert">
            {emlPreviewError}
          </div>
        ) : null}
        {emlImportError ? (
          <div className="inline-error" role="alert">
            {emlImportError}
          </div>
        ) : null}

        <div className="db-grid">
          <div className="subcard">
            <h3>EML 预览结果</h3>
            <CmbEmlPreviewSummaryReport data={emlPreviewResult} PreviewStat={PreviewStat} />
            {showRawJson ? <JsonResultCard title="招行 EML 预览 JSON" data={emlPreviewResult} emptyText="尚未预览。" /> : null}
          </div>
          <div className="subcard">
            <h3>EML 导入结果</h3>
            <CmbEmlImportSummaryReport data={emlImportResult} PreviewStat={PreviewStat} />
            {showRawJson ? <JsonResultCard title="招行 EML 导入 JSON" data={emlImportResult} emptyText="尚未导入。" /> : null}
          </div>
        </div>
      </section> : null}

      {isTab("import-center") ? <section className="card panel">
        <div className="panel-header">
          <h2>招行银行流水 PDF 导入</h2>
          <p>Rust 原生解析招商银行流水 PDF，执行规则分类并导入 `transactions`（desktop-only 验证链路）。</p>
        </div>

        <div className="db-import-path-row">
          <label className="field db-import-path-field">
            <span>银行流水 PDF</span>
            <input
              value={cmbPdfPath}
              onChange={(e) => setCmbPdfPath(e.target.value)}
              placeholder="/absolute/path/to/cmb_bank_statement.pdf"
            />
          </label>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void handlePickCmbPdfFile()}
            disabled={cmbPdfPreviewBusy || cmbPdfImportBusy}
          >
            选择 PDF...
          </button>
        </div>

        <div className="query-form-grid query-form-grid-compact">
          <label className="field">
            <span>复核阈值</span>
            <input
              type="number"
              min={0}
              max={1}
              step="0.01"
              value={safeNumericInputValue(cmbPdfReviewThreshold, 0.7)}
              onChange={(e) =>
                setCmbPdfReviewThreshold(parseNumericInputWithFallback(e.target.value || "0.7", 0.7))
              }
            />
          </label>
          <label className="field">
            <span>来源类型</span>
            <input
              value={cmbPdfSourceType}
              onChange={(e) => setCmbPdfSourceType(e.target.value)}
              placeholder="cmb_bank_pdf"
            />
          </label>
        </div>

        <div className="db-actions">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void handleCmbBankPdfPreview()}
            disabled={cmbPdfPreviewBusy || cmbPdfImportBusy || !cmbPdfPath.trim()}
          >
            {cmbPdfPreviewBusy ? "预览中..." : "预览招行银行流水 PDF"}
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleCmbBankPdfImport()}
            disabled={cmbPdfImportBusy || cmbPdfPreviewBusy || !cmbPdfPath.trim()}
            title="导入到 desktop 本地库，完成后自动刷新 Transactions/Health 面板"
          >
            {cmbPdfImportBusy ? "导入中..." : "导入招行银行流水 PDF 到桌面数据库"}
          </button>
        </div>

        <p className="inline-hint">
          建议先 `Preview` 检查 `rule_counts / summary / samples`，确认工资、转账、借记卡消费识别逻辑正常后再导入。
        </p>

        {cmbPdfPreviewError ? (
          <div className="inline-error" role="alert">
            {cmbPdfPreviewError}
          </div>
        ) : null}
        {cmbPdfImportError ? (
          <div className="inline-error" role="alert">
            {cmbPdfImportError}
          </div>
        ) : null}

        <div className="db-grid">
          <div className="subcard">
            <h3>招行 PDF 预览结果</h3>
            <CmbBankPdfPreviewSummaryReport
              data={cmbPdfPreviewResult}
              PreviewStat={PreviewStat}
              formatCentsShort={formatCentsShort}
            />
            {showRawJson ? <JsonResultCard title="招行 PDF 预览 JSON" data={cmbPdfPreviewResult} emptyText="尚未预览。" /> : null}
          </div>
          <div className="subcard">
            <h3>招行 PDF 导入结果</h3>
            <CmbBankPdfImportSummaryReport data={cmbPdfImportResult} PreviewStat={PreviewStat} />
            {showRawJson ? <JsonResultCard title="招行 PDF 导入 JSON" data={cmbPdfImportResult} emptyText="尚未导入。" /> : null}
          </div>
        </div>
      </section> : null}

      {isTab("import-center") ? (
        <RulesAdminPanel
          showRawJson={showRawJson}
          PreviewStat={PreviewStat}
          BoolField={BoolField}
          DateInput={DateInput}
          JsonResultCard={JsonResultCard}
          AutoRefreshHint={AutoRefreshHint}
          maskAmountDisplayText={maskAmountDisplayText}
        />
      ) : null}
    </>
  );
}
