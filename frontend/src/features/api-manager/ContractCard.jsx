import React, { useState } from 'react';
import { RefreshCw, CheckCircle, XCircle, Clock, AlertCircle, Trash2 } from 'lucide-react';

/**
 * ContractCard — a single API Manager consumer-contract card with inline
 * approve/revoke/restore/delete actions.
 *
 * Extracted from features/api-manager/ApiManagerPage.jsx — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §10 folder-structure recommendation.
 */
export default function ContractCard({ c, i, onUpdateContract, onDeleteContract }) {
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handleUpdate = async (newStatus) => {
    setLoading(true);
    await onUpdateContract(c.id, newStatus);
    setLoading(false);
    setConfirmRevoke(false);
  };

  const handleDelete = async () => {
    setDeleteLoading(true);
    await onDeleteContract(c.id);
    setDeleteLoading(false);
    setConfirmDelete(false);
  };

  const appName =
    c.application?.name ||
    c.clientApplication?.name ||
    c.applicationName ||
    `App ${c.clientApplicationId || c.applicationId || c.id}`;

  const clientId =
    c.application?.coreServicesId ||
    c._enrichedClientId ||
    c.application?.clientId ||
    c.application?.client_id ||
    c.application?.credentials?.clientId ||
    c.clientApplication?.coreServicesId ||
    c.clientApplication?.clientId ||
    c.clientId ||
    c.client_id ||
    null;

  const clientAppId =
    c.application?.id ||
    c.clientApplication?.id ||
    c.clientApplicationId ||
    c.applicationId ||
    null;

  const status = (c.status || 'ACTIVE').toUpperCase();
  const tierName = c.tier?.name || c.requestedTier?.name || null;
  const created = c.createdDate ? new Date(c.createdDate).toLocaleDateString() : null;

  // Anypoint API can return 'PENDING_APPROVAL' or just 'PENDING' for awaiting-approval contracts,
  // and 'ACTIVE' or 'APPROVED' for approved ones — normalise both variants.
  const isPending  = status === 'PENDING_APPROVAL' || status === 'PENDING';
  const isApproved = status === 'ACTIVE' || status === 'APPROVED';

  const statusIcon =
    isApproved ? <CheckCircle size={12} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" /> :
    status === 'REVOKED' ? <XCircle size={12} className="text-red-600 dark:text-red-400 flex-shrink-0" /> :
    isPending ? <Clock size={12} className="text-amber-600 dark:text-amber-400 flex-shrink-0" /> :
    <AlertCircle size={12} className="text-gray-500 dark:text-gray-400 flex-shrink-0" />;

  const statusColor =
    isApproved ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200/80 dark:border-emerald-400/30' :
    status === 'REVOKED' ? 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border-red-200/80 dark:border-red-400/30' :
    isPending ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border-amber-200/80 dark:border-amber-400/30' :
    'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/40 border-gray-200/80 dark:border-gray-600/40';

  return (
    <div key={c.id || i} className="px-5 py-3.5 hover:bg-gray-50/60 dark:hover:bg-white/[0.02] transition-colors">
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="text-gray-900 dark:text-gray-100 text-sm font-semibold truncate">{appName}</p>
        <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-semibold flex-shrink-0 ${statusColor}`}>
          {statusIcon}{status.replace('_', ' ')}
        </span>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-gray-400 dark:text-gray-500 text-[10px] w-16 flex-shrink-0">Client ID</span>
          <span className="font-mono text-[10px] bg-gray-50 dark:bg-gray-900/50 px-1.5 py-0.5 rounded-md text-gray-600 dark:text-gray-300 break-all select-all">
            {clientId || '—'}
          </span>
        </div>
        {clientAppId && (
          <div className="flex items-center gap-2">
            <span className="text-gray-400 dark:text-gray-500 text-[10px] w-16 flex-shrink-0">App ID</span>
            <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400">{clientAppId}</span>
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap pt-0.5">
          {tierName && (
            <span className="text-sf-600 dark:text-sf-400 text-[10px] bg-sf-50 dark:bg-sf-500/10 border border-sf-200/60 dark:border-sf-400/30 px-1.5 py-0.5 rounded-md font-medium">{tierName}</span>
          )}
          {created && <span className="text-gray-400 dark:text-gray-500 text-[10px]">{created}</span>}
        </div>
      </div>

      <div className="flex justify-between items-center mt-3 pt-3 border-t border-gray-100 dark:border-white/[0.06]">
        {/* ── Status action buttons (left) ─────────────────────────── */}
        <div className="flex gap-2 min-h-[24px] items-center">
          {loading && <RefreshCw size={12} className="animate-spin text-gray-400 dark:text-gray-500" />}

          {!loading && isPending && (
            <>
              <button onClick={() => handleUpdate('APPROVED')} className="text-[10px] uppercase font-bold tracking-wider bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-400/30 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 hover:shadow-sm hover:shadow-emerald-500/30 px-3 py-1 rounded-lg transition-all">Approve</button>
              <button onClick={() => handleUpdate('REVOKED')} className="text-[10px] uppercase font-bold tracking-wider bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border border-red-200/70 dark:border-red-400/30 hover:bg-red-600 hover:text-white hover:border-red-600 hover:shadow-sm hover:shadow-red-500/30 px-3 py-1 rounded-lg transition-all">Reject</button>
            </>
          )}

          {!loading && isApproved && !confirmRevoke && (
            <button onClick={() => setConfirmRevoke(true)} className="text-[10px] uppercase font-bold tracking-wider bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border border-red-200/70 dark:border-red-400/30 hover:bg-red-600 hover:text-white hover:border-red-600 hover:shadow-sm hover:shadow-red-500/30 px-3 py-1 rounded-lg transition-all">Revoke</button>
          )}

          {!loading && confirmRevoke && (
            <div className="flex gap-2 items-center">
              <span className="text-[10px] uppercase font-bold tracking-wider text-red-600 dark:text-red-400 flex items-center gap-1">
                <AlertCircle size={10} /> Revoke this contract?
              </span>
              <button onClick={() => handleUpdate('REVOKED')} className="text-[10px] uppercase font-bold tracking-wider bg-red-600 text-white hover:bg-red-500 px-3 py-1 rounded-lg shadow-sm shadow-red-500/30 transition-colors">Yes, Revoke</button>
              <button onClick={() => setConfirmRevoke(false)} className="text-[10px] uppercase font-bold tracking-wider text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 px-2 py-1 rounded-lg transition-colors">Cancel</button>
            </div>
          )}

          {!loading && status === 'REVOKED' && (
            <button onClick={() => handleUpdate('ACTIVE')} className="text-[10px] uppercase font-bold tracking-wider bg-gray-100 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600 px-3 py-1 rounded-lg transition-colors">Restore</button>
          )}
        </div>

        {/* ── Delete button (right) ─────────────────────────────────── */}
        <div className="flex gap-2 items-center flex-shrink-0">
          {deleteLoading ? (
            <RefreshCw size={12} className="animate-spin text-gray-400 dark:text-gray-500" />
          ) : confirmDelete ? (
            <div className="flex gap-1.5 items-center">
              <span className="text-[10px] font-bold text-red-600 dark:text-red-400 flex items-center gap-1">
                <Trash2 size={10} /> Delete permanently?
              </span>
              <button
                onClick={handleDelete}
                className="text-[10px] uppercase font-bold tracking-wider bg-red-600 text-white hover:bg-red-500 px-2 py-0.5 rounded-lg shadow-sm shadow-red-500/30 transition-colors"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-[10px] uppercase font-bold tracking-wider text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 px-2 py-0.5 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setConfirmRevoke(false); setConfirmDelete(true); }}
              title="Delete contract permanently"
              className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 hover:border-red-200/70 dark:hover:border-red-400/30 px-2 py-1 rounded-lg transition-colors"
            >
              <Trash2 size={11} /> Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
