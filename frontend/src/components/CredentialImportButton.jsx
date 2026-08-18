import React, { useRef } from 'react';
import { Upload, Key, X, ShieldCheck } from 'lucide-react';
import { useCredentialStore } from '../context/CredentialStoreContext';

/**
 * CredentialImportButton (Ping credentials)
 *
 * Renders either:
 *   - An "Import Credentials CSV" button (when no credentials are loaded)
 *   - A "N creds loaded" badge + clear button (when credentials are in memory)
 *
 * The implementation now delegates to the generic ImportButton component.
 * CpsCredentialImportButton is a separate thin component that passes
 * different colours/labels — both share zero duplicated code.
 *
 * Props:
 *   compact {boolean}  – smaller size variant for tight toolbars
 */
export default function CredentialImportButton({ compact = false }) {
  const { loadedCount, hasCredentials, loadFromCsv, clearCredentials } =
    useCredentialStore();

  return (
    <ImportCredentialButton
      loadedCount={loadedCount}
      hasCredentials={hasCredentials}
      loadFromCsv={loadFromCsv}
      clearCredentials={clearCredentials}
      compact={compact}
      accentColor="emerald"
      loadedLabel={(n) => `${n} creds loaded`}
      importLabel="Import Ping Creds"
      logPrefix="[CredentialImport]"
      ariaLabel="Import credentials CSV file"
      importTitle="Import your client_id/client_secret CSV — parsed locally, never uploaded"
      loadedTitle="Credentials are loaded in memory only — never stored to disk or sent to the server"
      clearTitle="Clear all credentials from memory"
    />
  );
}

// ── Generic import button ─────────────────────────────────────────────────────

const ACCENT = {
  emerald: {
    badge:       'bg-emerald-500/10 border-emerald-700/40 text-emerald-400',
    hover:       'hover:text-cyan-300 hover:border-cyan-700/50',
  },
  purple: {
    badge:       'bg-purple-500/10 border-purple-700/40 text-purple-400',
    hover:       'hover:text-purple-300 hover:border-purple-700/50',
  },
};

/**
 * Generic credential import button.
 * Shared by CredentialImportButton (ping) and CpsCredentialImportButton (CPS).
 * Not exported as part of the public API — use the named wrappers instead.
 */
export function ImportCredentialButton({
  loadedCount,
  hasCredentials,
  loadFromCsv,
  clearCredentials,
  compact = false,
  accentColor = 'emerald',
  loadedLabel,
  importLabel,
  logPrefix,
  ariaLabel,
  importTitle,
  loadedTitle,
  clearTitle,
}) {
  const inputRef = useRef(null);
  const accent = ACCENT[accentColor] || ACCENT.emerald;

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const count = loadFromCsv(ev.target.result);
      console.info(`${logPrefix} Loaded ${count} credential pairs from "${file.name}" (in-memory only)`);
    };
    reader.onerror = () => {
      console.error(`${logPrefix} Failed to read file`);
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
          className={`flex items-center ${sizeClass} ${accent.badge} rounded-lg font-medium`}
          title={loadedTitle}
        >
          <Key size={iconSize} />
          {loadedLabel(loadedCount)}
          <ShieldCheck size={iconSize} className="opacity-70" />
        </span>
        <button
          onClick={clearCredentials}
          title={clearTitle}
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
        aria-label={ariaLabel}
      />
      <button
        onClick={() => inputRef.current?.click()}
        title={importTitle}
        className={`flex items-center ${sizeClass} bg-gray-800 border border-gray-700 text-gray-400 ${accent.hover} rounded-lg transition-colors font-medium`}
      >
        <Upload size={iconSize} />
        {importLabel}
      </button>
    </>
  );
}