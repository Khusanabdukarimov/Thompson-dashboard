import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';

type Props = { children: ReactNode; fallback?: (err: Error, reset: () => void) => ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary:', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return (
        <div className="flex-1 flex items-center justify-center p-6 bg-bg">
          <div className="max-w-md text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-bg border border-red-bd flex items-center justify-center text-red">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div className="text-[16px] font-semibold mb-2">Sahifada xatolik</div>
            <div className="text-[13px] text-text2 mb-1">Komponent ishlashida xato yuz berdi.</div>
            <code className="block text-[11px] text-red bg-red-bg border border-red-bd rounded p-2 mt-3 mb-4 text-left whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
              {this.state.error.message}
            </code>
            <div className="flex gap-2 justify-center">
              <Button onClick={() => window.location.reload()}>Qayta yuklash</Button>
              <Button variant="primary" onClick={this.reset}>Qayta urinish</Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
