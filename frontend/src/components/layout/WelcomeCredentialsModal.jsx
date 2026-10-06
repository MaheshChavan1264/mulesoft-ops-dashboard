import React from 'react';
import { KeyRound, Zap, Database, Download, ShieldCheck } from 'lucide-react';
import Modal from '../ui/Modal';
import { ImportCredentialButton } from '../shared/CredentialImportButton';
import { useCredentialStore } from '../../context/CredentialStoreContext';
import { useCpsCredentialStore } from '../../context/CpsCredentialStoreContext';
import { downloadCsv } from '../../utils/appUtils';

const SAMPLE_ROWS = [['client_id', 'client_secret']];

/**
 * WelcomeCredentialsModal
 *
 * One-time, skippable prompt shown right after a real login (see
 * AuthContext.peekJustLoggedIn/clearJustLoggedInFlag, consumed by
 * Layout.jsx — never re-shown on page refresh or tab-focus session
 * revalidation) asking the user to upload their Ping Test
 * and CPS credential CSVs up front, instead of discovering the scattered
 * import buttons (Header / ApplicationsPage / BulkPingModal / CpsManagerPage
 * / CpsComparisonPage) only after a feature silently has nothing to work
 * with. Reuses the existing RAM-only CredentialStoreContext/
 * CpsCredentialStoreContext + ImportCredentialButton — no new storage or
 * upload mechanism, just a better-timed entry point into the same ones.
 *
 * Dismissible and non-blocking: closing it (Skip / X / Continue) never
 * prevents navigation — every page that needs these creds already handles
 * "not loaded yet" gracefully with its own inline import prompt.
 */
export default function WelcomeCredentialsModal({ onClose }) {
  const { hasCredentials: hasPingCreds, loadedCount: pingCount, loadFromCsv: loadPingCsv, clearCredentials: clearPingCreds } = useCredentialStore();
  const { hasCredentials: hasCpsCreds, loadedCount: cpsCount, loadFromCsv: loadCpsCsv, clearCredentials: clearCpsCreds } = useCpsCredentialStore();

  const downloadTemplate = () => downloadCsv(SAMPLE_ROWS, 'credentials-template.csv');

  return (
    <Modal
      onClose={onClose}
      size="base"
      icon={ShieldCheck}
      accent="sf"
      title="Welcome — set up your credentials"
      subtitle="Most of this dashboard (Ping tests, CPS property lookups) needs your client_id/client_secret CSVs. Upload them now, or skip and import later from the header."
      footer={(
        <>
          <button onClick={downloadTemplate}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors">
            <Download size={12} /> Download CSV template
          </button>
          <button onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-white bg-sf-600 hover:bg-sf-700 rounded-xl shadow-sm transition-colors">
            {hasPingCreds || hasCpsCreds ? 'Continue' : 'Skip for now'}
          </button>
        </>
      )}
    >
      <div className="rounded-2xl border border-gray-200/70 dark:border-white/[0.06] bg-gray-50/60 dark:bg-gray-900/30 px-4 py-3.5">
        <div className="flex items-start gap-3 mb-2.5">
          <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex-shrink-0">
            <Zap size={16} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Ping Test credentials</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Used to authenticate ping/health-check requests against your deployed apps. CSV columns: <code className="font-mono text-gray-600 dark:text-gray-300">client_id, client_secret</code>.
            </p>
          </div>
        </div>
        <ImportCredentialButton
          loadedCount={pingCount}
          hasCredentials={hasPingCreds}
          loadFromCsv={loadPingCsv}
          clearCredentials={clearPingCreds}
          accentColor="emerald"
          loadedLabel={(n) => `${n} creds loaded`}
          importLabel="Import Ping Credentials CSV"
          logPrefix="[WelcomeModal][Ping]"
          ariaLabel="Import ping credentials CSV file"
          importTitle="Import your client_id/client_secret CSV — parsed locally, never uploaded"
          loadedTitle="Credentials are loaded in memory only — never stored to disk or sent to the server"
          clearTitle="Clear ping credentials from memory"
        />
      </div>

      <div className="rounded-2xl border border-gray-200/70 dark:border-white/[0.06] bg-gray-50/60 dark:bg-gray-900/30 px-4 py-3.5">
        <div className="flex items-start gap-3 mb-2.5">
          <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-sfpurple-100 dark:bg-sfpurple-500/15 text-sfpurple-600 dark:text-sfpurple-400 flex-shrink-0">
            <Database size={16} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">CPS credentials</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Used to read/compare Config Property Server values per app. Same CSV format as above — a separate credential set from Ping Test.
            </p>
          </div>
        </div>
        <ImportCredentialButton
          loadedCount={cpsCount}
          hasCredentials={hasCpsCreds}
          loadFromCsv={loadCpsCsv}
          clearCredentials={clearCpsCreds}
          accentColor="purple"
          loadedLabel={(n) => `${n} creds loaded`}
          importLabel="Import CPS Credentials CSV"
          logPrefix="[WelcomeModal][CPS]"
          ariaLabel="Import CPS credentials CSV file"
          importTitle="Import CPS client_id/client_secret CSV — parsed locally, never uploaded"
          loadedTitle="CPS credentials are loaded in memory only — never stored to disk or sent to the server"
          clearTitle="Clear CPS credentials from memory"
        />
      </div>

      <div className="flex items-start gap-2 text-[11px] text-gray-400 dark:text-gray-500 px-1">
        <KeyRound size={12} className="flex-shrink-0 mt-0.5" />
        <span>Both CSVs are parsed entirely in your browser — the files and secrets are never uploaded to the server, and are cleared on logout or page refresh.</span>
      </div>
    </Modal>
  );
}
