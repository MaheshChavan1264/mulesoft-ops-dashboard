import React from 'react';

/**
 * PageHeader
 *
 * Shared "icon chip + title + subtitle (+ optional actions)" header layout
 * that was hand-copied across 7 pages (ApiManagerPage, ExchangePage,
 * CpsManagerPage, CpsComparisonPage, GlobalCpsManagerPage, GlobalSearchPage,
 * PingTestPage) with only the gradient color and icon swapped — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §2/§10 finding "<PageHeader>".
 * `ApplicationsPage` already deviated from this pattern (no icon chip),
 * which is exactly the kind of drift centralizing this component prevents
 * going forward.
 *
 * The gradient itself is passed as a literal className string (not a fixed
 * enum) since different pages use different two-color gradients
 * (`from-sf-500 to-sfteal-500`, `from-sfpurple-500 to-sf-500`, etc.) that
 * don't reduce to a small closed set — the shared part this component
 * actually de-duplicates is the layout/sizing/shadow/typography, not the
 * color choice.
 *
 * Props:
 *   icon       {Component}  lucide-react icon rendered in the gradient chip
 *   gradient   {string}     Tailwind gradient classes for the icon chip
 *                            background, e.g. 'from-sf-500 to-sfteal-500'
 *   shadow     {string}     Full Tailwind shadow classes for the chip
 *                            (including the size, e.g. 'shadow-md' or
 *                            'shadow-lg'), e.g.
 *                            'shadow-md shadow-sf-500/30 dark:shadow-sf-500/20'
 *                            (default matches the most common usage)
 *   title      {ReactNode}
 *   subtitle   {ReactNode}  optional, can be plain text or rich JSX (several
 *                            pages interpolate a highlighted BG/env name)
 *   actions    {ReactNode}  optional right-aligned slot (e.g. a Refresh button)
 *   className  {string}     extra classes on the outer flex row
 */
export default function PageHeader({
  icon: Icon,
  gradient = 'from-sf-500 to-sfteal-500',
  shadow = 'shadow-md shadow-sf-500/30 dark:shadow-sf-500/20',
  title,
  subtitle,
  actions,
  className = '',
}) {
  return (
    <div className={`flex items-center justify-between flex-wrap gap-3 ${className}`}>
      <div className="flex items-center gap-3.5">
        {Icon && (
          <div className={`p-3 rounded-2xl bg-gradient-to-br ${gradient} ${shadow} flex-shrink-0`}>
            <Icon size={20} className="text-white" />
          </div>
        )}
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{title}</h1>
          {subtitle && (
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
