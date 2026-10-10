import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  fallback: (error: Error) => ReactNode;
  children: ReactNode;
}

/** Catches render errors in a subtree (e.g. WebGL context creation failing) so the page stays usable. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Viewer render error", error, info.componentStack);
  }

  render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}
