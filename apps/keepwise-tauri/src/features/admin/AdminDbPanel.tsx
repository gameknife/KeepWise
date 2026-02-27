// @ts-nocheck
export function AdminDbPanel(props: any) {
  const {
    isAdminDeveloperMode,
    refreshDbStatus,
    dbBusy,
    handleRunMigrations,
    handleImportRepoRuntimeDb,
    dbImportPath,
    setDbImportPath,
    handlePickDbImportPath,
    handleImportDbFromPath,
    dbStatusError,
    dbStatus,
    dbLastResult,
    dbImportLastResult,
  } = props;

  return (
    <>
      {isAdminDeveloperMode ? <section className="card panel">
        <div className="panel-header">
          <h2>桌面账本数据库（SQLite）</h2>
          <p>第一条真实基础能力：在 Tauri desktop 内初始化数据库并执行嵌入迁移脚本。</p>
        </div>

        <div className="db-actions">
          <button type="button" className="primary-btn" onClick={() => void refreshDbStatus()} disabled={dbBusy}>
            刷新数据库状态
          </button>
          <button type="button" className="primary-btn" onClick={() => void handleRunMigrations()} disabled={dbBusy}>
            {dbBusy ? "执行中..." : "初始化 / 迁移数据库"}
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleImportRepoRuntimeDb()}
            disabled={dbBusy}
            title="复制仓库默认运行库 data/work/processed/ledger/keepwise.db 到 Tauri app 本地库"
          >
            {dbBusy ? "执行中..." : "导入仓库运行库"}
          </button>
        </div>

        <div className="db-import-path-row">
          <label className="field db-import-path-field">
            <span>从路径导入已有数据库</span>
            <input
              value={dbImportPath}
              onChange={(e) => setDbImportPath(e.target.value)}
              placeholder="/absolute/path/to/keepwise.db"
            />
          </label>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void handlePickDbImportPath()}
            disabled={dbBusy}
            title="打开系统文件选择器，选择已有 keepwise.db"
          >
            浏览...
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void handleImportDbFromPath()}
            disabled={dbBusy || !dbImportPath.trim()}
            title="导入任意已有 keepwise.db 到 Tauri app 本地库（将覆盖当前 app 库）"
          >
            {dbBusy ? "执行中..." : "从路径导入数据库"}
          </button>
        </div>
        <p className="inline-hint">
          适用于导入任意已有 `keepwise.db`（例如历史备份、副本、其他环境生成的库）。开发期也可继续使用上面的
          `导入仓库运行库` 快捷按钮。
        </p>

        {dbStatusError ? (
          <div className="inline-error" role="alert">
            {dbStatusError}
          </div>
        ) : null}

        {dbStatus ? (
          <div className="db-grid">
            <div className="subcard">
              <h3>状态</h3>
              <dl className="kv-grid">
                <dt>数据库存在</dt>
                <dd>{String(dbStatus.exists)}</dd>
                <dt>迁移表存在</dt>
                <dd>{String(dbStatus.schema_migrations_table_exists)}</dd>
                <dt>可用</dt>
                <dd>{String(dbStatus.ready)}</dd>
                <dt>已应用</dt>
                <dd>
                  {dbStatus.applied_versions.length} / {dbStatus.migration_files.length}
                </dd>
                <dt>待执行</dt>
                <dd>{dbStatus.pending_versions.length}</dd>
              </dl>
            </div>

            <div className="subcard">
              <h3>数据库路径</h3>
              <code className="path-value">{dbStatus.db_path}</code>
            </div>
          </div>
        ) : (
          <p className="placeholder">等待数据库状态...</p>
        )}

        {dbStatus ? (
          <div className="db-grid db-grid-lists">
            <div className="subcard">
              <h3>已应用版本</h3>
              {dbStatus.applied_versions.length > 0 ? (
                <ul className="mono-list">
                  {dbStatus.applied_versions.map((v) => (
                    <li key={v}>
                      <code>{v}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="placeholder">尚未应用迁移。</p>
              )}
            </div>
            <div className="subcard">
              <h3>待执行版本</h3>
              {dbStatus.pending_versions.length > 0 ? (
                <ul className="mono-list">
                  {dbStatus.pending_versions.map((v) => (
                    <li key={v}>
                      <code>{v}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="placeholder">没有待执行迁移。</p>
              )}
            </div>
          </div>
        ) : null}

        {dbLastResult ? (
          <div className="subcard db-result-card">
            <h3>最近迁移结果</h3>
            <dl className="kv-grid">
              <dt>是否新建</dt>
              <dd>{String(dbLastResult.created)}</dd>
              <dt>本次应用</dt>
              <dd>{dbLastResult.applied_now.length}</dd>
              <dt>跳过</dt>
              <dd>{dbLastResult.skipped.length}</dd>
              <dt>累计已应用</dt>
              <dd>{dbLastResult.applied_total}</dd>
              <dt>累计待执行</dt>
              <dd>{dbLastResult.pending_total}</dd>
            </dl>
          </div>
        ) : null}

        {dbImportLastResult ? (
          <div className="subcard db-result-card">
            <h3>最近导入仓库运行库结果</h3>
            <dl className="kv-grid">
              <dt>源数据库</dt>
              <dd>
                <code className="path-value">{dbImportLastResult.source_db_path}</code>
              </dd>
              <dt>目标数据库</dt>
              <dd>
                <code className="path-value">{dbImportLastResult.target_db_path}</code>
              </dd>
              <dt>是否覆盖已有</dt>
              <dd>{String(dbImportLastResult.replaced_existing)}</dd>
              <dt>复制字节数</dt>
              <dd>{dbImportLastResult.copied_bytes}</dd>
              <dt>迁移本次应用</dt>
              <dd>{dbImportLastResult.migrate_result.applied_now.length}</dd>
              <dt>迁移待执行总数</dt>
              <dd>{dbImportLastResult.migrate_result.pending_total}</dd>
            </dl>
          </div>
        ) : null}
      </section> : null}
    </>
  );
}
