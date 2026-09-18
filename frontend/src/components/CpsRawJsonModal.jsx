import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, Code, AlertTriangle, Save, AlignLeft, ChevronUp, ChevronDown } from 'lucide-react';

export default function CpsRawJsonModal({ 
  isOpen, 
  onClose, 
  initialJson, 
  onSave, 
  title = "Edit Raw JSON", 
  description = "Paste or edit your raw JSON payload here.",
  readOnly = false
}) {
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState('');
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  
  // New State for Advanced Find
  const [useRegex, setUseRegex] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);

  const backdropRef = useRef(null);
  const textareaRef = useRef(null);
  const activeMatchRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setJsonText(JSON.stringify(initialJson, null, 2));
      setError('');
      setFindText('');
      setReplaceText('');
      setActiveMatchIndex(0);
    }
  }, [isOpen, initialJson]);

  // Derived state for searching and highlighting
  const { searchRegex, searchError, chunks, totalMatches } = useMemo(() => {
    if (!findText) {
      return { searchRegex: null, searchError: '', chunks: [{ text: jsonText, isMatch: false }], totalMatches: 0 };
    }

    let regex = null;
    let err = '';
    const flags = matchCase ? 'g' : 'gi';
    
    try {
      regex = useRegex 
        ? new RegExp(findText, flags) 
        : new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    } catch (e) {
      err = 'Invalid Regex';
      return { searchRegex: null, searchError: err, chunks: [{ text: jsonText, isMatch: false }], totalMatches: 0 };
    }

    const newChunks = [];
    let matchCounter = 0;
    let lastIndex = 0;
    let match;

    // Execute regex
    while ((match = regex.exec(jsonText)) !== null) {
      if (match.index === regex.lastIndex) {
        regex.lastIndex++; // prevent infinite loops for zero-length matches
      }
      newChunks.push({ text: jsonText.substring(lastIndex, match.index), isMatch: false });
      newChunks.push({ text: match[0], isMatch: true, index: matchCounter++ });
      lastIndex = match.index + match[0].length;
    }
    newChunks.push({ text: jsonText.substring(lastIndex), isMatch: false });

    return { searchRegex: regex, searchError: '', chunks: newChunks, totalMatches: matchCounter };
  }, [jsonText, findText, useRegex, matchCase]);

  // Ensure activeMatchIndex remains in bounds
  useEffect(() => {
    if (totalMatches > 0 && activeMatchIndex >= totalMatches) {
      setActiveMatchIndex(totalMatches - 1);
    } else if (totalMatches === 0) {
      setActiveMatchIndex(0);
    }
  }, [totalMatches, activeMatchIndex]);

  // Auto-scroll to active match
  useEffect(() => {
    if (totalMatches > 0 && activeMatchRef.current && textareaRef.current && backdropRef.current) {
      // Scroll the active mark into view in the backdrop
      activeMatchRef.current.scrollIntoView({ block: 'center', inline: 'nearest' });
      // Sync the textarea's scroll position to match the backdrop
      textareaRef.current.scrollTop = backdropRef.current.scrollTop;
      textareaRef.current.scrollLeft = backdropRef.current.scrollLeft;
    }
  }, [activeMatchIndex, totalMatches]); // Re-run when match index changes or new search happens

  const handleReplace = () => {
    if (totalMatches === 0 || !searchRegex) return;
    
    let currentMatchIndex = 0;
    searchRegex.lastIndex = 0; // reset regex
    
    const newJson = jsonText.replace(searchRegex, (match) => {
      if (currentMatchIndex === activeMatchIndex) {
        currentMatchIndex++;
        return replaceText;
      }
      currentMatchIndex++;
      return match;
    });

    setJsonText(newJson);
    // The activeMatchIndex will naturally point to the NEXT match because the current one is gone
  };

  const handleReplaceAll = () => {
    if (!searchRegex) return;
    setJsonText(jsonText.replace(searchRegex, replaceText));
  };

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

  if (!isOpen) return null;

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
          
          <div className="flex flex-wrap items-center gap-2 bg-gray-800/50 p-2 rounded-lg border border-gray-700/50">
            {/* Search Input with Toggles */}
            <div className={`flex items-center gap-1 bg-gray-900 border ${searchError ? 'border-red-500' : 'border-gray-700'} rounded-md px-2 py-1.5 focus-within:border-cyan-600`}>
              <input
                type="text"
                placeholder="Find..."
                value={findText}
                onChange={e => setFindText(e.target.value)}
                className="bg-transparent text-xs text-white placeholder-gray-500 focus:outline-none min-w-[180px]"
              />
              <button 
                onClick={() => setMatchCase(!matchCase)} 
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-colors ${matchCase ? 'bg-cyan-900/50 text-cyan-300' : 'text-gray-500 hover:text-gray-300'}`} 
                title="Match Case"
              >
                Aa
              </button>
              <button 
                onClick={() => setUseRegex(!useRegex)} 
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-colors ${useRegex ? 'bg-cyan-900/50 text-cyan-300' : 'text-gray-500 hover:text-gray-300'}`} 
                title="Regular Expression"
              >
                .*
              </button>
            </div>

            {/* Match Navigation */}
            <div className="flex items-center gap-2 mr-2">
              <span className="text-[10px] text-gray-400 min-w-[45px] text-center">
                {totalMatches > 0 ? `${activeMatchIndex + 1} of ${totalMatches}` : '0 of 0'}
              </span>
              <div className="flex">
                <button 
                  onClick={() => setActiveMatchIndex(prev => (prev > 0 ? prev - 1 : totalMatches - 1))} 
                  disabled={totalMatches === 0} 
                  className="p-1 text-gray-400 hover:text-white disabled:opacity-30 border border-gray-700 rounded-l-md bg-gray-800 transition-colors"
                >
                  <ChevronUp size={14}/>
                </button>
                <button 
                  onClick={() => setActiveMatchIndex(prev => (prev < totalMatches - 1 ? prev + 1 : 0))} 
                  disabled={totalMatches === 0} 
                  className="p-1 text-gray-400 hover:text-white disabled:opacity-30 border border-gray-700 border-l-0 rounded-r-md bg-gray-800 transition-colors"
                >
                  <ChevronDown size={14}/>
                </button>
              </div>
            </div>

            {/* Replace Input and Actions */}
            {!readOnly && (
              <>
                <input
                  type="text"
                  placeholder="Replace with..."
                  value={replaceText}
                  onChange={e => setReplaceText(e.target.value)}
                  className="w-48 bg-gray-900 border border-gray-700 rounded-md px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-cyan-600"
                />
                <button
                  onClick={handleReplace}
                  disabled={totalMatches === 0}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-xs rounded-md transition-colors disabled:opacity-50"
                >
                  Replace
                </button>
                <button
                  onClick={handleReplaceAll}
                  disabled={totalMatches === 0}
                  className="px-3 py-1.5 bg-blue-900/50 hover:bg-blue-800/60 border border-blue-700/50 text-blue-300 text-xs rounded-md transition-colors disabled:opacity-50"
                >
                  Replace All
                </button>
              </>
            )}
            
            {searchError && (
              <span className="text-[10px] text-red-400 ml-2">{searchError}</span>
            )}
          </div>

          <div className="relative flex-1 w-full bg-[#0d1117] border border-gray-800 rounded-xl overflow-hidden focus-within:border-cyan-700/50 transition-colors">
            {/* Backdrop */}
            <div
              ref={backdropRef}
              className="absolute inset-0 p-4 text-[13px] leading-relaxed font-mono whitespace-pre-wrap break-words pointer-events-none text-transparent overflow-hidden"
              aria-hidden="true"
            >
              {chunks.map((chunk, i) => {
                if (!chunk.isMatch) return <React.Fragment key={i}>{chunk.text}</React.Fragment>;
                
                const isActive = chunk.index === activeMatchIndex;
                return (
                  <mark 
                    key={i}
                    ref={isActive ? activeMatchRef : null}
                    className={`${isActive ? 'bg-orange-500/80' : 'bg-yellow-500/50'} text-transparent rounded-[2px]`}
                  >
                    {chunk.text}
                  </mark>
                );
              })}
            </div>
            
            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={jsonText}
              readOnly={readOnly}
              onChange={(e) => {
                if (!readOnly) {
                  setJsonText(e.target.value);
                  setError('');
                }
              }}
              onScroll={(e) => {
                if (backdropRef.current) {
                  backdropRef.current.scrollTop = e.target.scrollTop;
                  backdropRef.current.scrollLeft = e.target.scrollLeft;
                }
              }}
              className="absolute inset-0 w-full h-full p-4 text-[13px] leading-relaxed text-emerald-400 font-mono bg-transparent focus:outline-none resize-none overflow-auto whitespace-pre-wrap break-words"
              spellCheck="false"
            />
          </div>
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
              {readOnly ? 'Close' : 'Cancel'}
            </button>
            {!readOnly && (
              <button 
                onClick={handleSave}
                disabled={!!error}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-cyan-700 hover:bg-cyan-600 text-white rounded-lg disabled:opacity-50 transition-colors"
              >
                <Save size={14} /> Update JSON
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
