// @ts-nocheck
export function AppSettingsModal(props: any) {
  const {
    settingsOpen,
    setSettingsOpen,
    appSettings,
    setAppSettings,
  } = props;

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
                    <button type="button" className="settings-nav-item active">
                      <span className="settings-nav-item-title">显示</span>
                      <span className="settings-nav-item-subtitle">颜色与展示风格</span>
                    </button>
                  </aside>

                  <div className="settings-content">
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
