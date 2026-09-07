import React, { useState, useEffect } from 'react';
import {
  X,
  Key,
  Check,
  AlertCircle,
  Loader2,
  ExternalLink,
  ShieldCheck,
  Trash2,
  Eye,
  EyeOff,
  Cpu,
  Sparkles,
  RefreshCw,
  Server,
  HelpCircle,
} from 'lucide-react';
import { safeFetchJson } from '../lib/api';
import { AIProvider } from '../types';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onKeyUpdated?: (hasKey: boolean) => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
  isOpen,
  onClose,
  onKeyUpdated,
}) => {
  // Active provider and tab
  const [activeTab, setActiveTab] = useState<AIProvider>('gemini');
  const [savedProvider, setSavedProvider] = useState<AIProvider>('gemini');

  // Gemini state
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [hasSavedGeminiKey, setHasSavedGeminiKey] = useState(false);

  // Ollama state
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState('llama3.2');
  const [customModelMode, setCustomModelMode] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isOllamaConnected, setIsOllamaConnected] = useState<boolean | null>(null);

  // Testing and saving state
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<{
    tab: AIProvider;
    status: 'idle' | 'success' | 'depleted' | 'error';
    message?: string;
  }>({ tab: 'gemini', status: 'idle' });

  // Load configuration on open
  useEffect(() => {
    if (isOpen) {
      const storedProvider = (localStorage.getItem('folio_ai_provider') as AIProvider) || 'gemini';
      const storedGeminiKey = localStorage.getItem('folio_gemini_api_key') || '';
      const storedOllamaUrl = localStorage.getItem('folio_ollama_url') || 'http://localhost:11434';
      const storedOllamaModel = localStorage.getItem('folio_ollama_model') || 'llama3.2';

      setActiveTab(storedProvider);
      setSavedProvider(storedProvider);
      setApiKey(storedGeminiKey);
      setHasSavedGeminiKey(!!storedGeminiKey.trim());
      setOllamaUrl(storedOllamaUrl);
      setOllamaModel(storedOllamaModel);
      setTestResult({ tab: storedProvider, status: 'idle' });

      // Automatically check Ollama models in background
      fetchOllamaModels(storedOllamaUrl, storedOllamaModel);
    }
  }, [isOpen]);

  const fetchOllamaModels = async (urlToFetch: string, currentModel?: string) => {
    setIsLoadingModels(true);
    try {
      const cleanUrl = urlToFetch.trim() || 'http://localhost:11434';
      const res = await safeFetchJson<{
        connected: boolean;
        models: string[];
        error?: string;
      }>(`/api/ollama/models?url=${encodeURIComponent(cleanUrl)}`);

      if (res.connected && Array.isArray(res.models)) {
        setAvailableModels(res.models);
        setIsOllamaConnected(true);
        if (res.models.length > 0) {
          const modelToUse = currentModel && res.models.includes(currentModel)
            ? currentModel
            : res.models[0];
          setOllamaModel(modelToUse);
        }
      } else {
        setAvailableModels([]);
        setIsOllamaConnected(false);
      }
    } catch {
      setAvailableModels([]);
      setIsOllamaConnected(false);
    } finally {
      setIsLoadingModels(false);
    }
  };

  if (!isOpen) return null;

  // Test current active tab's configuration
  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult({ tab: activeTab, status: 'idle' });

    if (activeTab === 'gemini') {
      try {
        const response = await safeFetchJson<{
          valid: boolean;
          model?: string;
          error?: string;
          isDepleted?: boolean;
          isHighDemand?: boolean;
          message?: string;
        }>('/api/test-key', {
          method: 'POST',
          body: JSON.stringify({
            apiKey: apiKey.trim(),
          }),
        });

        if (response.valid) {
          if (response.isHighDemand) {
            setTestResult({
              tab: 'gemini',
              status: 'success',
              message:
                response.message ||
                'Key verified! Google is experiencing a brief spike in traffic (503), but your key is saved and will cascade across models.',
            });
          } else {
            setTestResult({
              tab: 'gemini',
              status: 'success',
              message: `Successfully connected to Google Gemini (${response.model || 'gemini-3.7-flash'})! Live AI is active.`,
            });
          }
        } else if (response.isDepleted) {
          setTestResult({
            tab: 'gemini',
            status: 'depleted',
            message:
              'This project has prepayment billing enabled with a depleted $0 balance. On Google AI Studio (aistudio.google.com), create an API key in a standard project WITHOUT prepayment billing enabled to use the completely free tier (1,500 requests/day, no card needed).',
          });
        } else {
          setTestResult({
            tab: 'gemini',
            status: 'error',
            message: response.error || 'Failed to validate API key. Please check the key string.',
          });
        }
      } catch (err: any) {
        setTestResult({
          tab: 'gemini',
          status: 'error',
          message: err?.message || 'Network error while testing key.',
        });
      } finally {
        setIsTesting(false);
      }
    } else {
      // Test Ollama
      try {
        const response = await safeFetchJson<{
          valid: boolean;
          model?: string;
          reply?: string;
          error?: string;
        }>('/api/ollama/test', {
          method: 'POST',
          body: JSON.stringify({
            url: ollamaUrl.trim() || 'http://localhost:11434',
            model: ollamaModel.trim() || 'llama3.2',
          }),
        });

        if (response.valid) {
          setIsOllamaConnected(true);
          setTestResult({
            tab: 'ollama',
            status: 'success',
            message: `Successfully connected to local Ollama! Model '${response.model || ollamaModel}' is loaded and responding.`,
          });
        } else {
          setIsOllamaConnected(false);
          setTestResult({
            tab: 'ollama',
            status: 'error',
            message: response.error || 'Ollama is unreachable or model failed to load. Make sure Ollama is running (`ollama serve`).',
          });
        }
      } catch (err: any) {
        setIsOllamaConnected(false);
        setTestResult({
          tab: 'ollama',
          status: 'error',
          message: err?.message || 'Network error connecting to Ollama.',
        });
      } finally {
        setIsTesting(false);
      }
    }
  };

  // Save full configuration
  const handleSave = async () => {
    setIsSaving(true);
    const chosenProvider = activeTab;
    const cleanKey = apiKey.trim();
    const cleanUrl = ollamaUrl.trim() || 'http://localhost:11434';
    const cleanModel = ollamaModel.trim() || 'llama3.2';

    try {
      await safeFetchJson('/api/save-config', {
        method: 'POST',
        body: JSON.stringify({
          provider: chosenProvider,
          apiKey: cleanKey,
          ollamaUrl: cleanUrl,
          ollamaModel: cleanModel,
        }),
      });
    } catch (_err) {
      // Failover to client storage
    }

    // Persist to local browser storage
    localStorage.setItem('folio_ai_provider', chosenProvider);
    localStorage.setItem('folio_ollama_url', cleanUrl);
    localStorage.setItem('folio_ollama_model', cleanModel);

    if (cleanKey) {
      localStorage.setItem('folio_gemini_api_key', cleanKey);
      setHasSavedGeminiKey(true);
    } else {
      localStorage.removeItem('folio_gemini_api_key');
      setHasSavedGeminiKey(false);
    }

    setSavedProvider(chosenProvider);
    if (onKeyUpdated) {
      onKeyUpdated(chosenProvider === 'ollama' || !!cleanKey);
    }

    setIsSaving(false);
    onClose();
  };

  const handleClearGeminiKey = async () => {
    setIsSaving(true);
    try {
      await safeFetchJson('/api/save-key', {
        method: 'POST',
        body: JSON.stringify({ apiKey: '' }),
      });
    } catch (_err) {}

    localStorage.removeItem('folio_gemini_api_key');
    setApiKey('');
    setHasSavedGeminiKey(false);
    setTestResult({ tab: 'gemini', status: 'idle' });
    setIsSaving(false);
    if (onKeyUpdated) onKeyUpdated(activeTab === 'ollama');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#141210]/60 backdrop-blur-xs animate-fade-in font-sans">
      <div
        className="w-full max-w-xl bg-[#fbf9f5] border border-[#d8cfc4] rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-[#eae3d6] bg-[#f5efe6] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#7a282f] text-[#fbf9f5] flex items-center justify-center shadow-2xs">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display-book text-base font-bold text-[#1e1c1a]">
                  AI Engine Settings
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase bg-[#dfd6c8] text-[#4a4238]">
                  {savedProvider === 'ollama' ? 'Ollama Active' : 'Gemini Active'}
                </span>
              </div>
              <p className="text-[11px] text-[#7a7267] font-serif-book italic">
                Choose between Google Gemini Cloud AI or Ollama Local Offline LLM
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[#8c8275] hover:text-[#1e1c1a] rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-5 pt-3 bg-[#f5efe6] border-b border-[#eae3d6] flex gap-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab('gemini');
              setTestResult({ tab: 'gemini', status: 'idle' });
            }}
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition-all flex items-center gap-2 border-t border-x ${
              activeTab === 'gemini'
                ? 'bg-[#fbf9f5] text-[#7a282f] border-[#eae3d6] -mb-px shadow-2xs font-bold'
                : 'text-[#6e655b] border-transparent hover:text-[#1e1c1a] hover:bg-[#eae3d6]/60'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-[#7a282f]" />
            <span>Google Gemini</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-sm bg-[#e8dfd2] text-[#5c544a]">Cloud</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('ollama');
              setTestResult({ tab: 'ollama', status: 'idle' });
            }}
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition-all flex items-center gap-2 border-t border-x ${
              activeTab === 'ollama'
                ? 'bg-[#fbf9f5] text-[#7a282f] border-[#eae3d6] -mb-px shadow-2xs font-bold'
                : 'text-[#6e655b] border-transparent hover:text-[#1e1c1a] hover:bg-[#eae3d6]/60'
            }`}
          >
            <Server className="w-3.5 h-3.5 text-[#2d4b3e]" />
            <span>Ollama (Local LLM)</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-sm bg-[#d7e5de] text-[#2d4b3e]">Offline</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 text-xs text-[#3d362e] max-h-[65vh] overflow-y-auto">
          {/* TAB 1: GEMINI */}
          {activeTab === 'gemini' && (
            <div className="space-y-4 animate-fade-in">
              <div>
                <p className="leading-relaxed mb-2 text-[#5c544a]">
                  Folio connects to Google Gemini models (<code className="font-mono text-[#7a282f] bg-[#eee7dc] px-1 py-0.5 rounded">gemini-3.7-flash</code> & <code className="font-mono text-[#7a282f] bg-[#eee7dc] px-1 py-0.5 rounded">gemini-3.8-flash</code>) for lightning-fast, high-context story generation.
                </p>
                <p className="leading-relaxed text-[#5c544a]">
                  You can enter your own free API key from Google AI Studio. It is stored privately in your browser and automatically used for all book drafting and roleplay.
                </p>
              </div>

              {/* Key Input */}
              <div className="space-y-1.5">
                <label className="block font-semibold text-[#24211e]">
                  Gemini API Key
                </label>
                <div className="relative flex items-center">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setTestResult({ tab: 'gemini', status: 'idle' });
                    }}
                    placeholder="AIzaSy..."
                    className="w-full pl-3 pr-20 py-2.5 bg-white border border-[#d8cfc4] rounded-lg text-xs font-mono text-[#1e1c1a] focus:outline-hidden focus:border-[#7a282f] focus:ring-1 focus:ring-[#7a282f] transition-all"
                  />
                  <div className="absolute right-2 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="p-1 text-[#8c8275] hover:text-[#1e1c1a] transition-colors"
                      title={showKey ? 'Hide key' : 'Show key'}
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* External Link Helper */}
              <div className="p-3 bg-[#faf7f2] border border-[#e8dfd2] rounded-lg flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-[#24211e]">Need a free Gemini API key?</p>
                  <p className="text-[11px] text-[#7a7267] mt-0.5">
                    Google provides free API keys with 1,500 requests/day on Google AI Studio. No credit card required.
                  </p>
                </div>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1.5 bg-[#ffffff] border border-[#d8cfc4] hover:border-[#7a282f] text-[#7a282f] rounded-md font-medium text-[11px] flex items-center gap-1 shrink-0 transition-colors shadow-2xs"
                >
                  <span>Get Key</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          )}

          {/* TAB 2: OLLAMA */}
          {activeTab === 'ollama' && (
            <div className="space-y-4 animate-fade-in">
              <div>
                <p className="leading-relaxed mb-2 text-[#5c544a]">
                  Run Folio with 100% privacy, completely offline on your computer using <strong>Ollama</strong>. No API keys, zero rate limits, and no internet connection required.
                </p>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="font-medium text-[#24211e]">Status:</span>
                  {isLoadingModels ? (
                    <span className="text-[#8c8275] flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> Checking server...
                    </span>
                  ) : isOllamaConnected === true ? (
                    <span className="text-[#2e7d32] font-semibold flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Ollama Running ({availableModels.length} models detected)
                    </span>
                  ) : isOllamaConnected === false ? (
                    <span className="text-[#c53030] font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" /> Ollama Not Detected at {ollamaUrl}
                    </span>
                  ) : (
                    <span className="text-[#7a7267]">Ready to test</span>
                  )}
                </div>
              </div>

              {/* Ollama Server URL */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block font-semibold text-[#24211e]">
                    Ollama Server URL
                  </label>
                  <button
                    type="button"
                    onClick={() => fetchOllamaModels(ollamaUrl, ollamaModel)}
                    disabled={isLoadingModels}
                    className="text-[11px] text-[#7a282f] hover:text-[#52181d] flex items-center gap-1 font-medium"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoadingModels ? 'animate-spin' : ''}`} />
                    <span>Refresh Models</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={ollamaUrl}
                  onChange={(e) => {
                    setOllamaUrl(e.target.value);
                    setTestResult({ tab: 'ollama', status: 'idle' });
                  }}
                  placeholder="http://localhost:11434"
                  className="w-full px-3 py-2 bg-white border border-[#d8cfc4] rounded-lg text-xs font-mono text-[#1e1c1a] focus:outline-hidden focus:border-[#7a282f] focus:ring-1 focus:ring-[#7a282f] transition-all"
                />
              </div>

              {/* Ollama Model Selection */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block font-semibold text-[#24211e]">
                    Installed Model
                  </label>
                  <button
                    type="button"
                    onClick={() => setCustomModelMode(!customModelMode)}
                    className="text-[11px] text-[#7a7267] hover:text-[#24211e] underline"
                  >
                    {customModelMode ? 'Select from list' : 'Type custom model name'}
                  </button>
                </div>

                {!customModelMode && availableModels.length > 0 ? (
                  <select
                    value={ollamaModel}
                    onChange={(e) => {
                      setOllamaModel(e.target.value);
                      setTestResult({ tab: 'ollama', status: 'idle' });
                    }}
                    className="w-full px-3 py-2 bg-white border border-[#d8cfc4] rounded-lg text-xs font-medium text-[#1e1c1a] focus:outline-hidden focus:border-[#7a282f] transition-all cursor-pointer"
                  >
                    {availableModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={ollamaModel}
                    onChange={(e) => {
                      setOllamaModel(e.target.value);
                      setTestResult({ tab: 'ollama', status: 'idle' });
                    }}
                    placeholder="e.g. llama3.2, mistral, deepseek-r1:8b"
                    className="w-full px-3 py-2 bg-white border border-[#d8cfc4] rounded-lg text-xs font-mono text-[#1e1c1a] focus:outline-hidden focus:border-[#7a282f] focus:ring-1 focus:ring-[#7a282f] transition-all"
                  />
                )}
              </div>

              {/* Quick Setup Guide */}
              <div className="p-3 bg-[#faf7f2] border border-[#e8dfd2] rounded-lg space-y-2">
                <div className="flex items-center gap-1.5 font-medium text-[#24211e]">
                  <HelpCircle className="w-3.5 h-3.5 text-[#7a282f]" />
                  <span>How to use Ollama with Folio:</span>
                </div>
                <ol className="list-decimal list-inside space-y-1 text-[11px] text-[#5c544a] leading-relaxed pl-1">
                  <li>
                    Download and install Ollama from{' '}
                    <a
                      href="https://ollama.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#7a282f] underline inline-flex items-center gap-0.5"
                    >
                      ollama.com <ExternalLink className="w-2.5 h-2.5 inline" />
                    </a>
                  </li>
                  <li>
                    Open terminal and pull a model (recommended: <code className="font-mono bg-[#eee7dc] px-1 rounded">ollama run llama3.2</code> or <code className="font-mono bg-[#eee7dc] px-1 rounded">ollama run mistral</code>)
                  </li>
                  <li>Click <strong>Test Connection</strong> below, then <strong>Save & Activate</strong>!</li>
                </ol>
              </div>
            </div>
          )}

          {/* Test Status Feedback */}
          {testResult.status === 'success' && (
            <div className="p-3 bg-[#eef7ee] border border-[#b8e2b8] rounded-lg text-[#1e5e1e] flex items-start gap-2.5 animate-fade-in">
              <ShieldCheck className="w-4 h-4 text-[#2e7d32] shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-xs">Connection Verified</p>
                <p className="text-[11px] mt-0.5">{testResult.message}</p>
              </div>
            </div>
          )}

          {testResult.status === 'depleted' && (
            <div className="p-3 bg-[#fff8e6] border border-[#f3d99f] rounded-lg text-[#855e0a] flex items-start gap-2.5 animate-fade-in">
              <AlertCircle className="w-4 h-4 text-[#d97706] shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-xs">Prepayment Credits Depleted ($0)</p>
                <p className="text-[11px] mt-0.5">{testResult.message}</p>
              </div>
            </div>
          )}

          {testResult.status === 'error' && (
            <div className="p-3 bg-[#fdf0f0] border border-[#f5c6c6] rounded-lg text-[#9c2727] flex items-start gap-2.5 animate-fade-in">
              <AlertCircle className="w-4 h-4 text-[#c53030] shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-xs">Connection / Validation Error</p>
                <p className="text-[11px] mt-0.5">{testResult.message}</p>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 border-t border-[#eae3d6] bg-[#f5efe6] flex items-center justify-between">
          <div>
            {activeTab === 'gemini' && hasSavedGeminiKey && (
              <button
                type="button"
                onClick={handleClearGeminiKey}
                className="text-[11px] text-[#9c2727] hover:text-[#781818] flex items-center gap-1 font-medium transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove Gemini Key</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting || (activeTab === 'gemini' && !apiKey.trim())}
              className="px-3 py-1.5 bg-white border border-[#d8cfc4] hover:border-[#7a282f] text-[#3d362e] rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
            >
              {isTesting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#7a282f]" />
                  <span>Testing {activeTab === 'gemini' ? 'Gemini' : 'Ollama'}...</span>
                </>
              ) : (
                <span>Test Connection</span>
              )}
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || isTesting}
              className="px-4 py-1.5 bg-[#7a282f] hover:bg-[#632026] text-[#fbf9f5] rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors shadow-xs disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#fbf9f5]" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Save & Activate {activeTab === 'gemini' ? 'Gemini' : 'Ollama'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
