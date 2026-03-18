// @ts-nocheck
import { useEffect, useState } from "react";
import QRCode from "qrcode";

const SYNC_QR_RENDER_SIZE = 360;
const SYNC_QR_DISPLAY_SIZE = 280;

export function AppSettingsModal(props: any) {
  const {
    settingsOpen,
    setSettingsOpen,
    appSettings,
    setAppSettings,
    syncStatus,
    handleManualSyncNow,
    syncSetupBusy,
    syncSetupError,
    syncActionMessage,
    syncShareCode,
    syncCreateForm,
    setSyncCreateForm,
    syncLinkForm,
    setSyncLinkForm,
    handleSyncSetupCreate,
    handleSyncSetupLink,
    handleSyncShareCodeRefresh,
  } = props;
  const [activeCategory, setActiveCategory] = useState<"display" | "fire" | "sync">("display");
  const [syncShareQrDataUrl, setSyncShareQrDataUrl] = useState("");

  useEffect(() => {
    if (!settingsOpen) return;
    setActiveCategory("display");
  }, [settingsOpen]);

  useEffect(() => {
    if (!syncShareCode || !syncShareCode.trim()) {
      setSyncShareQrDataUrl("");
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(syncShareCode.trim(), {
      width: SYNC_QR_RENDER_SIZE,
      margin: 3,
      errorCorrectionLevel: "L",
      color: { dark: "#000000", light: "#FFFFFF" },
    })
      .then((url) => {
        if (!cancelled) setSyncShareQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setSyncShareQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [syncShareCode]);

  return (
    <>
      {settingsOpen ? (
        <div className="kw-modal-overlay" role="presentation" onClick={() => setSettingsOpen(false)}>
          <div
            className="kw-modal-card settings-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-settings-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="kw-modal-head">
              <div>
                <p className="eyebrow">应用设置</p>
                <h3 id="app-settings-modal-title">设置</h3>
              </div>
              <button type="button" className="secondary-btn table-inline-btn" onClick={() => setSettingsOpen(false)}>
                关闭
              </button>
            </div>

            <div className="settings-group">
              <div className="settings-shell">
                <aside className="settings-nav" aria-label="设置分类">
                  <button
                    type="button"
                    className={`settings-nav-item ${activeCategory === "display" ? "active" : ""}`}
                    onClick={() => setActiveCategory("display")}
                  >
                    <span className="settings-nav-item-title">显示</span>
                    <span className="settings-nav-item-subtitle">颜色与展示风格</span>
                  </button>
                  <button
                    type="button"
                    className={`settings-nav-item ${activeCategory === "fire" ? "active" : ""}`}
                    onClick={() => setActiveCategory("fire")}
                  >
                    <span className="settings-nav-item-title">FIRE</span>
                    <span className="settings-nav-item-subtitle">提取率与测算参数</span>
                  </button>
                  <button
                    type="button"
                    className={`settings-nav-item ${activeCategory === "sync" ? "active" : ""}`}
                    onClick={() => setActiveCategory("sync")}
                  >
                    <span className="settings-nav-item-title">云同步</span>
                    <span className="settings-nav-item-subtitle">多端状态与手动触发</span>
                  </button>
                </aside>

                <div className="settings-content">
                  {activeCategory === "display" ? (
                    <>
                      <div className="settings-group-head">
                        <h4>显示</h4>
                        <p>用于调整指标与金额展示方式。</p>
                      </div>

                      <div className="settings-item-card">
                        <div className="settings-item-card-head">
                          <h5>指标正负着色</h5>
                          <p>控制收益率、变化率、偏差、差额等按正负显示颜色的方向。</p>
                        </div>
                        <div className="settings-item-grid">
                          <label className="field">
                            <span>着色方案</span>
                            <select
                              value={appSettings.gainLossColorScheme}
                              onChange={(e) =>
                                setAppSettings((prev) => ({
                                  ...prev,
                                  gainLossColorScheme: e.target.value as any,
                                }))
                              }
                            >
                              <option value="cn_red_up_green_down">红正绿负（中国地区习惯）</option>
                              <option value="intl_green_up_red_down">绿正红负（国际常见习惯）</option>
                            </select>
                          </label>
                        </div>
                      </div>

                      <div className="settings-item-card">
                        <div className="settings-item-card-head">
                          <h5>默认隐私模式</h5>
                          <p>控制应用启动时金额是否默认隐藏（显示为 `****`）。</p>
                        </div>
                        <div className="settings-item-grid">
                          <div className="settings-segmented" role="group" aria-label="默认隐私模式">
                            <button
                              type="button"
                              className={`settings-segmented-btn ${appSettings.defaultPrivacyMaskOnLaunch ? "active" : ""}`}
                              onClick={() =>
                                setAppSettings((prev) => ({ ...prev, defaultPrivacyMaskOnLaunch: true }))
                              }
                            >
                              默认隐藏金额
                            </button>
                            <button
                              type="button"
                              className={`settings-segmented-btn ${!appSettings.defaultPrivacyMaskOnLaunch ? "active" : ""}`}
                              onClick={() =>
                                setAppSettings((prev) => ({ ...prev, defaultPrivacyMaskOnLaunch: false }))
                              }
                            >
                              默认显示金额
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="settings-item-card">
                        <div className="settings-item-card-head">
                          <h5>界面动画与过渡</h5>
                          <p>控制界面按钮、侧栏、卡片等视觉过渡效果。默认开启。</p>
                        </div>
                        <div className="settings-item-grid">
                          <div className="settings-segmented" role="group" aria-label="界面动画与过渡">
                            <button
                              type="button"
                              className={`settings-segmented-btn ${appSettings.uiMotionEnabled ? "active" : ""}`}
                              onClick={() =>
                                setAppSettings((prev) => ({ ...prev, uiMotionEnabled: true }))
                              }
                            >
                              开启
                            </button>
                            <button
                              type="button"
                              className={`settings-segmented-btn ${!appSettings.uiMotionEnabled ? "active" : ""}`}
                              onClick={() =>
                                setAppSettings((prev) => ({ ...prev, uiMotionEnabled: false }))
                              }
                            >
                              关闭
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="settings-item-card">
                        <div className="settings-item-card-head">
                          <h5>消费分析待确认过滤</h5>
                          <p>控制消费分析页是否默认排除“待确认”交易。默认排除，减少统计噪音。</p>
                        </div>
                        <div className="settings-item-grid">
                          <div className="settings-segmented" role="group" aria-label="消费分析待确认过滤">
                            <button
                              type="button"
                              className={`settings-segmented-btn ${appSettings.consumptionExcludeNeedsReviewByDefault ? "active" : ""}`}
                              onClick={() =>
                                setAppSettings((prev) => ({ ...prev, consumptionExcludeNeedsReviewByDefault: true }))
                              }
                            >
                              默认排除
                            </button>
                            <button
                              type="button"
                              className={`settings-segmented-btn ${!appSettings.consumptionExcludeNeedsReviewByDefault ? "active" : ""}`}
                              onClick={() =>
                                setAppSettings((prev) => ({ ...prev, consumptionExcludeNeedsReviewByDefault: false }))
                              }
                            >
                              默认显示
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : activeCategory === "fire" ? (
                    <>
                      <div className="settings-group-head">
                        <h4>FIRE</h4>
                        <p>用于设置 FIRE 进度测算参数。</p>
                      </div>

                      <div className="settings-item-card">
                        <div className="settings-item-card-head">
                          <h5>提取率（0~1）</h5>
                          <p>用于 FIRE 进度中目标资产、自由度等指标计算。</p>
                        </div>
                        <div className="settings-item-grid">
                          <div className="settings-segmented" role="group" aria-label="FIRE提取率">
                            <button
                              type="button"
                              className={`settings-segmented-btn ${appSettings.fireWithdrawalRate === "0.03" ? "active" : ""}`}
                              onClick={() =>
                                setAppSettings((prev) => ({ ...prev, fireWithdrawalRate: "0.03" }))
                              }
                            >
                              3%
                            </button>
                            <button
                              type="button"
                              className={`settings-segmented-btn ${appSettings.fireWithdrawalRate === "0.04" ? "active" : ""}`}
                              onClick={() =>
                                setAppSettings((prev) => ({ ...prev, fireWithdrawalRate: "0.04" }))
                              }
                            >
                              4%
                            </button>
                            <button
                              type="button"
                              className={`settings-segmented-btn ${appSettings.fireWithdrawalRate === "0.05" ? "active" : ""}`}
                              onClick={() =>
                                setAppSettings((prev) => ({ ...prev, fireWithdrawalRate: "0.05" }))
                              }
                            >
                              5%
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="settings-group-head">
                        <h4>云同步</h4>
                        <p>查看同步状态，并可手动触发一次同步。</p>
                      </div>

                      <div className="settings-item-card">
                        <div className="settings-item-card-head">
                          <h5>同步状态</h5>
                          <p>应用会轮询远端更新并自动拉取；本地写入后可点击同步按钮手动上传。</p>
                        </div>
                        <div className="settings-item-grid">
                          <div className="field">
                            <span>配置状态</span>
                            <strong>{syncStatus?.configured ? "已配置" : "未配置"}</strong>
                          </div>
                          <div className="field">
                            <span>工作区</span>
                            <strong>{syncStatus?.workspace_id || "-"}</strong>
                          </div>
                          <div className="field">
                            <span>本地 Head</span>
                            <strong>{syncStatus?.local_head || "-"}</strong>
                          </div>
                          <div className="field">
                            <span>远端 Head</span>
                            <strong>{syncStatus?.remote_head || "-"}</strong>
                          </div>
                          <div className="field">
                            <span>最近同步</span>
                            <strong>{syncStatus?.last_sync_at || "-"}</strong>
                          </div>
                          <div className="field">
                            <span>下一次自动同步</span>
                            <strong>{syncStatus?.next_sync_at || "-"}</strong>
                          </div>
                          <div className="field">
                            <span>冲突状态</span>
                            <strong>{syncStatus?.conflict ? "存在冲突" : "无冲突"}</strong>
                          </div>
                          <div className="field">
                            <span>最近错误</span>
                            <strong>{syncStatus?.last_error || "-"}</strong>
                          </div>
                        </div>
                        <div className="settings-item-grid">
                          <button
                            type="button"
                            className="primary-btn"
                            onClick={() => {
                              if (typeof handleManualSyncNow === "function") {
                                void handleManualSyncNow();
                              }
                            }}
                            disabled={!syncStatus?.configured || !!syncStatus?.syncing}
                          >
                            {syncStatus?.syncing ? "同步中..." : "立即同步"}
                          </button>
                        </div>
                      </div>

                      <div className="settings-item-card">
                        <div className="settings-item-card-head">
                          <h5>创建同步库</h5>
                          <p>首台设备填写 COS 参数并创建同步库。创建成功后可生成二维码给其他设备扫码。</p>
                        </div>
                        <div className="settings-item-grid">
                          <label className="field">
                            <span>SecretId</span>
                            <input
                              value={syncCreateForm?.secret_id || ""}
                              onChange={(e) =>
                                setSyncCreateForm?.((prev: any) => ({ ...prev, secret_id: e.target.value }))
                              }
                              placeholder="AKID..."
                            />
                          </label>
                          <label className="field">
                            <span>SecretKey</span>
                            <input
                              type="password"
                              value={syncCreateForm?.secret_key || ""}
                              onChange={(e) =>
                                setSyncCreateForm?.((prev: any) => ({ ...prev, secret_key: e.target.value }))
                              }
                              placeholder="请输入 SecretKey"
                            />
                          </label>
                          <label className="field">
                            <span>Region</span>
                            <input
                              value={syncCreateForm?.region || ""}
                              onChange={(e) =>
                                setSyncCreateForm?.((prev: any) => ({ ...prev, region: e.target.value }))
                              }
                              placeholder="ap-shanghai"
                            />
                          </label>
                          <label className="field">
                            <span>AppID</span>
                            <input
                              value={syncCreateForm?.app_id || ""}
                              onChange={(e) =>
                                setSyncCreateForm?.((prev: any) => ({ ...prev, app_id: e.target.value }))
                              }
                              placeholder="腾讯云账号 AppID"
                            />
                          </label>
                          <label className="field">
                            <span>同步密码</span>
                            <input
                              type="password"
                              value={syncCreateForm?.sync_password || ""}
                              onChange={(e) =>
                                setSyncCreateForm?.((prev: any) => ({ ...prev, sync_password: e.target.value }))
                              }
                              placeholder="用于端到端加密"
                            />
                          </label>
                        </div>
                        <div className="settings-item-grid">
                          <button
                            type="button"
                            className="primary-btn"
                            onClick={() => {
                              if (typeof handleSyncSetupCreate === "function") {
                                void handleSyncSetupCreate();
                              }
                            }}
                            disabled={!!syncSetupBusy}
                          >
                            {syncSetupBusy ? "处理中..." : "创建并绑定"}
                          </button>
                          <button
                            type="button"
                            className="secondary-btn table-inline-btn"
                            onClick={() => {
                              if (typeof handleSyncShareCodeRefresh === "function") {
                                void handleSyncShareCodeRefresh();
                              }
                            }}
                            disabled={!!syncSetupBusy}
                          >
                            生成/刷新同步链接码
                          </button>
                        </div>
                        {syncShareCode ? (
                          <div className="settings-item-grid">
                            <label className="field">
                              <span>同步链接码</span>
                              <textarea
                                value={syncShareCode}
                                rows={4}
                                readOnly
                                onFocus={(e) => e.currentTarget.select()}
                              />
                            </label>
                            {syncShareQrDataUrl ? (
                              <div className="field">
                                <span>同步二维码</span>
                                <img
                                  src={syncShareQrDataUrl}
                                  alt="同步链接二维码"
                                  style={{
                                    width: SYNC_QR_DISPLAY_SIZE,
                                    height: SYNC_QR_DISPLAY_SIZE,
                                    imageRendering: "pixelated",
                                    background: "#fff",
                                    padding: 8,
                                    borderRadius: 8,
                                  }}
                                />
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      <div className="settings-item-card">
                        <div className="settings-item-card-head">
                          <h5>链接已有同步库</h5>
                          <p>在新设备输入同步密码并扫描二维码（或粘贴链接码）完成绑定。</p>
                        </div>
                        <div className="settings-item-grid">
                          <label className="field">
                            <span>同步链接码</span>
                            <textarea
                              value={syncLinkForm?.share_code || ""}
                              rows={3}
                              onChange={(e) =>
                                setSyncLinkForm?.((prev: any) => ({ ...prev, share_code: e.target.value }))
                              }
                              placeholder="扫码后自动填入，或手动粘贴"
                            />
                          </label>
                          <label className="field">
                            <span>同步密码</span>
                            <input
                              type="password"
                              value={syncLinkForm?.sync_password || ""}
                              onChange={(e) =>
                                setSyncLinkForm?.((prev: any) => ({ ...prev, sync_password: e.target.value }))
                              }
                              placeholder="请输入同步密码"
                            />
                          </label>
                        </div>
                        <div className="settings-item-grid">
                          <button
                            type="button"
                            className="primary-btn"
                            onClick={() => {
                              if (typeof handleSyncSetupLink === "function") {
                                void handleSyncSetupLink();
                              }
                            }}
                            disabled={!!syncSetupBusy}
                          >
                            {syncSetupBusy ? "处理中..." : "链接并同步"}
                          </button>
                        </div>
                        {syncSetupError ? <p className="inline-hint" style={{ color: "#c0392b" }}>{syncSetupError}</p> : null}
                        {syncActionMessage ? <p className="inline-hint">{syncActionMessage}</p> : null}
                      </div>
                    </>
                  )}

                  <p className="inline-hint">设置会自动保存到本地设备，并在下次打开应用时继续生效。</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
