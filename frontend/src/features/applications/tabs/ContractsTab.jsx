import React from 'react';
import { Key, Check, AlertTriangle, X, Trash2, RefreshCw, ShieldCheck } from 'lucide-react';
import TableHeader from '../../../components/ui/TableHeader';
import CopyBtn from '../../../components/shared/CopyBtn';
import Tooltip from '../../../components/ui/Tooltip';
import { GlassCard, StatTile } from '../shared';
import { getContractStatusClasses } from '../../../utils/accentColors';

/**
 * ContractsTab — ApplicationDetailPage's "Contracts" tab.
 *
 * Extracted from pages/ApplicationDetailPage.jsx — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §4 "god component" finding.
 */

// Toolbar button — mirrors the icon-chip "ghost pill" convention already
// established by features/applications/shared.jsx's HeroActionBtn, kept
// local to this file since it needs disabled/spinning support that
// HeroActionBtn's shared API doesn't expose.
function ToolbarBtn({ icon: Icon, label, accent = 'sf', onClick, disabled, spinning, title }) {
  const chip = accent === 'teal'
    ? 'bg-sfteal-100 dark:bg-sfteal-500/15 text-sfteal-600 dark:text-sfteal-400 group-hover:bg-sfteal-600 group-hover:text-white'
    : 'bg-sf-100 dark:bg-sf-500/15 text-sf-600 dark:text-sf-400 group-hover:bg-sf-600 group-hover:text-white';
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className="group flex items-center gap-2 pl-1.5 pr-3.5 py-1.5 rounded-xl text-xs font-semibold text-gray-500 dark:text-gray-400 bg-white/70 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700/60 hover:border-transparent hover:bg-white dark:hover:bg-gray-800 hover:shadow-md disabled:opacity-50 disabled:pointer-events-none transition-all">
      <span className={`flex items-center justify-center w-6 h-6 rounded-lg transition-all duration-200 ${chip}`}>
        <Icon size={12} className={spinning ? 'animate-spin' : ''} />
      </span>
      {label}
    </button>
  );
}

// Compact circular icon-button used for row-level contract actions — denser
// and quieter than the previous text pills, with the tooltip surfacing the
// label instead of crowding the row.
function RowActionBtn({ icon: Icon, tone, muted, onClick, label }) {
  const toneCls = tone === 'emerald'
    ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200/60 dark:border-emerald-400/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 hover:shadow-emerald-500/30'
    : muted
      ? 'bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:bg-red-600 hover:text-white hover:border-red-600 hover:shadow-red-500/30'
      : 'bg-red-50 dark:bg-red-500/10 border-red-200/60 dark:border-red-400/20 text-red-600 dark:text-red-400 hover:bg-red-600 hover:text-white hover:border-red-600 hover:shadow-red-500/30';
  return (
    <Tooltip content={label}>
      <button
        onClick={onClick}
        aria-label={label}
        className={`flex items-center justify-center w-7 h-7 rounded-full border transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 hover:shadow-md ${toneCls}`}>
        <Icon size={13} />
      </button>
    </Tooltip>
  );
}

