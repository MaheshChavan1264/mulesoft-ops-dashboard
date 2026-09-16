import React, { useState, useEffect } from 'react';
import { X, Code, AlertTriangle, Save, AlignLeft } from 'lucide-react';

export default function CpsRawJsonModal({ 
  isOpen, 
  onClose, 
  initialJson, 
  onSave, 
  title = "Edit Raw JSON", 
  description = "Paste or edit your raw JSON payload here."
}) {
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState('');
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');

  const handleFindReplace = () => {
    if (!findText) return;
    setJsonText(prev => prev.split(findText).join(replaceText));
  };

  useEffect(() => {
    if (isOpen) {
      setJsonText(JSON.stringify(initialJson, null, 2));
      setError('');
    }
  }, [isOpen, initialJson]);

  if (!isOpen) return null;

  const handleSave = () => {
    try {
      const parsed = JSON.parse(jsonText);
      onSave(parsed);
      onClose();
    } catch (err) {
      setError(`Invalid JSON: ${err.message}`);
    }
  };

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(jsonText);
      setJsonText(JSON.stringify(parsed, null, 2));
      setError('');
    } catch (err) {
      setError(`Cannot format invalid JSON: ${err.message}`);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-6xl shadow-2xl flex flex-col max-h-[95vh] h-[85vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 flex-shrink-0">
          <div>
            <h3 className="text-white font-semibold text-sm flex items-center gap-2">
              <Code size={16} className="text-cyan-400" />
              {title}
            </h3>
            <p className="text-gray-500 text-xs mt-1">{description}</p>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Editor & Find/Replace */}
        <div className="flex-1 p-4 overflow-hidden flex flex-col gap-3">
          
          <div className="flex items-center gap-2 bg-gray-800/50 p-2 rounded-lg border border-gray-700/50">
            <input
              type="text"
              placeholder="Find..."
              value={findText}
              onChange={e => setFindText(e.target.value)}
              className="flex-1 bg-gray-900 border border-gray-700 rounded-md px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-cyan-600"
            />
            <input
              type="text"
              placeholder="Replace with..."
              value={replaceText}
              onChange={e => setReplaceText(e.target.value)}
              className="flex-1 bg-gray-900 border border-gray-700 rounded-md px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-cyan-600"
            />
            <button
              onClick={handleFindReplace}
              disabled={!findText}
              className="px-3 py-1.5 bg-blue-900/50 hover:bg-blue-800/60 border border-blue-700/50 text-blue-300 text-xs rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Replace All
            </button>
          </div>

          <textarea
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              setError('');
            }}
            className="flex-1 w-full h-full bg-[#0d1117] border border-gray-800 rounded-xl p-4 text-[13px] leading-relaxed text-emerald-400 font-mono focus:outline-none focus:border-cyan-700/50 resize-none overflow-y-auto"
            spellCheck="false"
          />
        </div>

        {/* Error message */}
        {error && (
          <div className="px-5 pb-2">
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">
              <AlertTriangle size={14} className="flex-shrink-0" />
              <span className="truncate">{error}</span>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-800 flex-shrink-0">
          <button 
            onClick={handleFormat}
            className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-300 hover:text-white bg-gray-800 border border-gray-700 hover:border-gray-600 rounded-lg transition-colors"
          >
            <AlignLeft size={14} /> Format JSON
          </button>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 border border-gray-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
          <button 
            onClick={handleSave}
            disabled={!!error}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-cyan-700 hover:bg-cyan-600 text-white rounded-lg disabled:opacity-50 transition-colors"
          >
            <Save size={14} /> Update JSON
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
