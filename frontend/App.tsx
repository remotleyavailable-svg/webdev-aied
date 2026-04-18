import React, { useState, useRef, useEffect } from 'react';
import JSZip from 'jszip';
import { ScriptRow, TONES } from './types';
import { generateToneVariation } from './services/geminiService';
import { generateGoogleTTS, GOOGLE_TTS_VOICES } from './services/ttsService';
import { UploadIcon, PlayIcon, StopIcon, XCircleIcon, SpinnerIcon, DownloadIcon } from './components/Icons';

export default function App() {
  const [scripts, setScripts] = useState<ScriptRow[]>([]);
  const [globalTone, setGlobalTone] = useState<string>(TONES[0]);
  const [selectedVoice, setSelectedVoice] = useState<string>(GOOGLE_TTS_VOICES[0].name);
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const parseCSV = (csvText: string) => {
    const result: ScriptRow[] = [];
    let currentPart = '';
    let currentRow: string[] = [];
    let inQuotes = false;

    // Robust character-by-character CSV parser to handle newlines and commas inside quotes
    for (let i = 0; i < csvText.length; i++) {
      const char = csvText[i];
      const nextChar = csvText[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentPart += '"';
          i++; // Skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        currentRow.push(currentPart);
        currentPart = '';
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') i++; // Skip \n of \r\n
        currentRow.push(currentPart);
        
        if (currentRow.length >= 2 || (currentRow.length === 1 && currentRow[0].trim() !== '')) {
           if (currentRow.length >= 2) {
              result.push({
                id: currentRow[0].trim(),
                originalScript: currentRow[1].trim(),
                tone: globalTone,
                generatedScript: '',
                status: 'idle'
              });
           }
        }
        currentRow = [];
        currentPart = '';
      } else {
        currentPart += char;
      }
    }
    
    // Handle the last row if the file doesn't end with a newline
    if (currentPart || currentRow.length > 0) {
      currentRow.push(currentPart);
      if (currentRow.length >= 2) {
        result.push({
          id: currentRow[0].trim(),
          originalScript: currentRow[1].trim(),
          tone: globalTone,
          generatedScript: '',
          status: 'idle'
        });
      }
    }

    // Remove header if present (heuristic check on the first row)
    if (result.length > 0) {
      const firstId = result[0].id.toLowerCase();
      const firstScript = result[0].originalScript.toLowerCase();
      if (firstId.includes('id') || firstId.includes('no') || firstId.includes('num') || firstScript.includes('script')) {
        result.shift();
      }
    }

    setScripts(result);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      parseCSV(text);
    };
    reader.readAsText(file);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleToneChange = (id: string, newTone: string) => {
    setScripts(prev => prev.map(s => s.id === id ? { ...s, tone: newTone, status: 'idle', audioBase64: undefined } : s));
  };

  const handleGlobalToneChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newTone = e.target.value;
    setGlobalTone(newTone);
    setScripts(prev => prev.map(s => ({ ...s, tone: newTone, status: 'idle', audioBase64: undefined })));
  };

  const processRow = async (id: string) => {
    const scriptToProcess = scripts.find(s => s.id === id);
    if (!scriptToProcess) return;

    setScripts(prev => prev.map(s => s.id === id ? { ...s, status: 'processing', errorMessage: undefined } : s));

    try {
      // 1. Generate Script Variation
      const generatedText = await generateToneVariation(scriptToProcess.originalScript, scriptToProcess.tone);
      
      // 2. Generate Audio via Google Cloud TTS
      const audioBase64 = await generateGoogleTTS(generatedText, selectedVoice);

      setScripts(prev => prev.map(s => s.id === id ? { 
        ...s, 
        generatedScript: generatedText, 
        audioBase64,
        status: 'done' 
      } : s));
    } catch (error: any) {
      setScripts(prev => prev.map(s => s.id === id ? { ...s, status: 'error', errorMessage: error.message } : s));
    }
  };

  const processAll = async () => {
    setIsProcessingAll(true);
    for (const script of scripts) {
      if (script.status !== 'done') {
        await processRow(script.id);
      }
    }
    setIsProcessingAll(false);
  };

  const handlePlay = (id: string, base64?: string) => {
    if (!base64) return;

    if (playingId === id) {
      audioRef.current?.pause();
      setPlayingId(null);
    } else {
      audioRef.current?.pause();
      const audio = new Audio(`data:audio/mp3;base64,${base64}`);
      audio.onended = () => setPlayingId(null);
      audio.play();
      audioRef.current = audio;
      setPlayingId(id);
    }
  };

  const handleDownloadSingle = (id: string, base64?: string) => {
    if (!base64) return;
    const url = `data:audio/mp3;base64,${base64}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `voiceover_${id}.mp3`;
    a.click();
  };

  const handleDownloadAllZip = async () => {
    setIsZipping(true);
    try {
      const zip = new JSZip();
      
      // Add Audio Files
      let hasAudio = false;
      scripts.forEach(s => {
        if (s.audioBase64) {
          zip.file(`voiceover_${s.id}.mp3`, s.audioBase64, { base64: true });
          hasAudio = true;
        }
      });

      // Add CSV Summary
      const csvHeader = "ID,Original Script,Tone,Generated Script\n";
      const csvRows = scripts.map(s => {
        const escapeQuotes = (str: string) => str.replace(/"/g, '""');
        return `"${s.id}","${escapeQuotes(s.originalScript)}","${s.tone}","${escapeQuotes(s.generatedScript)}"`;
      }).join("\n");
      zip.file("scripts_summary.csv", csvHeader + csvRows);

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = "ad_voiceovers_batch.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to generate ZIP", error);
      alert("Failed to generate ZIP file.");
    } finally {
      setIsZipping(false);
    }
  };

  const completedCount = scripts.filter(s => s.status === 'done').length;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">AdVoice Batcher</h1>
            <p className="text-sm text-gray-500">Generate creative script variations and download Google TTS voiceovers.</p>
          </div>
          {!process.env.API_KEY && (
             <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-2 rounded-md text-sm flex items-center">
               <XCircleIcon className="w-4 h-4 mr-2 text-yellow-600" />
               API_KEY is missing. Generation will fail.
             </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-6 flex flex-col gap-6">
        
        {/* Controls Section */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-wrap gap-6 items-end">
          
          {/* Upload */}
          <div className="flex-1 min-w-[250px]">
            <label className="block text-sm font-medium text-gray-700 mb-2">Upload Scripts (CSV)</label>
            <div 
              className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md hover:border-indigo-500 transition-colors cursor-pointer bg-gray-50"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="space-y-1 text-center">
                <UploadIcon className="mx-auto h-12 w-12 text-gray-400" />
                <div className="flex text-sm text-gray-600 justify-center">
                  <span className="relative cursor-pointer bg-transparent rounded-md font-medium text-indigo-600 hover:text-indigo-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-indigo-500">
                    Upload a file
                  </span>
                  <p className="pl-1">or drag and drop</p>
                </div>
                <p className="text-xs text-gray-500">CSV format: ID, Script</p>
              </div>
            </div>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              accept=".csv" 
              className="hidden" 
            />
          </div>

          {/* Global Settings */}
          <div className="flex-1 min-w-[250px] space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Global Tone</label>
              <select 
                value={globalTone} 
                onChange={handleGlobalToneChange}
                className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md border"
              >
                {TONES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Google TTS Voice</label>
              <select 
                value={selectedVoice} 
                onChange={(e) => setSelectedVoice(e.target.value)}
                className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md border"
              >
                {GOOGLE_TTS_VOICES.map(v => (
                  <option key={v.name} value={v.name}>
                    {v.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">Requires Cloud TTS enabled on your API key.</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex-none pb-1 flex gap-3">
            <button
              onClick={processAll}
              disabled={scripts.length === 0 || isProcessingAll}
              className={`inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white ${
                scripts.length === 0 || isProcessingAll ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
              } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors`}
            >
              {isProcessingAll ? (
                <>
                  <SpinnerIcon className="mr-2 -ml-1" />
                  Processing...
                </>
              ) : (
                'Generate All'
              )}
            </button>

            <button
              onClick={handleDownloadAllZip}
              disabled={completedCount === 0 || isZipping}
              className={`inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white ${
                completedCount === 0 || isZipping ? 'bg-green-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'
              } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors`}
            >
              {isZipping ? (
                <>
                  <SpinnerIcon className="mr-2 -ml-1" />
                  Zipping...
                </>
              ) : (
                <>
                  <DownloadIcon className="mr-2 -ml-1 w-5 h-5" />
                  Download All (ZIP)
                </>
              )}
            </button>
          </div>
        </div>

        {/* Data Table */}
        {scripts.length > 0 && (
          <div className="bg-white shadow-sm rounded-xl border border-gray-200 overflow-hidden flex-1 flex flex-col">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">ID</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/3">Original Script</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48">Tone</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/3">Generated Script</th>
                    <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-32">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {scripts.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {row.id}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        <div className="max-h-24 overflow-y-auto pr-2 custom-scrollbar">
                          {row.originalScript}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <select 
                          value={row.tone} 
                          onChange={(e) => handleToneChange(row.id, e.target.value)}
                          className="block w-full pl-3 pr-8 py-1.5 text-sm border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 rounded-md border bg-white"
                        >
                          {TONES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {row.status === 'processing' && (
                          <div className="flex items-center text-indigo-600">
                            <SpinnerIcon className="mr-2 w-4 h-4" /> Generating...
                          </div>
                        )}
                        {row.status === 'error' && (
                          <div className="text-red-600 text-xs flex flex-col">
                            <span className="flex items-center font-medium"><XCircleIcon className="w-4 h-4 mr-1"/> Error</span>
                            <span className="mt-1">{row.errorMessage}</span>
                          </div>
                        )}
                        {row.status === 'done' && (
                          <div className="max-h-24 overflow-y-auto pr-2 custom-scrollbar text-gray-900">
                            {row.generatedScript}
                          </div>
                        )}
                        {row.status === 'idle' && (
                          <span className="text-gray-400 italic">Pending generation...</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                        <div className="flex flex-col items-center gap-2">
                          {row.status !== 'processing' && (
                            <button
                              onClick={() => processRow(row.id)}
                              className="text-indigo-600 hover:text-indigo-900 text-xs font-medium"
                            >
                              {row.status === 'done' ? 'Regenerate' : 'Generate'}
                            </button>
                          )}
                          
                          <div className="flex gap-2 mt-1">
                            <button
                              onClick={() => handlePlay(row.id, row.audioBase64)}
                              disabled={!row.audioBase64}
                              className={`p-2 rounded-full flex items-center justify-center transition-colors ${
                                playingId === row.id 
                                  ? 'bg-red-100 text-red-600 hover:bg-red-200' 
                                  : 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed'
                              }`}
                              title={playingId === row.id ? "Stop Audio" : "Play Audio"}
                            >
                              {playingId === row.id ? <StopIcon /> : <PlayIcon />}
                            </button>

                            <button
                              onClick={() => handleDownloadSingle(row.id, row.audioBase64)}
                              disabled={!row.audioBase64}
                              className="p-2 rounded-full flex items-center justify-center transition-colors bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Download MP3"
                            >
                              <DownloadIcon className="w-5 h-5" />
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {scripts.length === 0 && (
          <div className="flex-1 flex items-center justify-center border-2 border-dashed border-gray-200 rounded-xl bg-gray-50">
            <div className="text-center text-gray-500">
              <UploadIcon className="mx-auto h-12 w-12 text-gray-300 mb-3" />
              <p>Upload a CSV file to get started.</p>
            </div>
          </div>
        )}
      </main>
      
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #cbd5e1;
          border-radius: 20px;
        }
      `}} />
    </div>
  );
}
