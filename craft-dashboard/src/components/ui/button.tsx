import React from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'brand';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading = false, children, disabled, ...props }, ref) => {
    const baseStyles =
      'inline-flex items-center justify-center font-medium transition-all duration-150 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50 disabled:pointer-events-none select-none text-xs sm:text-sm';

    const variants = {
      primary: 'bg-brand-600 text-white hover:bg-brand-500 active:bg-brand-700 shadow-sm border border-brand-500/30',
      brand: 'bg-indigo-600 text-white hover:bg-indigo-500 active:bg-indigo-700 shadow-sm border border-indigo-500/30',
      secondary: 'bg-surface-elevated text-slate-200 hover:bg-surface-highlight border border-border',
      outline: 'bg-transparent text-slate-300 hover:bg-surface-elevated border border-border hover:border-slate-600',
      ghost: 'bg-transparent text-slate-400 hover:text-slate-200 hover:bg-surface-elevated',
      destructive: 'bg-rose-950/80 text-rose-300 hover:bg-rose-900 border border-rose-800/60 active:bg-rose-950',
    };

    const sizes = {
      sm: 'h-8 px-2.5 py-1 text-xs',
      md: 'h-9 px-3.5 py-1.5',
      lg: 'h-11 px-5 py-2.5 text-base',
      icon: 'h-8 w-8 p-0',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      >
        {isLoading && <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" />}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
