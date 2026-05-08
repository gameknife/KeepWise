type WorkspaceSidebarProps = Record<string, unknown>;

export function WorkspaceSidebar(props: WorkspaceSidebarProps) {
  const {
    sidebarCollapsed,
    setSidebarCollapsed,
    keepwiseLogoSvg,
    PRODUCT_TABS,
    activeTab,
    openQuickManualInvestmentModal,
    openQuickManualAssetValuationModal,
    setActiveTab,
    returnTabQuickMetricLabel,
    incomeTabMonthlyLabel,
    consumptionTabMonthlyLabel,
    wealthTabMonthlyGrowthLabel,
    returnTabAnnualizedText,
    returnTabNetGrowthText,
    manualEntryTabMonthCountText,
    manualAssetEntryLastDateLabel,
    manualAssetEntryLastDateText,
    wealthTabMonthlyGrowthText,
    wealthTabNetAssetText,
    fireTabFreedomText,
    fireTabInvestableText,
    incomeTabMonthlyText,
    incomeTabYearTotalLabel,
    incomeTabYearTotalText,
    consumptionTabMonthlyText,
    consumptionTabYearTotalLabel,
    consumptionTabYearTotalText,
    returnTabAnnualizedTone,
    returnTabNetGrowthTone,
    wealthTabMonthlyGrowthTone,
    wealthTabNetAssetTone,
    fireTabFreedomTone,
    fireTabInvestableTone,
    incomeTabMonthlyTone,
    incomeTabYearTotalTone,
    consumptionTabMonthlyTone,
    consumptionTabYearTotalTone,
    setSettingsOpen,
    amountPrivacyMasked,
    setAmountPrivacyMasked,
    syncQuickState,
    syncQuickTitle,
    syncQuickAriaLabel,
    handleQuickSyncIndicatorClick,
  } = props as Record<string, any>;

  return (
    <>
        <aside className={`card workspace-sidebar ${sidebarCollapsed ? "collapsed" : ""}`} aria-label="功能导航">
          <div className="workspace-sidebar-head">
            <div className="workspace-brand">
              <div className="workspace-brand-icon" aria-hidden="true">
                <img src={keepwiseLogoSvg} alt="" />
              </div>
              <div className="workspace-brand-text">
                <div className="workspace-brand-name">KeepWise | 知衡</div>
              </div>
            </div>
            <button
              type="button"
              className="sidebar-toggle-btn"
              onClick={() => setSidebarCollapsed((v: string) => !v)}
              title={sidebarCollapsed ? "展开侧栏" : "收纳侧栏（仅显示图标）"}
              aria-label={sidebarCollapsed ? "展开侧栏" : "收纳侧栏"}
              aria-pressed={sidebarCollapsed}
            >
              {sidebarCollapsed ? ">" : "<"}
            </button>
          </div>
          <nav className="tab-nav">
        {PRODUCT_TABS.map((tab: Record<string, any>) => {
              const isReturnTabButton = tab.key === "return-analysis";
              const isWealthTabButton = tab.key === "wealth-overview";
              const isFireTabButton = tab.key === "budget-fire";
              const isIncomeTabButton = tab.key === "income-analysis";
              const isConsumptionTabButton = tab.key === "consumption-analysis";
              const isManualEntryLauncherButton = tab.key === "manual-entry";
              const isManualEntryTabButton = tab.key === "manual-entry";
              const isManualAssetEntryTabButton = tab.key === "manual-asset-entry";
              const isManualAssetEntryLauncherButton = tab.key === "manual-asset-entry";
              const isFeaturedTabButton =
                (isManualEntryTabButton
                || isManualAssetEntryTabButton
                || isReturnTabButton
                || isWealthTabButton
                || isFireTabButton
                || isIncomeTabButton
                || isConsumptionTabButton)
                && !sidebarCollapsed;
              const quickMetrics = isManualEntryTabButton
                ? [{ label: "本月已记", value: manualEntryTabMonthCountText, tone: "default" }]
                : isManualAssetEntryTabButton
                  ? [{ label: manualAssetEntryLastDateLabel, value: manualAssetEntryLastDateText, tone: "default" }]
                  : isReturnTabButton
                    ? [
                        { label: returnTabQuickMetricLabel, value: returnTabAnnualizedText, tone: returnTabAnnualizedTone },
                        { label: `${new Date().getFullYear()}年净增`, value: returnTabNetGrowthText, tone: returnTabNetGrowthTone },
                      ]
                      : isWealthTabButton
                        ? [
                            { label: wealthTabMonthlyGrowthLabel, value: wealthTabMonthlyGrowthText, tone: wealthTabMonthlyGrowthTone },
                            { label: "净资产", value: wealthTabNetAssetText, tone: wealthTabNetAssetTone },
                          ]
                      : isFireTabButton
                        ? [
                            { label: "自由度", value: fireTabFreedomText, tone: fireTabFreedomTone },
                            { label: "可投金额", value: fireTabInvestableText, tone: fireTabInvestableTone },
                          ]
                        : isIncomeTabButton
                          ? [
                              { label: incomeTabMonthlyLabel, value: incomeTabMonthlyText, tone: incomeTabMonthlyTone },
                              { label: incomeTabYearTotalLabel, value: incomeTabYearTotalText, tone: incomeTabYearTotalTone },
                            ]
                          : isConsumptionTabButton
                            ? [
                                { label: consumptionTabMonthlyLabel, value: consumptionTabMonthlyText, tone: consumptionTabMonthlyTone },
                                { label: consumptionTabYearTotalLabel, value: consumptionTabYearTotalText, tone: consumptionTabYearTotalTone },
                              ]
                            : [];
              const titleSuffix = quickMetrics.length > 0
                ? ` · ${quickMetrics.map((metric) => `${metric.label} ${metric.value}`).join(" · ")}`
                : "";
              return (
                <button
                  key={tab.key}
                  type="button"
                  className={`tab-nav-btn ${activeTab === tab.key ? "active" : ""} ${isFeaturedTabButton ? "tab-nav-btn-featured" : ""}`}
                  onClick={() => {
                    if (isManualEntryLauncherButton) {
                      openQuickManualInvestmentModal();
                      return;
                    }
                    if (isManualAssetEntryLauncherButton) {
                      openQuickManualAssetValuationModal();
                      return;
                    }
                    setActiveTab(tab.key);
                  }}
                  title={`${tab.label} · ${tab.subtitle}${titleSuffix}`}
                >
                  <span className="tab-nav-main">
                    <span className={`tab-nav-icon tab-status-${tab.status} tab-icon-${tab.key}`} aria-hidden="true">
                      {tab.icon}
                    </span>
                    <span className="tab-nav-title">{tab.label}</span>
                  </span>
                  {isFeaturedTabButton ? (
                    <span className={`tab-nav-quick-metrics metrics-${Math.min(quickMetrics.length, 2) || 1}`} aria-hidden="true">
                      {quickMetrics.map((metric, index) => {
                        const quickMetricTextLen = metric.value.replace(/\s+/g, "").length;
                        const quickMetricSizeClass =
                          quickMetricTextLen >= 14 ? "size-xs" : quickMetricTextLen >= 11 ? "size-sm" : "size-md";
                        return (
                          <span key={`${tab.key}-metric-${index}`} className={`tab-nav-quick-metric tone-${metric.tone}`}>
                            <span className="tab-nav-quick-metric-label">{metric.label}</span>
                            <span className={`tab-nav-quick-metric-value ${quickMetricSizeClass}`}>{metric.value}</span>
                          </span>
                        );
                      })}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
          <div className="workspace-sidebar-footer">
            <button
              type="button"
              className="sidebar-tool-btn"
              onClick={() => setSettingsOpen(true)}
              title="打开设置"
              aria-label="打开设置"
            >
              <span className="sidebar-tool-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3.1" />
                  <circle cx="12" cy="12" r="7.1" />
                  <path d="M12 2.9v2.2" />
                  <path d="M12 18.9v2.2" />
                  <path d="M21.1 12h-2.2" />
                  <path d="M5.1 12H2.9" />
                  <path d="M18.4 5.6 16.8 7.2" />
                  <path d="M7.2 16.8 5.6 18.4" />
                  <path d="M18.4 18.4 16.8 16.8" />
                  <path d="M7.2 7.2 5.6 5.6" />
                </svg>
              </span>
            </button>
            <button
              type="button"
              className={`sidebar-tool-btn sidebar-sync-btn state-${syncQuickState}`}
              onClick={() => {
                void handleQuickSyncIndicatorClick();
              }}
              title={syncQuickTitle}
              aria-label={syncQuickAriaLabel}
              disabled={syncQuickState === "syncing"}
            >
              <span className={`sidebar-sync-icon ${syncQuickState === "syncing" ? "sync-icon-spin" : ""}`} aria-hidden="true">
                {syncQuickState === "synced" ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="8.2" />
                    <path d="m8.4 12.3 2.4 2.5 4.8-5.1" />
                  </svg>
                ) : syncQuickState === "pending" ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="8.2" />
                    <path d="M12 7.8v4.6" />
                    <path d="M12 12.4h3.5" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
                    <path d="M20 4v5h-5" />
                  </svg>
                )}
              </span>
            </button>
            <button
              type="button"
              className={`sidebar-tool-btn sidebar-privacy-btn ${amountPrivacyMasked ? "active" : ""}`}
              onClick={() => setAmountPrivacyMasked((v: string) => !v)}
              title={amountPrivacyMasked ? "关闭隐私显示（显示实际金额）" : "开启隐私显示（隐藏实际金额）"}
              aria-label={amountPrivacyMasked ? "关闭隐私显示" : "开启隐私显示"}
              aria-pressed={amountPrivacyMasked}
            >
              <span className="sidebar-privacy-icon" aria-hidden="true">
                {amountPrivacyMasked ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3l18 18" />
                    <path d="M10.58 10.58a2 2 0 102.83 2.83" />
                    <path d="M9.36 5.37A10.9 10.9 0 0112 5c5.05 0 8.73 3.11 10 7-0.47 1.43-1.39 2.79-2.72 3.95" />
                    <path d="M6.23 6.23C4.85 7.35 3.86 8.74 3 12c1.27 3.89 4.95 7 10 7 1.06 0 2.07-.14 3.01-.4" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </span>
            </button>
          </div>
        </aside>
    </>
  );
}
