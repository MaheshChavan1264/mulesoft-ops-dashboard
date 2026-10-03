import React, { useRef, useImperativeHandle, forwardRef } from 'react';
import { Upload, FileArchive, X } from 'lucide-react';

/**
 * FileDropZone
 *
 * Shared drag-and-drop + click-to-browse file picker. Collapses the
 * "border-2 border-dashed ... onDrop/onDragOver/onClick + hidden <input
 * type=file>" markup that was duplicated between CpsBinaryUploadPanel.jsx
 * and CpsImportModal.jsx — see FRONTEND_ARCHITECTURE_REVIEW.md §2
 * finding "<FileDropZone>".
 *
 * Two display modes:
 *   - No `selectedFile` → shows the icon/message/hint prompt (click or drop
 *     to pick a file).
 *   - `selectedFile` provided → shows a compact "file selected" summary row
 *     (name + size) with an optional remove (×) button, matching
 *     CpsBinaryUploadPanel's inline selected-file state. Callers that
 *     render their own separate "selected" preview UI elsewhere (like
 *     CpsImportModal's parsed-rows table) should simply stop rendering the
 *     drop zone at all once a file is chosen, rather than passing
 *     `selectedFile`.
 *
 * Props:
 *   onFile       {(file: File) => void}  Called with the picked/dropped file
 *   accept       {string}   `<input accept>` filter, e.g. '.csv,.json'
 *   icon         {Component} lucide-react icon for the empty-state prompt (default Upload)
 *   message      {string}   Primary prompt text
 *   hint         {ReactNode} Secondary helper text/line below the message
 *   selectedFile {File|null} When set, renders the compact "selected" row instead
 *   onRemove     {function} Called when the user clicks the remove (×) button
 *                 on the selected-file row (only rendered if provided)
 *   className    {string}   Extra classes merged onto the drop zone container
 *
 * Accepts a ref exposing `{ openPicker() }` so a parent can trigger the
 * file dialog imperatively (e.g. CpsBinaryUploadPanel's "Replace" button on
 * an already-configured key, which needs to reopen the picker without the
 * user clicking the drop zone itself).
 */
const FileDropZone = forwardRef(function FileDropZone({
  onFile,
  accept,
  icon: Icon = Upload,
  message = 'Drop file here or click to browse',
  hint,
  selectedFile = null,
  onRemove,
  className = '',
}, ref) {
  const fileInputRef = useRef(null);

  useImperativeHandle(ref, () => ({
    openPicker: () => fileInputRef.current?.click(),
  }));

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    e.target.value = '';
  };

  return (
    <>
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => !selectedFile && fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl text-center transition-colors cursor-pointer ${
          selectedFile
            ? 'border-emerald-300/50 bg-emerald-50/10 px-4 py-6'
            : 'border-gray-300/60 hover:border-gray-300 bg-gray-100/20 px-6 py-10'
        } ${className}`}
      >
        {selectedFile ? (
          <div className="flex items-center justify-center gap-3">
            <FileArchive size={20} className="text-emerald-600 flex-shrink-0" />
            <div className="text-left">
              <p className="text-sm text-gray-900 font-medium">{selectedFile.name}</p>
              <p className="text-xs text-gray-500">{(selectedFile.size / 1024).toFixed(1)} KB · ready to upload</p>
            </div>
            {onRemove && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
                className="text-gray-500 hover:text-gray-900 ml-2"
              >
                <X size={14} />
              </button>
            )}
          </div>
        ) : (
          <div>
            <Icon size={selectedFile ? 20 : 28} className="text-gray-500 mx-auto mb-2" />
            <p className="text-sm text-gray-500">{message}</p>
            {hint && <p className="text-[10px] text-gray-500 mt-1">{hint}</p>}
          </div>
        )}
      </div>
      <input ref={fileInputRef} type="file" accept={accept} onChange={handleFileSelect} className="hidden" />
    </>
  );
});

export default FileDropZone;
