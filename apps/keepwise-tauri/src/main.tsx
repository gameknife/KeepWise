import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

type RootErrorBoundaryState = {
  errorMessage: string | null;
  stack: string | null;
};

class RootErrorBoundary extends React.Component<React.PropsWithChildren, RootErrorBoundaryState> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { errorMessage: null, stack: null };
  }

  static getDerivedStateFromError(error: unknown): RootErrorBoundaryState {
    return {
      errorMessage: error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown UI error",
      stack: error instanceof Error && typeof error.stack === "string" ? error.stack : null,
    };
  }

  componentDidCatch(error: unknown) {
    console.error("RootErrorBoundary caught render error", error);
  }

  render() {
    if (this.state.errorMessage) {
      return (
        <main
          style={{
            minHeight: "100vh",
            padding: "16px",
            color: "#f3efe5",
            background: "#0b1319",
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
          }}
        >
          <h1 style={{ marginTop: 0 }}>UI Render Error</h1>
          <p>{this.state.errorMessage}</p>
          {this.state.stack ? (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                background: "rgba(255,255,255,0.05)",
                padding: "12px",
                borderRadius: "8px",
                overflow: "auto",
              }}
            >
              {this.state.stack}
            </pre>
          ) : null}
        </main>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>,
);
