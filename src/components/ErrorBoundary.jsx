import React from "react";
import { PageError } from "@/components/ui/page-state";
import { debugLog } from "@/lib/debug";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
    this.handleReset = this.handleReset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    if (import.meta.env?.DEV) {
      console.error("Unhandled UI error", error, info);
    }
    debugLog("ui", "ErrorBoundary caught error", {
      message: error?.message,
      stack: error?.stack
    });
  }

  handleReset() {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  }

  render() {
    if (this.state.hasError) {
      const { fallback } = this.props;
      if (typeof fallback === "function") {
        return fallback({ error: this.state.error, reset: this.handleReset });
      }
      if (fallback) {
        return fallback;
      }
      return (
        <div className="p-8 max-w-5xl mx-auto">
          <PageError error={this.state.error} onRetry={this.handleReset} />
        </div>
      );
    }

    return this.props.children;
  }
}
