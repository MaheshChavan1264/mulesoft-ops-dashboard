import React, { useRef } from 'react';
import { Upload, Key, X, ShieldCheck } from 'lucide-react';
import { useCredentialStore } from '../context/CredentialStoreContext';

/**
 * CredentialImportButton
 *
 * Renders either:
 *   - An "Import Credentials CSV" button (when no credentials are loaded)
 *   - A "N creds loaded" badge + clear button (when credentials are in memory)
 *
 * Security: The CSV file is read and parsed entirely in the browser.
 * The credential map lives only in React state (in-memory). Nothing is
 * written to disk, localStorage, or sent to any server.
 *
 * Props:
 *   compact {boolean}  – smaller size variant for tight toolbars
 */
export default function CredentialImportButton({ compact = false }) {
  const { loadedCount, hasCredentials, loadFromCsv, clearCredentials } =
    useCredentialStore();
  const inputRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const count = loadFromCsv(ev.target.result);
      console.info(`[CredentialImport] Loaded ${count} credential pairs from "${file.name}" (in-memory only)`);
    };
    reader.onerror = () => {
      console.error('[CredentialImport] Failed to read file');
    };
    reader.readAsText(file);

    // Reset so the same file can be re-imported if needed
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
          className={`flex items-center ${sizeClass} bg-emerald-500/10 border border-emerald-700/40 text-emerald-400 rounded-lg font-medium`}
          title="Credentials are loaded in memory only — never stored to disk or sent to the server"
        >
          <Key size={iconSize} />
          {loadedCount} creds loaded
          <ShieldCheck size={iconSize} className="opacity-70" />
        </span>
        <button
          onClick={clearCredentials}
          title="Clear all credentials from memory"
          className="text-gray-500 hover:text-red-400 transition-colors p-0.5 rounded"
        >
          <X size={compact ? 11 : 13} />
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Hidden file input — only .csv accepted */}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={handleFile}
        className="hidden"
        aria-label="Import credentials CSV file"
      />
      <button
        onClick={() => inputRef.current?.click()}
        title="Import your client_id/client_secret CSV — parsed locally, never uploaded"
        className={`flex items-center ${sizeClass} bg-gray-800 border border-gray-700 text-gray-400 hover:text-cyan-300 hover:border-cyan-700/50 rounded-lg transition-colors font-medium`}
      >
        <Upload size={iconSize} />
        Import Creds CSV
      </button>
    </>
  );
}