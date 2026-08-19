import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Catches render/runtime errors anywhere below it so a single failing page
 * degrades to a recoverable message instead of white-screening the whole app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-4">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            This page hit an unexpected error. You can retry, or head back to the shop.
          </p>
          {import.meta.env.DEV && (
            <pre className="text-left text-xs bg-muted p-3 rounded overflow-auto max-h-40">
              {error.message}
            </pre>
          )}
          <div className="flex gap-2 justify-center">
            <Button onClick={this.reset} data-testid="button-error-retry">Try again</Button>
            <Button
              variant="outline"
              onClick={() => { window.location.href = "/shop"; }}
              data-testid="button-error-home"
            >
              Go to shop
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
