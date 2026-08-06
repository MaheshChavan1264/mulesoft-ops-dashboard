import React, { useRef } from 'react';
import { Upload, Key, X, ShieldCheck } from 'lucide-react';
import { useCpsCredentialStore } from '../context/CpsCredentialStoreContext';

/**
 * CpsCredentialImportButton
 *
 * Import button for CPS (Config Property Server) credentials.
 * Separate from CredentialImportButton which is used for Ping Test credentials.
 *
 * Props:
 *   compact {boolean} – smaller size variant
 */
export default function CpsCredentialImportButton({ compact = false }) {
  const { loadedCount, hasCredentials, loadFromCsv, clearCredentials } = useCpsCredentialStore();
  const inputRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const count = loadFromCsv(ev.target.result);
      console.info(`[CpsCredentialImport] Loaded ${count} CPS credential pairs from "${file.name}" (in-memory only)`);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const sizeClass = compact
    ? 'text-[10px] px-2 py-1 gap-1'
    : 'text-xs px-2.5 py-1.5 gap-1.5';
  const iconSize = compact ? 9 : 11;

  if (hasCredentials) {
    return (
      <div className="flex items-center gap-1.5">
        <span
          className={`flex items-center ${sizeClass} bg-purple-500/10 border border-purple-700/40 text-purple-400 rounded-lg font-medium`}
          title="CPS credentials are loaded in memory — never stored to disk or sent to the server"
        >
          <Key size={iconSize} />
          {loadedCount} CPS creds
          <ShieldCheck size={iconSize} className="opacity-70" />
        </span>
        <button
          onClick={clearCredentials}
          title="Clear CPS credentials from memory"
          className="text-gray-500 hover:text-red-400 transition-colors p-0.5 rounded"
        >
          <X size={compact ? 11 : 13} />
        </button>
      </div>
    );
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={handleFile}
        className="hidden"
        aria-label="Import CPS credentials CSV file"
      />
      <button
        onClick={() => inputRef.current?.click()}
        title="Import CPS client_id/client_secret CSV — parsed locally, never uploaded"
        className={`flex items-center ${sizeClass} bg-gray-800 border border-gray-700 text-gray-400 hover:text-purple-300 hover:border-purple-700/50 rounded-lg transition-colors font-medium`}
      >
        <Upload size={iconSize} />
        Import CPS Creds
      </button>
    </>
  );
}