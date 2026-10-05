import React from 'react';
import { ImportCredentialButton } from '../../components/shared/CredentialImportButton';
import { useGlobalCpsCredentialStore } from '../../context/GlobalCpsCredentialStoreContext';

/**
 * GlobalCpsCsvUpload
 *
 * Import button for Global CPS credentials.
 * Uses the ImportCredentialButton wrapper for consistency.
 *
 * Expected CSV columns (see utils/globalCpsCsvParser.js, lenient substring
 * matching on the header row, so exact naming/order doesn't matter):
 *   business_group,
 *   ch1_uat_client_id, ch1_uat_client_secret, ch1_uat_url,
 *   ch1_prod_client_id, ch1_prod_client_secret, ch1_prod_url,
 *   ch2_uat_client_id, ch2_uat_client_secret, ch2_uat_url,
 *   ch2_prod_client_id, ch2_prod_client_secret, ch2_prod_url
 * The `*_url` columns are optional but are the ONLY way GlobalCpsManagerPage
 * learns a business group's real CPS base URL — a row without them shows
 * "Not configured" there until one is added (or the user types a one-off
 * Custom CPS Host override).
 */
export default function GlobalCpsCsvUpload({ compact = false }) {
  const { globalCredentials, hasGlobalCredentials, loadGlobalFromCsv, clearCredentials } =
    useGlobalCpsCredentialStore();

  return (
    <ImportCredentialButton
      loadedCount={globalCredentials.length}
      hasCredentials={hasGlobalCredentials}
      loadFromCsv={loadGlobalFromCsv}
      clearCredentials={clearCredentials}
      compact={compact}
      accentColor="indigo"
      loadedLabel={(n) => `${n} BG creds`}
      importLabel="Import Global CPS CSV"
      logPrefix="[GlobalCpsCredentialImport]"
      ariaLabel="Import Global CPS credentials CSV file"
      importTitle="Import Global CPS CSV — parsed locally, never uploaded. Columns: business_group, ch{1,2}_{uat,prod}_client_id/_client_secret, and optional ch{1,2}_{uat,prod}_url for the real CPS host per BG"
      loadedTitle="Global CPS credentials are loaded in memory — never stored to disk or sent to the server"
      clearTitle="Clear Global CPS credentials from memory"
    />
  );
}
