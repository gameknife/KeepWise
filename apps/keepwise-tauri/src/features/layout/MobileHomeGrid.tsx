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
  quickMetricsByTab: Partial<Record<ProductTabKey, MobileHomeMetric>>;
};

export function MobileHomeGrid({
  tabs,
  activeTab,
  onSelectTab,
  onOpenManualEntry,
  quickMetricsByTab,
}: MobileHomeGridProps) {

  return (
    <section className="mobile-home-grid" aria-label="移动端功能首页">
      {tabs.map((tab) => {
        const metric = quickMetricsByTab[tab.key] ?? null;
        const isManualEntry = tab.key === "manual-entry";
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
            {metric ? (
              <div className={`mobile-home-tile-metric tone-${metric.tone}`}>
                <span className="mobile-home-tile-metric-label">{metric.label}</span>
                <span className="mobile-home-tile-metric-value">{metric.value}</span>
              </div>
            ) : null}
          </button>
        );
      })}
    </section>
  );
}
