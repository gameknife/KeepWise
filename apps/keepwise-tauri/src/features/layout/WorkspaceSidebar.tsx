// @ts-nocheck
export function WorkspaceSidebar(props: any) {
  const {
    sidebarCollapsed,
    setSidebarCollapsed,
    keepwiseLogoSvg,
    PRODUCT_TABS,
    activeTab,
    openQuickManualInvestmentModal,
    setActiveTab,
    returnTabQuickMetricLabel,
    incomeTabMonthlyLabel,
    consumptionTabMonthlyLabel,
    wealthTabMonthlyGrowthLabel,
    returnTabAnnualizedText,
    manualEntryTabMonthCountText,
    wealthTabMonthlyGrowthText,
    fireTabFreedomText,
    incomeTabMonthlyText,
    consumptionTabMonthlyText,
    returnTabAnnualizedTone,
    wealthTabMonthlyGrowthTone,
    fireTabFreedomTone,
    incomeTabMonthlyTone,
    consumptionTabMonthlyTone,
    setSettingsOpen,
    amountPrivacyMasked,
    setAmountPrivacyMasked,
  } = props;

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
              onClick={() => setSidebarCollapsed((v) => !v)}
              title={sidebarCollapsed ? "展开侧栏" : "收纳侧栏（仅显示图标）"}
              aria-label={sidebarCollapsed ? "展开侧栏" : "收纳侧栏"}
              aria-pressed={sidebarCollapsed}
            >
              {sidebarCollapsed ? ">" : "<"}
            </button>
          </div>
          <nav className="tab-nav">
            {PRODUCT_TABS.map((tab) => {
              const isReturnTabButton = tab.key === "return-analysis";
              const isWealthTabButton = tab.key === "wealth-overview";
              const isFireTabButton = tab.key === "budget-fire";
              const isIncomeTabButton = tab.key === "income-analysis";
              const isConsumptionTabButton = tab.key === "consumption-analysis";
              const isManualEntryLauncherButton = tab.key === "manual-entry";
              const isManualEntryTabButton = tab.key === "manual-entry";
              const isFeaturedTabButton =
                (isManualEntryTabButton
                || isReturnTabButton
                || isWealthTabButton
                || isFireTabButton
                || isIncomeTabButton
                || isConsumptionTabButton)
                && !sidebarCollapsed;
              const quickMetricLabel = isManualEntryTabButton
                ? "本月已记"
                : isReturnTabButton
                  ? returnTabQuickMetricLabel
                  : isWealthTabButton
                    ? "月度增长"
                    : isFireTabButton
                      ? "自由度"
                      : isIncomeTabButton
                        ? incomeTabMonthlyLabel
                        : isConsumptionTabButton
                          ? consumptionTabMonthlyLabel
                          : "";
              const resolvedQuickMetricLabel = isWealthTabButton ? wealthTabMonthlyGrowthLabel : quickMetricLabel;
              const quickMetricText = isReturnTabButton
                ? returnTabAnnualizedText
                : isManualEntryTabButton
                  ? manualEntryTabMonthCountText
                : isWealthTabButton
                  ? wealthTabMonthlyGrowthText
                  : isFireTabButton
                    ? fireTabFreedomText
                  : isIncomeTabButton
                    ? incomeTabMonthlyText
                    : isConsumptionTabButton
                      ? consumptionTabMonthlyText
                  : "-";
              const quickMetricTone = isReturnTabButton
                ? returnTabAnnualizedTone
                : isManualEntryTabButton
                  ? "default"
                : isWealthTabButton
                  ? wealthTabMonthlyGrowthTone
                  : isFireTabButton
                    ? fireTabFreedomTone
                  : isIncomeTabButton
                    ? incomeTabMonthlyTone
                    : isConsumptionTabButton
                      ? consumptionTabMonthlyTone
                  : "default";
              const quickMetricTextLen = quickMetricText.replace(/\s+/g, "").length;
              const quickMetricSizeClass =
                quickMetricTextLen >= 14 ? "size-xs" : quickMetricTextLen >= 11 ? "size-sm" : "size-md";
              const titleSuffix = isReturnTabButton
                ? ` · ${resolvedQuickMetricLabel} ${quickMetricText}`
                : isManualEntryTabButton
                  ? ` · ${resolvedQuickMetricLabel} ${quickMetricText}`
                : isWealthTabButton
                  ? ` · ${resolvedQuickMetricLabel} ${quickMetricText}`
                  : isFireTabButton
                    ? ` · ${resolvedQuickMetricLabel} ${quickMetricText}`
                  : isIncomeTabButton
                    ? ` · ${resolvedQuickMetricLabel} ${quickMetricText}`
                    : isConsumptionTabButton
                      ? ` · ${resolvedQuickMetricLabel} ${quickMetricText}`
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
                    <span className={`tab-nav-quick-metric tone-${quickMetricTone}`} aria-hidden="true">
                      <span className="tab-nav-quick-metric-label">{resolvedQuickMetricLabel}</span>
                      <span className={`tab-nav-quick-metric-value ${quickMetricSizeClass}`}>{quickMetricText}</span>
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
              className={`sidebar-tool-btn sidebar-privacy-btn ${amountPrivacyMasked ? "active" : ""}`}
              onClick={() => setAmountPrivacyMasked((v) => !v)}
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
