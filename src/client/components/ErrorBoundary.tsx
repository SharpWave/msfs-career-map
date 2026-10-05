import { Component, type ReactNode } from "react";

interface Props {
  /** Short name of the piece, shown when it fails. */
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Keeps one broken piece of UI from blanking the whole page: the failure is shown in place with
 * a retry, and the map and logbook keep working.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.label}]`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error">
          {this.props.label} failed: {this.state.error.message}{" "}
          <button type="button" className="small" onClick={() => this.setState({ error: null })}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
