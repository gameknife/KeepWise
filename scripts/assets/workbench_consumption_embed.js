    function initConsumptionEmbed() {
      const frame = document.getElementById("consumptionFrame");
      const reloadBtn = document.getElementById("consumptionFrameReloadBtn");
      if (!frame || !reloadBtn) return;
      reloadBtn.addEventListener("click", () => {
        try {
          if (frame.contentWindow && frame.contentWindow.location) {
            frame.contentWindow.location.reload();
            return;
          }
        } catch {}
        frame.setAttribute("src", "/consumption");
      });
    }


    window.keepwiseWorkbench = Object.assign(window.keepwiseWorkbench || {}, {
      initConsumptionEmbed,
    });
