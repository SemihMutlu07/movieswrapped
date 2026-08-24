'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

import { captureException } from '@/lib/posthog';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ error, errorInfo });

    captureException(error, {
      source: 'react_error_boundary',
      component_stack: errorInfo.componentStack,
    });

    if (process.env.NODE_ENV === 'development') {
      console.error('ErrorBoundary caught an error:', error, errorInfo);
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  handleGoHome = () => {
    const locale = document.documentElement.lang === 'tr' ? 'tr' : 'en';
    window.location.href = `/${locale}`;
  };

  render() {
    if (this.state.hasError) {
      const isTurkish = typeof document !== 'undefined' && document.documentElement.lang === 'tr';
      const copy = isTurkish
        ? {
            title: 'Bir şeyler ters gitti',
            message: 'Beklenmeyen bir hatayla karşılaştık. Verilerin güvende.',
            details: 'Hata ayrıntıları (yalnızca geliştirme)',
            retry: 'Tekrar Dene',
            home: 'Ana Sayfa',
          }
        : {
            title: 'Something went wrong',
            message: 'We encountered an unexpected error. Don\'t worry, your data is safe.',
            details: 'Error details (development only)',
            retry: 'Try Again',
            home: 'Go Home',
          };

      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-slate-800 rounded-2xl border border-red-500/20 p-6 text-center">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-red-400" />
            </div>

            <h1 className="text-xl font-bold text-white mb-2">{copy.title}</h1>
            <p className="text-slate-300 mb-6">{copy.message}</p>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mb-6 text-left">
                <summary className="text-sm text-slate-400 cursor-pointer mb-2">
                  {copy.details}
                </summary>
                <div className="bg-slate-900 rounded-lg p-3 text-xs font-mono text-red-300 overflow-auto max-h-32">
                  <div className="mb-2">
                    <strong>Error:</strong> {this.state.error.message}
                  </div>
                  {this.state.errorInfo && (
                    <div>
                      <strong>Stack:</strong>
                      <pre className="whitespace-pre-wrap mt-1">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    </div>
                  )}
                </div>
              </details>
            )}

            <div className="flex gap-3">
              <button
                onClick={this.handleRetry}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                {copy.retry}
              </button>

              <button
                onClick={this.handleGoHome}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Home className="w-4 h-4" />
                {copy.home}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function useErrorHandler() {
  return React.useCallback((error: Error, errorInfo?: ErrorInfo) => {
    captureException(error, {
      source: 'use_error_handler',
      component_stack: errorInfo?.componentStack,
    });

    if (process.env.NODE_ENV === 'development') {
      console.error('Error caught by useErrorHandler:', error, errorInfo);
    }
  }, []);
}
