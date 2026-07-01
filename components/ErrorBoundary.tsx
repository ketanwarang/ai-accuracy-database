"use client";

import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  label?: string;
  onRetry?: () => void;
}

interface State {
  hasError: boolean;
  error: string;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          background: "var(--bg-danger)", border: "0.5px solid var(--border-danger)",
          borderRadius: "var(--radius-lg)", padding: "1.25rem", textAlign: "center",
        }}>
          <i className="ti ti-alert-triangle" aria-hidden="true" style={{ fontSize: 22, color: "var(--text-danger)", display: "block", marginBottom: 8 }}></i>
          <p style={{ fontSize: 14, color: "var(--text-danger)", margin: "0 0 4px", fontWeight: 500 }}>
            {this.props.label || "Something went wrong"}
          </p>
          <p style={{ fontSize: 13, color: "var(--text-danger)", margin: "0 0 12px", opacity: 0.8 }}>
            {this.state.error}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: "" });
              this.props.onRetry?.();
            }}
            style={{ fontSize: 13 }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
