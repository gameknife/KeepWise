// @ts-nocheck
export function AdminProbePanels(props: any) {
  const {
    isAdminDeveloperMode,
    status,
    error,
    isReady,
    probe,
    PathRow,
  } = props;

  return (
    <>
      {isAdminDeveloperMode && status === "error" && (
        <section className="card alert-card" role="alert">
          <h2>命令探针失败</h2>
          <p>
            前端已经尝试调用 Tauri command，但没有拿到有效返回。若你是在浏览器直接运行 `npm run dev`，这是预期现象。
            请使用 `npm run tauri dev`。
          </p>
          <pre>{error}</pre>
        </section>
      )}

      {isAdminDeveloperMode ? <section className="panel-grid">
        <section className="card panel">
          <div className="panel-header">
            <h2>命令探针</h2>
            <p>第一批基础命令：`health_ping` / `app_metadata` / `app_paths`</p>
          </div>

          <div className="stack">
            <div className="subcard">
              <h3>健康检查</h3>
              {isReady && probe ? (
                <dl className="kv-grid">
                  <dt>状态</dt>
                  <dd>{probe.health.status}</dd>
                  <dt>模式</dt>
                  <dd>{probe.health.mode}</dd>
                  <dt>时间戳</dt>
                  <dd>{probe.health.unix_ts}</dd>
                </dl>
              ) : (
                <p className="placeholder">等待命令返回...</p>
              )}
            </div>

            <div className="subcard">
              <h3>应用信息</h3>
              {isReady && probe ? (
                <dl className="kv-grid">
                  <dt>应用名称</dt>
                  <dd>{probe.metadata.app_name}</dd>
                  <dt>版本</dt>
                  <dd>{probe.metadata.app_version}</dd>
                  <dt>标识符</dt>
                  <dd>{probe.metadata.app_identifier ?? "-"}</dd>
                  <dt>构建模式</dt>
                  <dd>{probe.metadata.debug ? "debug" : "release"}</dd>
                  <dt>Tauri 主版本</dt>
                  <dd>{probe.metadata.tauri_major}</dd>
                </dl>
              ) : (
                <p className="placeholder">等待命令返回...</p>
              )}
            </div>
          </div>
        </section>

        <section className="card panel">
          <div className="panel-header">
            <h2>应用路径</h2>
            <p>后续 SQLite、规则文件、日志、导入缓存都会基于这些目录能力落地。</p>
          </div>

          {isReady && probe ? (
            <div className="path-list">
              <PathRow label="应用数据" probe={probe.paths.app_data_dir} />
              <PathRow label="应用配置" probe={probe.paths.app_config_dir} />
              <PathRow label="应用缓存" probe={probe.paths.app_cache_dir} />
              <PathRow label="应用日志" probe={probe.paths.app_log_dir} />
              <PathRow label="应用本地数据" probe={probe.paths.app_local_data_dir} />
            </div>
          ) : (
            <p className="placeholder">等待路径解析结果...</p>
          )}
        </section>
      </section> : null}
    </>
  );
}
