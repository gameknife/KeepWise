import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type useManualEntryController } from "../features/accounts/useManualEntryController";
import { type AppSettings, type MobileView, type ProductTabDef, type ProductTabKey } from "../types/app";
import { parseStoredAppSettings } from "./helpers";

const STORAGE_KEY = "keepwise.desktop.app-settings.v1";

const DEFAULT_SETTINGS: AppSettings = {
  gainLossColorScheme: "cn_red_up_green_down",
  defaultPrivacyMaskOnLaunch: false,
  uiMotionEnabled: true,
  fireWithdrawalRate: "0.03",
  consumptionExcludeNeedsReviewByDefault: true,
  benchmarkMarketDataSource: "eastmoney",
  aiApiEndpoint: "https://api.openai.com/v1",
  aiApiKey: "",
  aiModel: "gpt-4.1-mini",
  aiLocalCliEnabled: false,
};

export function useAppShellController(inputs: {
  tabs: ProductTabDef[];
  targetOs?: string;
  manualEntry: ReturnType<typeof useManualEntryController>;
}) {
  const [viewportSize, setViewportSize] = useState(() => typeof window === "undefined"
    ? { width: 0, height: 0 }
    : { width: Math.round(window.visualViewport?.width ?? window.innerWidth), height: Math.round(window.visualViewport?.height ?? window.innerHeight) });
  const [activeTab, setActiveTab] = useState<ProductTabKey>("wealth-overview");
  const [mobileView, setMobileView] = useState<MobileView>("home");
  const sceneViewRef = useRef<MobileView>("home");
  const backTrapArmedRef = useRef(false);
  const [mobileSceneDirection, setMobileSceneDirection] = useState<"from-left" | "from-right">("from-right");
  const [mobileSceneSeq, setMobileSceneSeq] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>(() => typeof window === "undefined"
    ? DEFAULT_SETTINGS
    : parseStoredAppSettings(window.localStorage.getItem(STORAGE_KEY)));
  const [amountPrivacyMasked, setAmountPrivacyMasked] = useState(() => appSettings.defaultPrivacyMaskOnLaunch);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [developerMode, setDeveloperMode] = useState(false);

  const forcedMobile = import.meta.env.VITE_FORCE_MOBILE === "1";
  const nativeMobile = typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const landscape = viewportSize.width > 0 && viewportSize.width > viewportSize.height;
  const forceDesktopLayout = !forcedMobile && nativeMobile && landscape;
  const isMobileMode = forcedMobile || (nativeMobile && !forceDesktopLayout);
  const isDesktopApp = inputs.targetOs ? inputs.targetOs !== "android" && inputs.targetOs !== "ios" : !nativeMobile;
  const visibleTabs = isMobileMode ? inputs.tabs.filter((tab) => tab.key !== "admin") : inputs.tabs;
  const activeTabMeta = visibleTabs.find((tab) => tab.key === activeTab) ?? visibleTabs[0] ?? inputs.tabs[0];
  const mobileSceneAnimClass = mobileSceneSeq > 0
    ? (mobileSceneDirection === "from-left" ? "mobile-scene-enter-from-left" : "mobile-scene-enter-from-right")
    : "";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setViewportSize((prev) => {
      const next = { width: Math.round(window.visualViewport?.width ?? window.innerWidth), height: Math.round(window.visualViewport?.height ?? window.innerHeight) };
      return prev.width === next.width && prev.height === next.height ? prev : next;
    });
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    window.visualViewport?.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
      window.visualViewport?.removeEventListener("resize", sync);
    };
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(appSettings)); } catch { /* storage can be unavailable */ }
  }, [appSettings]);

  useEffect(() => { if (isMobileMode) setMobileView("home"); }, [isMobileMode]);
  useEffect(() => {
    if (visibleTabs.some((tab) => tab.key === activeTab)) return;
    setActiveTab("wealth-overview");
    if (isMobileMode) setMobileView("home");
  }, [activeTab, visibleTabs, isMobileMode]);

  useEffect(() => {
    if (!isMobileMode || typeof window === "undefined") {
      backTrapArmedRef.current = false;
      return;
    }
    if (!backTrapArmedRef.current) {
      try { window.history.pushState({ keepwise_mobile_back_trap: true }, ""); backTrapArmedRef.current = true; } catch { /* ignore */ }
    }
    const onPopState = () => {
      let handled = true;
      if (inputs.manualEntry.assetOpen) {
        if (!inputs.manualEntry.assetBusy) inputs.manualEntry.closeAsset();
      } else if (inputs.manualEntry.investmentOpen) {
        if (!inputs.manualEntry.investmentBusy) inputs.manualEntry.closeInvestment();
      } else if (inputs.manualEntry.editOpen) {
        if (!inputs.manualEntry.editBusy) inputs.manualEntry.closeEdit();
      } else if (settingsOpen) {
        setSettingsOpen(false);
      } else if (mobileView !== "home") {
        setMobileView("home");
      } else {
        handled = false;
      }
      if (handled) {
        try { window.history.pushState({ keepwise_mobile_back_trap: true }, ""); backTrapArmedRef.current = true; } catch { /* ignore */ }
      } else backTrapArmedRef.current = false;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [isMobileMode, mobileView, inputs.manualEntry.assetOpen, inputs.manualEntry.assetBusy, inputs.manualEntry.investmentOpen, inputs.manualEntry.investmentBusy, inputs.manualEntry.editOpen, inputs.manualEntry.editBusy, settingsOpen]);

  useLayoutEffect(() => {
    if (!isMobileMode) { sceneViewRef.current = "home"; return; }
    if (sceneViewRef.current === mobileView) return;
    setMobileSceneDirection(mobileView === "home" ? "from-left" : "from-right");
    setMobileSceneSeq((value) => value + 1);
    sceneViewRef.current = mobileView;
  }, [isMobileMode, mobileView]);

  return {
    activeTab, setActiveTab, activeTabMeta, visibleTabs,
    mobileView, setMobileView, mobileSceneSeq, mobileSceneAnimClass,
    sidebarCollapsed, setSidebarCollapsed,
    appSettings, setAppSettings,
    amountPrivacyMasked, setAmountPrivacyMasked,
    settingsOpen, setSettingsOpen,
    developerMode, setDeveloperMode,
    isMobileMode, forceDesktopLayout, isDesktopApp,
  };
}
