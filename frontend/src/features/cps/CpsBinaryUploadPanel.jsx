import React, { useState, useRef } from 'react';
import { Upload, RefreshCw, CheckCircle, AlertTriangle, FileArchive } from 'lucide-react';
import api from '../../services/api';
import ErrorBanner from '../../components/ui/ErrorBanner';
import { normaliseCpsUrl } from '../../utils/cpsHelpers';
import FileDropZone from '../../components/ui/FileDropZone';
import { getErrorMessage } from '../../services/http';

/**
 * CpsBinaryUploadPanel
 *
 * Panel for uploading binary files (.jks, .pem, .gpg, .crt, etc.) to CPS.
 * The frontend reads the file as base64 and sends it to the backend,
 * which decodes to Buffer and forwards with the correct octet-stream headers.
 *
 * Props:
 *   baseUrl      {string}   CPS server base URL
 *   environment  {string}   CPS environment prefix
 *   bgOrgId      {string}   Business Group org ID
 *   existingKeys {string[]} Current binary filenames (from cps.secure.binaries)
 *   isProd       {boolean}  Whether this is a production environment
 *   onUploaded   {function} Called after successful upload, receives filename
 */
export default function CpsBinaryUploadPanel({
  baseUrl,
  environment,
  bgOrgId,
  existingKeys = [],
  isProd = false,
  onUploaded,
  onResult,
}) {
  const dropZoneRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileNameOverride, setFileNameOverride] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState([]);

  const handleFilePicked = (file) => {
    setSelectedFile(file);
    setFileNameOverride(file.name);
    setError('');
  };

  const handleUpload = async () => {
    if (!selectedFile || !fileNameOverride.trim()) {
      setError('Please select a file and provide a filename');
      return;
    }
    setError('');
    setUploading(true);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(selectedFile);
      });

      const cleanBase = normaliseCpsUrl(baseUrl);
      const fallbackReqDetails = {
        method: 'POST',
        url: `${cleanBase}/api/v2/binaries/secure`,
        headers: { 'Content-Type': 'application/octet-stream', key: fileNameOverride.trim(), environment },
        body: `[Binary data: ${selectedFile.size} bytes]`,
      };

      const resp = await api.post('/cps/binary', {
        baseUrl,
        environment,
        key: fileNameOverride.trim(),
        bgOrgId,
        fileData: base64,
      });
      const { requestDetails, responseDetails } = resp.data || {};
      onResult?.({
        label: `Upload Binary (${fileNameOverride.trim()})`,
        timestamp: new Date().toISOString(),
        requestDetails: requestDetails || fallbackReqDetails,
        responseDetails: responseDetails || { status: 200, body: resp.data },
        success: true,
      });
      setUploadedFiles(prev => [...new Set([...prev, fileNameOverride.trim()])]);
      onUploaded?.(fileNameOverride.trim());
      setSelectedFile(null);
      setFileNameOverride('');
    } catch (err) {
      const { requestDetails, responseDetails } = err.response?.data || {};
      const cleanBase = normaliseCpsUrl(baseUrl);
      onResult?.({
        label: `Upload Binary (${fileNameOverride.trim()})`,
        timestamp: new Date().toISOString(),
        requestDetails: requestDetails || {
          method: 'POST', url: `${cleanBase}/api/v2/binaries/secure`,
          headers: { 'Content-Type': 'application/octet-stream', key: fileNameOverride.trim(), environment },
          body: `[Binary data: ${selectedFile?.size || 0} bytes]`,
        },
        responseDetails: responseDetails || { status: err.response?.status, body: err.response?.data },
        success: false,
      });
      setError(getErrorMessage(err, 'Binary upload failed'));
    }
    setUploading(false);
  };

  const ext = (name) => name.includes('.') ? '.' + name.split('.').pop().toLowerCase() : '';

  const extColor = (filename) => {
    const e = ext(filename);
    if (['.jks', '.p12', '.pfx'].includes(e)) return 'bg-blue-50/30 text-blue-700 border-blue-200/40';
    if (['.pem', '.crt', '.cer', '.der', '.key'].includes(e)) return 'bg-green-50/30 text-green-700 border-green-200/40';
    if (['.gpg', '.pgp'].includes(e)) return 'bg-purple-50/30 text-purple-700 border-purple-200/40';
    return 'bg-gray-100/60 text-gray-500 border-gray-300/40';
  };

  return (
    <div className="space-y-4">
      {/* Existing binary keys */}
      {existingKeys.length > 0 && (
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-2">
            Configured Binaries ({existingKeys.length})
          </p>
          <div className="space-y-1.5">
            {existingKeys.map((key) => (
              <div key={key} className="flex items-center justify-between bg-gray-100/40 border border-gray-300/30 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileArchive size={12} className="text-gray-500 flex-shrink-0" />
                  <span className="text-xs text-gray-700 font-mono truncate">{key}</span>
                  {uploadedFiles.includes(key) && (
                    <span className="flex items-center gap-1 text-[9px] text-emerald-600 bg-emerald-50 border border-emerald-300/40 px-1.5 py-0.5 rounded-full flex-shrink-0">
                      <CheckCircle size={8} /> Uploaded
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono uppercase ${extColor(key)}`}>
                    {ext(key) || 'bin'}
                  </span>
                  <button
                    onClick={() => { setFileNameOverride(key); dropZoneRef.current?.openPicker(); }}
                    className="text-[10px] text-blue-600 hover:text-blue-700 bg-blue-50/30 border border-blue-200/40 px-2 py-0.5 rounded transition-colors"
                  >
                    Replace
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload area */}
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-2">
          Upload New Binary
        </p>

        <FileDropZone
          ref={dropZoneRef}
          onFile={handleFilePicked}
          selectedFile={selectedFile}
          onRemove={() => { setSelectedFile(null); setFileNameOverride(''); }}
          message="Drop file here or click to browse"
          hint=".jks · .pem · .gpg · .crt · .p12 and other binary assets"
        />

        {/* Filename + env fields */}
        {selectedFile && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Filename in CPS</label>
              <input
                value={fileNameOverride}
                onChange={e => setFileNameOverride(e.target.value)}
                className="w-full bg-gray-100 border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-900 font-mono focus:outline-none focus:border-blue-300/50"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Environment</label>
              <input
                value={environment}
                readOnly
                className="w-full bg-gray-100/40 border border-gray-300/50 rounded-lg px-3 py-1.5 text-xs text-gray-500 font-mono cursor-not-allowed"
              />
            </div>
          </div>
        )}

        {isProd && selectedFile && (
          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-red-600">
            <AlertTriangle size={10} /> Uploading to PRODUCTION CPS
          </div>
        )}

        <ErrorBanner error={error} variant="inline" size="sm" className="mt-2" />

        {selectedFile && (
          <div className="mt-3 flex justify-end">
            <button
              onClick={handleUpload}
              disabled={uploading || !fileNameOverride.trim()}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-gray-900 rounded-lg disabled:opacity-50 transition-colors"
            >
              {uploading
                ? <><RefreshCw size={13} className="animate-spin" /> Uploading…</>
                : <><Upload size={13} /> Upload Binary</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}