import keepwiseLogoSvg from "../../assets/keepwise-logo.svg";
import { type useAppShellController } from "../../app/useAppShellController";
import { type useSyncRuntimeController } from "../sync/useSyncRuntimeController";

export function MobileWorkspaceHeader(props: {
  shell: ReturnType<typeof useAppShellController>;
  sync: ReturnType<typeof useSyncRuntimeController>;
}) {
  const { shell, sync } = props;
  if (!shell.isMobileMode) return null;
  return <div className={`mobile-page-header ${shell.mobileView === "home" ? "mode-home" : "mode-tab"}`}>
    <div className="mobile-page-header-left">
      {shell.mobileView !== "home" ? (
        <button type="button" className="mobile-back-btn" onClick={() => shell.setMobileView("home")} aria-label="返回首页">
          <span className="mobile-back-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5 8 12l7 7" /></svg>
          </span>
        </button>
      ) : null}
      {shell.mobileView === "home" ? (
        <div className="workspace-brand mobile-home-brand" aria-label="KeepWise 品牌">
          <span className="workspace-brand-icon" aria-hidden="true"><img src={keepwiseLogoSvg} alt="" /></span>
          <div className="workspace-brand-text"><div className="workspace-brand-name">KeepWise | 知衡</div></div>
        </div>
      ) : (
        <div className="mobile-page-title-group">
          <div className="mobile-page-title">{shell.activeTabMeta.label}</div>
          <div className="mobile-page-subtitle">{shell.activeTabMeta.subtitle}</div>
        </div>
      )}
    </div>
    <div className="mobile-page-header-actions">
      <button
        type="button"
        className={`sidebar-tool-btn mobile-icon-btn sidebar-privacy-btn ${shell.amountPrivacyMasked ? "active" : ""}`}
        onClick={() => shell.setAmountPrivacyMasked((value) => !value)}
        aria-label={shell.amountPrivacyMasked ? "关闭隐私显示" : "开启隐私显示"}
        aria-pressed={shell.amountPrivacyMasked}
      >
        <span className="sidebar-privacy-icon" aria-hidden="true">
          {shell.amountPrivacyMasked ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3l18 18" /><path d="M10.58 10.58a2 2 0 102.83 2.83" /><path d="M9.36 5.37A10.9 10.9 0 0112 5c5.05 0 8.73 3.11 10 7-0.47 1.43-1.39 2.79-2.72 3.95" /><path d="M6.23 6.23C4.85 7.35 3.86 8.74 3 12c1.27 3.89 4.95 7 10 7 1.06 0 2.07-.14 3.01-.4" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" /><circle cx="12" cy="12" r="3" /></svg>
          )}
        </span>
      </button>
      <button
        type="button"
        className={`sidebar-tool-btn mobile-icon-btn sidebar-sync-btn state-${sync.quickState}`}
        onClick={() => void sync.handleQuickIndicatorClick()}
        title={sync.quickTitle}
        aria-label={sync.quickAriaLabel}
        disabled={sync.quickState === "syncing"}
      >
        <span className={`sidebar-sync-icon ${sync.quickState === "syncing" ? "sync-icon-spin" : ""}`} aria-hidden="true">
          {sync.quickState === "synced" ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.2" /><path d="m8.4 12.3 2.4 2.5 4.8-5.1" /></svg>
          ) : sync.quickState === "pending" ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.2" /><path d="M12 7.8v4.6" /><path d="M12 12.4h3.5" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v5h-5" /></svg>
          )}
        </span>
      </button>
      <button type="button" className="sidebar-tool-btn mobile-icon-btn" onClick={() => shell.setSettingsOpen(true)} aria-label="打开设置">
        <span className="sidebar-tool-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3.1" /><circle cx="12" cy="12" r="7.1" /><path d="M12 2.9v2.2" /><path d="M12 18.9v2.2" /><path d="M21.1 12h-2.2" /><path d="M5.1 12H2.9" /><path d="M18.4 5.6 16.8 7.2" /><path d="M7.2 16.8 5.6 18.4" /><path d="M18.4 18.4 16.8 16.8" /><path d="M7.2 7.2 5.6 5.6" />
          </svg>
        </span>
      </button>
    </div>
  </div>;
}
