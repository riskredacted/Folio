import React, { useState, useEffect } from 'react';
import { X, Key, Check, AlertCircle, Loader2, ExternalLink, ShieldCheck, Trash2, Eye, EyeOff } from 'lucide-react';
import { safeFetchJson } from '../lib/api';

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
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: 'idle' | 'success' | 'depleted' | 'error';
    message?: string;
  }>({ status: 'idle' });
  const [hasSavedKey, setHasSavedKey] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const stored = localStorage.getItem('folio_gemini_api_key') || '';
      setApiKey(stored);
      setHasSavedKey(!!stored.trim());
      setTestResult({ status: 'idle' });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTestKey = async () => {
    setIsTesting(true);
    setTestResult({ status: 'idle' });

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
            status: 'success',
            message:
              response.message ||
              'Key authenticated and verified! Google is experiencing a temporary spike in traffic (503), but your key is saved and will automatically cascade between available models.',
          });
        } else {
          setTestResult({
            status: 'success',
            message: `Successfully connected to Google Gemini (${response.model || 'gemini-3.5-flash-lite'})! Live AI is active.`,
          });
        }
      } else if (response.isDepleted) {
        setTestResult({
          status: 'depleted',
          message:
            response.error ||
            'Prepayment credits depleted ($0 balance). Please get a free API key from Google AI Studio without prepay billing.',
        });
      } else {
        setTestResult({
          status: 'error',
          message: response.error || 'Failed to validate API key. Please check the key.',
        });
      }
    } catch (err: any) {
      setTestResult({
        status: 'error',
        message: err?.message || 'Network error while testing key.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = () => {
    const trimmed = apiKey.trim();
    if (trimmed) {
      localStorage.setItem('folio_gemini_api_key', trimmed);
      setHasSavedKey(true);
      if (onKeyUpdated) onKeyUpdated(true);
    } else {
      localStorage.removeItem('folio_gemini_api_key');
      setHasSavedKey(false);
      if (onKeyUpdated) onKeyUpdated(false);
    }
    onClose();
  };

  const handleClear = () => {
    localStorage.removeItem('folio_gemini_api_key');
    setApiKey('');
    setHasSavedKey(false);
    setTestResult({ status: 'idle' });
    if (onKeyUpdated) onKeyUpdated(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#141210]/60 backdrop-blur-xs animate-fade-in font-sans">
      <div
        className="w-full max-w-lg bg-[#fbf9f5] border border-[#d8cfc4] rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-[#eae3d6] bg-[#f5efe6] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#7a282f] text-[#fbf9f5] flex items-center justify-center shadow-2xs">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display-book text-base font-bold text-[#1e1c1a]">
                Google Gemini API Key
              </h2>
              <p className="text-[11px] text-[#7a7267] font-serif-book italic">
                Enable live Google Gemini AI generation for your stories
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

        {/* Modal Body */}
        <div className="p-5 space-y-4 text-xs text-[#3d362e]">
          <div>
            <p className="leading-relaxed mb-2 text-[#5c544a]">
              Folio uses Google Gemini models (<code className="font-mono text-[#7a282f] bg-[#eee7dc] px-1 py-0.5 rounded">gemini-3.6-flash</code>) to weave rich literary roleplay that follows your exact ideas.
            </p>
            <p className="leading-relaxed text-[#5c544a]">
              If the default key runs out of prepayment credits, you can enter your own free API key from Google AI Studio below. It is stored privately in your browser.
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
                  setTestResult({ status: 'idle' });
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
                Google provides free API keys with generous usage limits on Google AI Studio. No credit card required.
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
                <p className="font-semibold text-xs">Validation Error</p>
                <p className="text-[11px] mt-0.5">{testResult.message}</p>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 border-t border-[#eae3d6] bg-[#f5efe6] flex items-center justify-between">
          <div>
            {hasSavedKey && (
              <button
                type="button"
                onClick={handleClear}
                className="text-[11px] text-[#9c2727] hover:text-[#781818] flex items-center gap-1 font-medium transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove Custom Key</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTestKey}
              disabled={isTesting || !apiKey.trim()}
              className="px-3 py-1.5 bg-white border border-[#d8cfc4] hover:border-[#7a282f] text-[#3d362e] rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
            >
              {isTesting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#7a282f]" />
                  <span>Testing...</span>
                </>
              ) : (
                <span>Test Connection</span>
              )}
            </button>

            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-1.5 bg-[#7a282f] hover:bg-[#632026] text-[#fbf9f5] rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Save & Use</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
