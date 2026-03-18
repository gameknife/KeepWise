import type { ProductTabDef, ProductTabKey } from "../../types/app";

type MobileHomeMetric = {
  label: string;
  value: string;
  tone: "default" | "good" | "warn";
};

type MobileHomeGridProps = {
  tabs: ProductTabDef[];
  activeTab: ProductTabKey;
  onSelectTab: (tabKey: ProductTabKey) => void;
  onOpenManualEntry: () => void;
  onOpenManualAssetEntry: () => void;
  quickMetricsByTab: Partial<Record<ProductTabKey, MobileHomeMetric[]>>;
};

export function MobileHomeGrid({
  tabs,
  activeTab,
  onSelectTab,
  onOpenManualEntry,
  onOpenManualAssetEntry,
  quickMetricsByTab,
}: MobileHomeGridProps) {

  return (
    <section className="mobile-home-grid" aria-label="移动端功能首页">
      {tabs.map((tab) => {
        const metrics = quickMetricsByTab[tab.key] ?? [];
        const isManualEntry = tab.key === "manual-entry";
        const isManualAssetEntry = tab.key === "manual-asset-entry";
        return (
          <button
            key={tab.key}
            type="button"
            className={`mobile-home-tile ${activeTab === tab.key ? "active" : ""}`}
            onClick={() => {
              if (isManualEntry) {
                onOpenManualEntry();
                return;
              }
              if (isManualAssetEntry) {
                onOpenManualAssetEntry();
                return;
              }
              onSelectTab(tab.key);
            }}
            title={tab.label}
          >
            <div className="mobile-home-tile-head">
              <span className={`tab-nav-icon tab-status-${tab.status} tab-icon-${tab.key}`} aria-hidden="true">
                {tab.icon}
              </span>
              <div className="mobile-home-tile-title-wrap">
                <div className="mobile-home-tile-title">{tab.label}</div>
              </div>
            </div>
            {metrics.length > 0 ? (
              <div className={`mobile-home-tile-metrics metrics-${Math.min(metrics.length, 2) || 1}`}>
                {metrics.map((metric, index) => (
                  <div key={`${tab.key}-metric-${index}`} className={`mobile-home-tile-metric tone-${metric.tone}`}>
                    <span className="mobile-home-tile-metric-label">{metric.label}</span>
                    <span className="mobile-home-tile-metric-value">{metric.value}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </button>
        );
      })}
    </section>
  );
}
