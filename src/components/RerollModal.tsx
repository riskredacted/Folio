import React, { useState } from 'react';
import { Sparkles, RotateCw, X, ArrowRight, Wand2, BookOpen } from 'lucide-react';
import { Book, Chapter, ChatMessage, BookCharacter, RerollPassageContext } from '../types';
import { safeFetchJson } from '../lib/api';

export interface RerollModalProps {
  isOpen: boolean;
  message: ChatMessage | null;
  book: Book;
  chapterTitle?: string;
  chapter?: Chapter;
  onClose: () => void;
  onRewriteSubmitted: (rewrittenText: string, newCharacters: BookCharacter[]) => void;
  onConsultDirector: (context: RerollPassageContext) => void;
}

const QUICK_PROMPTS = [
  'Make the dialogue sharper and heighten the unspoken tension between the characters.',
  'Describe the surrounding environment with deeper sensory details (smell, cold, light).',
  'Have the characters hesitate and react with subtle physical gestures.',
  'Slow down the pacing to give the revelation more gravitas.',
  'Take a darker, more ominous narrative turn.',
  'Focus more on internal psychological thoughts and conflicting motives.',
];

export const RerollModal: React.FC<RerollModalProps> = ({
  isOpen,
  message,
  book,
  chapterTitle,
  chapter,
  onClose,
  onRewriteSubmitted,
  onConsultDirector,
}) => {
  const [instructions, setInstructions] = useState('');
  const [isRewriting, setIsRewriting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !message) return null;

  const resolvedChapterTitle = chapterTitle || chapter?.title || 'Current Chapter';

  const handleQuickRewriteClick = async () => {
    setIsRewriting(true);
    setError(null);
    try {
      const data = await safeFetchJson<{
        rewrittenPassage?: string;
        reply?: string;
        newCharacters?: BookCharacter[];
      }>('/api/rewrite-passage', {
        method: 'POST',
        body: JSON.stringify({
          book,
          chapterTitle: resolvedChapterTitle,
          originalPassage: message.content,
          userInstruction: instructions.trim(),
        }),
      });

      const rewritten = data.rewrittenPassage || data.reply;
      if (!rewritten) {
        throw new Error('No rewritten content was returned by the narrative engine.');
      }
      const newChars: BookCharacter[] = Array.isArray(data.newCharacters) ? data.newCharacters : [];

      onRewriteSubmitted(rewritten, newChars);
      onClose();
      setInstructions('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to rewrite passage.');
    } finally {
      setIsRewriting(false);
    }
  };

  const handleTakeToDirector = () => {
    onConsultDirector({
      messageId: message.id,
      passageSnippet: message.content,
      chapterTitle: resolvedChapterTitle,
      initialUserInstruction: instructions.trim() || undefined,
    });
    onClose();
    setInstructions('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div
        className="bg-[#fbf9f5] border border-[#d8cfc4] rounded-xl shadow-2xl max-w-xl w-full overflow-hidden flex flex-col max-h-[90vh] text-[#282522]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 bg-[#2b2724] text-[#fbf9f5] flex items-center justify-between border-b border-[#443e38]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#7a282f] flex items-center justify-center text-[#fbf9f5]">
              <RotateCw className="w-4 h-4 animate-spin-slow" />
            </div>
            <div>
              <h3 className="font-serif-book font-semibold text-base tracking-wide flex items-center gap-2">
                <span>Reroll Passage</span>
                <span className="text-[11px] font-sans-ui bg-[#3d3732] px-2 py-0.5 rounded text-[#d8cfc4] border border-[#524a42]">
                  Private AI Director
                </span>
              </h3>
              <p className="text-[11px] text-[#c4b9aa] font-sans-ui">
                {resolvedChapterTitle} · Direct the living story to reshape this scene
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[#c4b9aa] hover:text-[#ffffff] rounded-md hover:bg-[#3d3732] transition-colors"
            title="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-4 text-sm flex-1">
          {/* Passage Excerpt Preview */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-[#7a282f] flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5" />
              <span>Passage Being Rerolled:</span>
            </label>
            <div className="p-3 bg-[#f3ede3] border border-[#dfd5c7] rounded-lg text-xs font-serif-book italic text-[#4a4239] line-clamp-4 leading-relaxed">
              &ldquo;{message.content}&rdquo;
            </div>
          </div>

          {/* Question / Prompt */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-[#282522] flex items-center justify-between">
              <span>What would you like to change?</span>
              <span className="text-[11px] font-normal text-[#8c8275]">
                Be specific on how it should happen
              </span>
            </label>
            <textarea
              rows={4}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. 'Make Gabrielle react with suspicion instead of warmth, and reveal the torn letter in her pocket as rain hammers the glass...'"
              className="w-full p-3 bg-[#ffffff] border border-[#d8cfc4] rounded-lg text-sm text-[#282522] focus:outline-none focus:ring-2 focus:ring-[#7a282f] font-sans-ui placeholder:text-[#9e9384] placeholder:italic shadow-sm"
              autoFocus
            />
          </div>

          {/* Quick Direction Inspiration Chips */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-[#7a282f] flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-[#b7791f]" />
              Quick Direction Seeds:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map((prompt, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() =>
                    setInstructions((prev) =>
                      prev ? `${prev.trim()} ${prompt}` : prompt
                    )
                  }
                  className="px-2.5 py-1 text-[11px] bg-[#ede6d9] hover:bg-[#e2d8c7] border border-[#d8cfc4] rounded text-[#4a4239] text-left transition-colors"
                >
                  + {prompt}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="p-2.5 bg-[#fdf2f2] border border-[#f5c6cb] text-[#721c24] text-xs rounded-lg">
              {error}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-[#f4eee5] border-t border-[#e5dcd0] flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleTakeToDirector}
            className="w-full sm:w-auto px-4 py-2 text-xs text-[#2b2724] hover:text-[#7a282f] hover:bg-[#ede6d9] border border-[#d8cfc4] rounded-lg font-medium flex items-center justify-center gap-2 transition-colors order-2 sm:order-1"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#b7791f]" />
            <span>Consult in Private Director's Desk</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center gap-2 w-full sm:w-auto order-1 sm:order-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs text-[#6e655b] hover:bg-[#e8dfd2] rounded-lg transition-colors"
            >
              Cancel
            </button>

            <button
              type="button"
              disabled={isRewriting}
              onClick={handleQuickRewriteClick}
              className="px-4 py-2 text-xs bg-[#7a282f] text-[#fbf9f5] rounded-lg font-semibold hover:bg-[#632026] disabled:opacity-50 transition-colors flex items-center gap-1.5 shadow-sm"
            >
              {isRewriting ? (
                <>
                  <Wand2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Rewriting Passage...</span>
                </>
              ) : (
                <>
                  <Wand2 className="w-3.5 h-3.5" />
                  <span>Reroll & Rewrite Passage</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