export default function ContractsTab({
  contracts, contractApiInstanceId, orgId, envId, navigate, loadContracts, contractsLoading,
  contractActionResult, setContractActionResult, contractsError, contractActionLoading, setContractConfirmState,
}) {
  const approvedCount = contracts ? contracts.filter(c => (c.status || '').toUpperCase() === 'APPROVED').length : 0;
  const pendingCount = contracts ? contracts.filter(c => !['APPROVED','REVOKED'].includes((c.status || '').toUpperCase())).length : 0;

  return (
    <div className="space-y-5">
      {/* Stat tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatTile icon={Key} label="Total Contracts" accent="emerald" value={contracts ? contracts.length : '—'} />
        <StatTile icon={Check} label="Approved" accent="emerald" value={contracts ? approvedCount : '—'} />
        <StatTile icon={AlertTriangle} label="Pending / Other" accent="amber" value={contracts ? pendingCount : '—'} />
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-gray-900 dark:text-gray-100 font-semibold text-sm">API Consumer Contracts</h2>
          <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">
            Client applications approved to consume this API instance
            {contractApiInstanceId && <span className="ml-2 font-mono text-gray-400 dark:text-gray-500">API ID: {contractApiInstanceId}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ToolbarBtn
            icon={ShieldCheck}
            label="Open in API Manager"
            accent="sf"
            title="Open API Manager for this environment"
            onClick={() => {
              localStorage.setItem('mule_apimgr_bg', orgId);
              if (envId) localStorage.setItem('mule_apimgr_env', envId);
              if (contractApiInstanceId) localStorage.setItem('mule_apimgr_instance', String(contractApiInstanceId));
              navigate('/api-manager');
            }}
          />
          <ToolbarBtn
            icon={RefreshCw}
            label={contracts ? 'Refresh' : 'Load'}
            accent="teal"
            disabled={contractsLoading}
            spinning={contractsLoading}
            onClick={loadContracts}
          />
        </div>
      </div>

      {/* Contract action result toast */}
      {contractActionResult && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border text-sm ${
          contractActionResult.success
            ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200/60 dark:border-emerald-400/20 text-emerald-700 dark:text-emerald-300'
            : 'bg-red-50 dark:bg-red-500/10 border-red-200/60 dark:border-red-400/20 text-red-700 dark:text-red-300'
        }`}>
          <span className={`flex items-center justify-center w-7 h-7 rounded-xl flex-shrink-0 ${
            contractActionResult.success ? 'bg-emerald-100 dark:bg-emerald-500/20' : 'bg-red-100 dark:bg-red-500/20'
          }`}>
            {contractActionResult.success ? <Check size={13} /> : <AlertTriangle size={13} />}
          </span>
          <span className="flex-1">{contractActionResult.message}</span>
          <button onClick={() => setContractActionResult(null)} className="opacity-60 hover:opacity-100 transition-opacity flex-shrink-0"><X size={14} /></button>
        </div>
      )}

      {contractsLoading && (
        <div className="flex items-center justify-center py-16 gap-3 text-gray-500 dark:text-gray-400">
          <RefreshCw size={18} className="animate-spin" />
          <span className="text-sm">Loading contracts…</span>
        </div>
      )}

      {contractsError && !contractsLoading && (
        <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-500/5 border border-amber-200/60 dark:border-amber-400/15 rounded-2xl px-5 py-4">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-500/15 flex-shrink-0">
            <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <p className="text-amber-700 dark:text-amber-300 text-sm font-semibold">No contracts available</p>
            <p className="text-amber-600/80 dark:text-amber-400/80 text-xs mt-1">{contractsError}</p>
          </div>
        </div>
      )}

      {contracts !== null && !contractsLoading && !contractsError && (
        contracts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 bg-white/50 dark:bg-gray-900/30 border border-gray-200/60 dark:border-gray-700/50 rounded-2xl">
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-500/10">
              <Key size={24} className="text-emerald-500 dark:text-emerald-400" />
            </div>
            <p className="text-gray-500 dark:text-gray-400 text-sm">No approved contracts for this API instance</p>
          </div>
        ) : (
          <GlassCard icon={Key} title="Consumer Contracts" count={contracts.length} accent="green" noPad>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <TableHeader>
                  <tr className="border-b border-gray-200/60 dark:border-gray-700/60">
                    {['Client App', 'Client ID', 'Status', 'SLA Tier', 'Actions'].map(h => (
                      <th key={h} className={`px-5 py-3 text-[10px] font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase ${h === 'Actions' ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </TableHeader>
                <tbody>
                  {contracts.map((c, i) => {
                    const status = (c.status || 'UNKNOWN').toUpperCase();
                    const statusCls = getContractStatusClasses(status);
                    const isPending = status === 'PENDING' || status === 'PENDING_APPROVAL';
                    const clientId =
                      c.application?.coreServicesId ||
                      c.application?.clientId ||
                      c.clientApplication?.coreServicesId ||
                      c.clientId || '—';
                    const slaTier = c.tier?.name || c.slaTier?.name || c.tierLabel || '—';
                    const appName = c.application?.name || c.clientApplication?.name || '—';
                    const contractId = c.id;
                    const isActioning = contractActionLoading === contractId;
                    // Determine which action buttons to show based on current status
                    const canApprove = status === 'PENDING' || status === 'REVOKED';
                    const canRevoke  = status === 'APPROVED' || status === 'PENDING';
                    return (
                      <tr key={i} className="group border-b border-gray-100 dark:border-gray-800 hover:bg-sf-50/40 dark:hover:bg-sf-500/5 transition-colors">
                        <td className="px-5 py-3">
                          <p className="text-gray-700 dark:text-gray-200 text-xs font-medium">{appName}</p>
                          {c.application?.description && (
                            <p className="text-gray-400 dark:text-gray-500 text-[10px] mt-0.5 truncate max-w-xs">{c.application.description}</p>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs text-gray-600 dark:text-gray-300 break-all">{clientId}</span>
                            {clientId !== '—' && <CopyBtn text={String(clientId)} />}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full border font-bold ${statusCls}`}>
                            <span className="relative flex w-1.5 h-1.5 flex-shrink-0">
                              {isPending && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-60" />}
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-current" />
                            </span>
                            {status}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          {slaTier !== '—' ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium bg-sf-50 dark:bg-sf-500/10 text-sf-600 dark:text-sf-400 border border-sf-200/60 dark:border-sf-400/30">{slaTier}</span>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-600 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {contractId ? (
                            <div className="flex items-center justify-end gap-1.5">
                              {isActioning ? (
                                <span className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800/60 rounded-full px-2.5 py-1.5">
                                  <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-400 dark:border-gray-500" /> Working…
                                </span>
                              ) : (
                                <>
                                  {canApprove && (
                                    <RowActionBtn
                                      icon={Check}
                                      tone="emerald"
                                      label={`Approve contract for ${appName}`}
                                      onClick={() => setContractConfirmState({ contractId, action: 'approve', appName })}
                                    />
                                  )}
                                  {canRevoke && (
                                    <RowActionBtn
                                      icon={X}
                                      label={`Revoke contract for ${appName}`}
                                      onClick={() => setContractConfirmState({ contractId, action: 'revoke', appName })}
                                    />
                                  )}
                                  <RowActionBtn
                                    icon={Trash2}
                                    muted
                                    label={`Permanently delete contract for ${appName}`}
                                    onClick={() => setContractConfirmState({ contractId, action: 'delete', appName })}
                                  />
                                </>
                              )}
                            </div>
                          ) : (
                            <div className="text-right text-gray-400 dark:text-gray-600 text-xs">—</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </GlassCard>
        )
      )}

      {contracts === null && !contractsLoading && !contractsError && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 bg-white/50 dark:bg-gray-900/30 border border-gray-200/60 dark:border-gray-700/50 rounded-2xl">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-sf-100 dark:bg-sf-500/10">
            <Key size={24} className="text-sf-500 dark:text-sf-400" />
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Click <strong className="text-gray-700 dark:text-gray-200">Load</strong> to fetch consumer contracts from API Manager</p>
          <button onClick={loadContracts}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-b from-sf-500 to-sf-600 hover:from-sf-400 hover:to-sf-500 text-white text-sm font-semibold rounded-xl shadow-md shadow-sf-500/30 hover:shadow-lg hover:shadow-sf-500/40 ring-1 ring-inset ring-white/20 transition-all hover:-translate-y-0.5 active:translate-y-0">
            <Key size={13} /> Load Contracts
          </button>
        </div>
      )}
    </div>
  );
}
