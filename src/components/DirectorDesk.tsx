import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Sparkles,
  Users,
  Compass,
  CheckCircle2,
  Trash2,
  X,
  BookOpen,
  ArrowRight,
  Info,
  Scroll,
  Paperclip,
  FileText,
  FileCode,
  File,
  UploadCloud,
  Eye,
  RotateCw,
  Brain,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  Book,
  DirectorMessage,
  DirectorAttachment,
  DirectorFileReadReceipt,
  BookCharacter,
  RerollPassageContext,
} from '../types';
import { safeFetchJson } from '../lib/api';
import {
  processUploadedFile,
  formatFileSize,
  getFileCategory,
} from '../lib/fileParser';

interface DirectorDeskProps {
  isOpen: boolean;
  book: Book;
  onClose: () => void;
  onUpdateBook: (updatedBook: Book) => void;
  onOpenCastDrawer?: () => void;
  onOpenBookInfo?: () => void;
  pendingRerollContext?: RerollPassageContext | null;
  onClearRerollContext?: () => void;
}

const DIRECTOR_SUGGESTIONS = [
  'Enforce strict third-person narration and ban all repetitive phrasing or words.',
  'Strip all AI clichés, formulaic sentence triads, and participial openers from the story.',
  'Guide the narrator to push past my outcomes and introduce immediate complications.',
  'Introduce a world rule: spirits can only speak when church bells ring.',
  'Ensure each character maintains their unique voice tone and distinct vocabulary.',
  'Anchor the prose in concrete sensory details and atmospheric tension rather than summaries.',
];

export const DirectorDesk: React.FC<DirectorDeskProps> = ({
  isOpen,
  book,
  onClose,
  onUpdateBook,
  onOpenCastDrawer,
  onOpenBookInfo,
  pendingRerollContext,
  onClearRerollContext,
}) => {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<DirectorAttachment[]>([]);
  const [reasoningLevel, setReasoningLevel] = useState<'off' | 'medium' | 'high'>(
    book.directorReasoningLevel || 'medium'
  );
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [viewingExcerpt, setViewingExcerpt] = useState<DirectorAttachment | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const messages: DirectorMessage[] = book.directorMessages || [];

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, isLoading, attachments, pendingRerollContext]);

  if (!isOpen) return null;

  const toggleThought = (msgId: string) => {
    setExpandedThoughts((prev) => ({
      ...prev,
      [msgId]: prev[msgId] === false ? true : false,
    }));
  };

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3500);
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 130)}px`;
    }
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    setError(null);
    try {
      const newAttachments: DirectorAttachment[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > 15 * 1024 * 1024) {
          showNotification(`File "${file.name}" exceeds 15MB limit.`);
          continue;
        }
        const parsed = await processUploadedFile(file);
        newAttachments.push(parsed);
      }
      if (newAttachments.length > 0) {
        setAttachments((prev) => [...prev, ...newAttachments]);
        showNotification(`Attached ${newAttachments.length} document(s) for Director review.`);
      }
    } catch (err) {
      console.error('File parsing error:', err);
      setError(err instanceof Error ? err.message : 'Failed to process one or more attached files.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleSendMessage = async (textToSend?: string) => {
    const rawText = (textToSend !== undefined ? textToSend : input).trim();
    if ((!rawText && attachments.length === 0) || isLoading || isUploading) return;

    setError(null);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const currentAttachments = [...attachments];
    setAttachments([]);

    const effectiveText = pendingRerollContext
      ? `[Directing Scene Rewrite in "${pendingRerollContext.chapterTitle}"]
Passage being reworked: "${pendingRerollContext.passageSnippet}"

Author's Rewrite Directive:
${rawText || 'Help me rethink and direct how this passage should be rewritten in the story.'}`
      : rawText ||
        (currentAttachments.length === 1
          ? `Please review the attached document "${currentAttachments[0].name}" and update the book's characters and lore accordingly.`
          : `Please review the ${currentAttachments.length} attached documents and integrate their world rules and character profiles.`);

    // Keep only a compact receipt in persistent browser storage. The complete
    // file payload is sent for this request but is not duplicated into the book.
    const storedAttachments: DirectorAttachment[] = currentAttachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      size: attachment.size,
      type: attachment.type,
      readiness: attachment.readiness,
      extractedCharacterCount: attachment.extractedCharacterCount,
      extractedText: attachment.extractedText?.slice(0, 12000),
    }));

    const userMessage: DirectorMessage = {
      id: `dir-msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      role: 'user',
      content: effectiveText,
      attachments: storedAttachments.length > 0 ? storedAttachments : undefined,
      rerollContext: pendingRerollContext || undefined,
      timestamp: Date.now(),
    };

    if (pendingRerollContext && onClearRerollContext) {
      onClearRerollContext();
    }

    const currentMessages = [...(book.directorMessages || []), userMessage];

    // Optimistically update book with user message
    const updatedBookWithUserMsg: Book = {
      ...book,
      directorMessages: currentMessages,
      directorReasoningLevel: reasoningLevel,
      updatedAt: Date.now(),
    };
    onUpdateBook(updatedBookWithUserMsg);
    setIsLoading(true);

    try {
      const data = await safeFetchJson<{
        reply?: string;
        updates?: any;
        thought?: string;
        fallbackUsed?: boolean;
        note?: string;
        filesRead?: DirectorFileReadReceipt[];
      }>('/api/director-chat', {
        method: 'POST',
        body: JSON.stringify({
          book: updatedBookWithUserMsg,
          instruction: effectiveText,
          history: currentMessages,
          attachments: currentAttachments,
          reasoning: reasoningLevel,
        }),
      }, currentAttachments.length > 0 ? 0 : 1);

      const reply = data.reply || 'Your directive has been noted and integrated into the manuscript.';
      const updates = data.updates || {};

      // Apply updates to characters, setting, synopsis, or lore
      let newCharactersList: BookCharacter[] = [...(book.characters || [])];
      const updatedNames: string[] = [];
      const addedNames: string[] = [];
      let settingWasUpdated = false;
      let synopsisWasUpdated = false;
      let loreWasUpdated = false;

      // 1. Update existing characters
      if (Array.isArray(updates.charactersToUpdate) && updates.charactersToUpdate.length > 0) {
        for (const item of updates.charactersToUpdate) {
          if (!item || !item.name) continue;
          const matchIdx = newCharactersList.findIndex(
            (c) => c.name.trim().toLowerCase() === item.name.trim().toLowerCase()
          );
          if (matchIdx >= 0) {
            newCharactersList[matchIdx] = {
              ...newCharactersList[matchIdx],
              role: item.role ? item.role.trim() : newCharactersList[matchIdx].role,
              description: item.description ? item.description.trim() : newCharactersList[matchIdx].description,
              voiceTone: item.voiceTone ? item.voiceTone.trim() : newCharactersList[matchIdx].voiceTone,
            };
            updatedNames.push(newCharactersList[matchIdx].name);
          }
        }
      }

      // 2. Add new characters
      if (Array.isArray(updates.charactersToAdd) && updates.charactersToAdd.length > 0) {
        for (const item of updates.charactersToAdd) {
          if (!item || !item.name) continue;
          const exists = newCharactersList.some(
            (c) => c.name.trim().toLowerCase() === item.name.trim().toLowerCase()
          );
          if (!exists) {
            newCharactersList.push({
              id: `char-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              name: item.name.trim(),
              role: item.role ? item.role.trim() : 'New Character',
              description: item.description ? item.description.trim() : 'Introduced via author directive.',
              voiceTone: item.voiceTone ? item.voiceTone.trim() : (book.dialogueTone || 'Casual & Conversational'),
              createdAt: Date.now(),
            });
            addedNames.push(item.name.trim());
          }
        }
      }

      // 3. Update Setting
      let newSetting = book.setting;
      if (updates.setting && typeof updates.setting === 'string' && updates.setting.trim()) {
        newSetting = updates.setting.trim();
        settingWasUpdated = true;
      }

      // 4. Update Synopsis
      let newSynopsis = book.synopsis;
      if (updates.synopsis && typeof updates.synopsis === 'string' && updates.synopsis.trim()) {
        newSynopsis = updates.synopsis.trim();
        synopsisWasUpdated = true;
      }

      // 5. Update Lore Notes
      let newLoreNotes = book.loreNotes || '';
      let canonTextToStore = '';
      if (updates.loreNotes && typeof updates.loreNotes === 'string' && updates.loreNotes.trim()) {
        const incomingLore = updates.loreNotes.trim().replace(/^\s*[•*-]\s*/, '');
        canonTextToStore = incomingLore;
        const normalizedIncoming = incomingLore.toLowerCase().replace(/\s+/g, ' ');
        const existingFacts = newLoreNotes
          .split(/\n+/)
          .map((line) => line.replace(/^\s*[•*-]\s*/, '').trim().toLowerCase().replace(/\s+/g, ' '))
          .filter(Boolean);

        if (!existingFacts.includes(normalizedIncoming)) {
          newLoreNotes = newLoreNotes
            ? `${newLoreNotes}\n• ${incomingLore}`
            : `• ${incomingLore}`;
          loreWasUpdated = true;
        }
      }

      // 6. Update Dialogue Tone
      let newDialogueTone = book.dialogueTone;
      let dialogueToneWasUpdated = false;
      if (updates.dialogueTone && typeof updates.dialogueTone === 'string' && updates.dialogueTone.trim()) {
        newDialogueTone = updates.dialogueTone.trim();
        dialogueToneWasUpdated = true;
      }

      // 7. Persist a structured, chronological canon ledger in addition to the
      // readable lore notes. This survives reload, edit, export, and import.
      const newCanonFacts = [...(book.canonFacts || [])];
      const affectedCharacters = [...new Set([...updatedNames, ...addedNames])];
      const shouldStoreCanon = Boolean(
        canonTextToStore ||
        affectedCharacters.length > 0 ||
        settingWasUpdated ||
        synopsisWasUpdated ||
        dialogueToneWasUpdated
      );
      if (shouldStoreCanon) {
        const factText = canonTextToStore || effectiveText;
        const normalizedFact = factText.toLowerCase().replace(/\s+/g, ' ').trim();
        const alreadyStored = newCanonFacts.some(
          (fact) => fact.text.toLowerCase().replace(/\s+/g, ' ').trim() === normalizedFact
        );

        if (!alreadyStored) {
          const categories = [
            affectedCharacters.length > 0 ? 'character' : null,
            settingWasUpdated ? 'setting' : null,
            synopsisWasUpdated ? 'synopsis' : null,
            loreWasUpdated ? 'lore' : null,
          ].filter(Boolean);

          newCanonFacts.push({
            id: `canon-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            text: factText,
            sourceMessageId: userMessage.id,
            affectedCharacters: affectedCharacters.length > 0 ? affectedCharacters : undefined,
            category: categories.length === 1
              ? categories[0] as 'character' | 'setting' | 'synopsis' | 'lore'
              : 'mixed',
            createdAt: Date.now(),
          });
        }
      }

      // Format summary of changes
      const summaryParts: string[] = [];
      if (updatedNames.length > 0) {
        summaryParts.push(`Updated ${updatedNames.join(', ')}`);
      }
      if (addedNames.length > 0) {
        summaryParts.push(`Added ${addedNames.join(', ')}`);
      }
      if (settingWasUpdated) {
        summaryParts.push('Updated World Setting');
      }
      if (loreWasUpdated) {
        summaryParts.push('Added World Lore');
      }
      if (synopsisWasUpdated) {
        summaryParts.push('Updated Synopsis');
      }
      if (dialogueToneWasUpdated) {
        summaryParts.push(`Set Dialogue Tone to ${newDialogueTone}`);
      }

      const assistantMessage: DirectorMessage = {
        id: `dir-msg-${Date.now()}`,
        role: 'assistant',
        content: reply,
        thought: data.thought || undefined,
        reasoningLevel: reasoningLevel !== 'off' ? reasoningLevel : undefined,
        directorMode: data.fallbackUsed ? 'local' : 'ai',
        filesRead: Array.isArray(data.filesRead) ? data.filesRead : undefined,
        timestamp: Date.now(),
        appliedUpdates: {
          charactersUpdated: updatedNames.length > 0 ? updatedNames : undefined,
          charactersAdded: addedNames.length > 0 ? addedNames : undefined,
          settingUpdated: settingWasUpdated,
          synopsisUpdated: synopsisWasUpdated,
          loreNotesAdded: loreWasUpdated,
          dialogueToneUpdated: dialogueToneWasUpdated,
          summaryText: summaryParts.join(' · '),
        },
      };

      const finalBook: Book = {
        ...updatedBookWithUserMsg,
        characters: newCharactersList,
        setting: newSetting,
        synopsis: newSynopsis,
        loreNotes: newLoreNotes,
        dialogueTone: newDialogueTone,
        canonFacts: newCanonFacts,
        directorReasoningLevel: reasoningLevel,
        directorMessages: [...currentMessages, assistantMessage],
        updatedAt: Date.now(),
      };

      onUpdateBook(finalBook);

      if (summaryParts.length > 0) {
        showNotification(
          data.fallbackUsed
            ? `Canon saved to library storage: ${summaryParts.join(' · ')}`
            : `Book settings and canon saved: ${summaryParts.join(' · ')}`
        );
      }
    } catch (err) {
      // An unread file must not be recorded as an applied directive. Restore
      // the staged files and roll back the optimistic conversation entry.
      setInput(rawText);
      setAttachments(currentAttachments);
      onUpdateBook(book);
      setError(err instanceof Error ? err.message : 'Consultation failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearHistory = () => {
    if (window.confirm('Clear director conversation history for this book?')) {
      const updatedBook: Book = {
        ...book,
        directorMessages: [],
        updatedAt: Date.now(),
      };
      onUpdateBook(updatedBook);
      showNotification('Director consultation history cleared.');
    }
  };

  const renderFileIcon = (filename: string, mimeType: string, className = 'w-3.5 h-3.5') => {
    const category = getFileCategory(filename, mimeType);
    if (category === 'pdf') return <FileText className={`${className} text-[#b32d2e]`} />;
    if (category === 'word') return <File className={`${className} text-[#2b579a]`} />;
    if (category === 'markdown') return <FileCode className={`${className} text-[#236e59]`} />;
    return <FileText className={`${className} text-[#605a52]`} />;
  };

  const renderFileBadgeColor = (filename: string, mimeType: string) => {
    const category = getFileCategory(filename, mimeType);
    if (category === 'pdf') return 'bg-[#faecec] border-[#f0c8c8] text-[#8e2324]';
    if (category === 'word') return 'bg-[#ebf2fc] border-[#c5daf7] text-[#1c4587]';
    if (category === 'markdown') return 'bg-[#eaf5f0] border-[#c0e6d5] text-[#1a5b48]';
    return 'bg-[#f4efe8] border-[#e2d8ca] text-[#4d463d]';
  };

  return (
    <div
      id="director-desk-overlay"
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex justify-end transition-opacity duration-300 animate-in fade-in"
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDragging(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        handleFileSelect(e.dataTransfer.files);
      }}
    >
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.md,.markdown,.txt,.rtf,.json,.csv"
        className="hidden"
        onChange={(e) => handleFileSelect(e.target.files)}
      />

      <div
        id="director-desk-panel"
        className="relative w-full max-w-xl h-full bg-[#fbf9f5] shadow-2xl flex flex-col border-l border-[#e4dccd] animate-in slide-in-from-right duration-300"
      >
        {/* Drag Overlay Notice */}
        {isDragging && (
          <div className="absolute inset-0 z-50 bg-[#7a282f]/90 backdrop-blur-xs text-[#fbf9f5] flex flex-col items-center justify-center p-6 text-center border-4 border-dashed border-[#f4dec8] m-2 rounded-xl pointer-events-none animate-in fade-in">
            <UploadCloud className="w-12 h-12 text-[#f4dec8] mb-3 animate-bounce" />
            <h3 className="font-display-book text-lg font-bold">Drop Documents Here</h3>
            <p className="text-xs text-[#f4dec8] mt-1 max-w-xs font-serif-book">
              Drop PDF character sheets, Word DOCX outlines, or Markdown world bibles directly into the Director's Desk.
            </p>
          </div>
        )}

        {/* Header */}
        <div className="px-5 py-4 border-b border-[#eae3d6] bg-[#f5efe4] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded bg-[#24211e] text-[#fbf9f5] flex items-center justify-center shadow-xs">
              <Sparkles className="w-4 h-4 text-[#e8c89b]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display-book text-base font-bold text-[#1e1c1a]">
                  Director's Desk
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase bg-[#7a282f]/10 text-[#7a282f]">
                  Private AI
                </span>
              </div>
              <p className="text-xs text-[#6e655b] font-serif-book">
                Direct character relationships, world lore & story rules
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {messages.length > 0 && (
              <button
                id="clear-director-history-btn"
                type="button"
                onClick={handleClearHistory}
                className="p-1.5 text-[#8c8275] hover:text-[#9b2c2c] hover:bg-[#eae3d6] rounded transition-colors"
                title="Clear Consultation History"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              id="close-director-desk-btn"
              type="button"
              onClick={onClose}
              className="p-1.5 text-[#6e655b] hover:text-[#1e1c1a] hover:bg-[#eae3d6] rounded transition-colors"
              title="Close Desk"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Volume Context Bar */}
        <div className="px-5 py-2.5 bg-[#eae2d3]/60 border-b border-[#e4dccd] flex items-center justify-between text-xs text-[#5a5247]">
          <div className="flex items-center gap-2 truncate">
            <span className="font-medium text-[#24211e]">Volume:</span>
            <span className="font-serif-book italic truncate">{book.title}</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onOpenCastDrawer && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenCastDrawer();
                }}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#ffffff] border border-[#d8cfc4] hover:bg-[#fbf9f5] text-[11px] font-medium text-[#3b342c] transition-colors"
              >
                <Users className="w-3 h-3 text-[#7a282f]" />
                <span>Cast ({book.characters.length})</span>
              </button>
            )}
            {onOpenBookInfo && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenBookInfo();
                }}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#ffffff] border border-[#d8cfc4] hover:bg-[#fbf9f5] text-[11px] font-medium text-[#3b342c] transition-colors"
              >
                <Info className="w-3 h-3 text-[#1e3a5f]" />
                <span>Book Settings</span>
              </button>
            )}
          </div>
        </div>

        {/* Reasoning Level Selector Bar */}
        <div className="px-5 py-2 bg-[#f4ece0] border-b border-[#e4dccd] flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-[#5a5247]">
            <Brain className="w-3.5 h-3.5 text-[#7a282f]" />
            <span className="font-semibold text-[11px] text-[#24211e]">Reasoning:</span>
            <span className="text-[10px] text-[#7a7164] hidden sm:inline">
              {reasoningLevel === 'off' && 'Direct, instant responses'}
              {reasoningLevel === 'medium' && 'Balanced character & lore deliberation'}
              {reasoningLevel === 'high' && 'Deep multi-step worldbuilding reasoning'}
            </span>
          </div>

          <div className="flex items-center bg-[#eae2d3] p-0.5 rounded-md border border-[#d8cfc4]">
            {(['off', 'medium', 'high'] as const).map((lvl) => (
              <button
                key={lvl}
                id={`reasoning-btn-${lvl}`}
                type="button"
                onClick={() => {
                  setReasoningLevel(lvl);
                  const updatedBook: Book = {
                    ...book,
                    directorReasoningLevel: lvl,
                    updatedAt: Date.now(),
                  };
                  onUpdateBook(updatedBook);
                  showNotification(`Director Reasoning set to ${lvl.toUpperCase()}`);
                }}
                className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-all capitalize ${
                  reasoningLevel === lvl
                    ? 'bg-[#24211e] text-[#fbf9f5] shadow-xs font-semibold'
                    : 'text-[#6e655b] hover:text-[#1e1c1a] hover:bg-[#ded5c5]'
                }`}
                title={`Switch Director Reasoning to ${lvl}`}
              >
                {lvl}
              </button>
            ))}
          </div>
        </div>

        {/* Active Narrative Laws & Tone Strip */}
        <div className="px-5 py-2 bg-[#fbf9f5] border-b border-[#e4dccd] flex items-center justify-between text-xs overflow-x-auto gap-3">
          <div className="flex items-center gap-1.5 shrink-0 text-[#6e655b]">
            <BookOpen className="w-3.5 h-3.5 text-[#7a282f]" />
            <span className="font-semibold text-[11px] text-[#24211e]">Narrative Directives:</span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#e8f3ec] text-[#2d4b3e] border border-[#c4e3cf] flex items-center gap-1"
              title="All narration is written strictly in third-person (he/she/they/proper names; never 'you' in narration)"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#2d4b3e]"></span>
              3rd-Person POV
            </span>
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#f3edf9] text-[#553c7b] border border-[#dfd1ef] flex items-center gap-1"
              title="Echo vocabulary, repeated descriptors, and conversational loops are banned"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#553c7b]"></span>
              Anti-Repetition
            </span>
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#fbf0ea] text-[#8c4b27] border border-[#f0d3c0] flex items-center gap-1"
              title="Sentence triads, participial openers, and AI tropes are stripped"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#8c4b27]"></span>
              De-AI Grounding
            </span>
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#f5efe4] text-[#6b583e] border border-[#e4dccd] flex items-center gap-1"
              title="Current default dialogue register for this book"
            >
              Tone: <strong>{book.dialogueTone || 'Casual & Conversational'}</strong>
            </span>
          </div>
        </div>

        {/* Floating Notification */}
        {notification && (
          <div className="mx-4 mt-2 px-3 py-2 bg-[#2d4b3e] text-[#fbf9f5] rounded-md text-xs flex items-center gap-2 shadow-md animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-[#8fe2be] shrink-0" />
            <span>{notification}</span>
          </div>
        )}

        {/* Conversation Thread */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="py-6 space-y-5">
              {/* Intro Welcome Card */}
              <div className="p-4 rounded-lg bg-[#ffffff] border border-[#e4dccd] shadow-2xs space-y-2.5">
                <div className="flex items-center gap-2 text-[#7a282f]">
                  <Scroll className="w-4 h-4" />
                  <span className="font-display-book font-bold text-xs uppercase tracking-wider">
                    Author's Private Consultation
                  </span>
                </div>
                <p className="text-xs text-[#524b42] font-serif-book leading-relaxed">
                  This conversation is <strong>completely separate</strong> from the story chapters. You talk directly with the AI here to establish character relationships, world lore, backstories, or tone adjustments.
                </p>
                <div className="p-2.5 rounded bg-[#f5efe4] border border-[#ebe3d5] text-[11px] text-[#5e5549] leading-relaxed">
                  <strong>Example:</strong> Tell the AI <em>"William and Gabrielle are best friends in the same course"</em> — the AI will update both characters' files in the Dramatis Personae and instruct the main story narrator accordingly.
                </div>
                <div className="p-2.5 rounded bg-[#fdfaf5] border border-[#e8dfd1] text-[11px] text-[#544b40] leading-relaxed flex items-start gap-2">
                  <BookOpen className="w-3.5 h-3.5 text-[#7a282f] shrink-0 mt-0.5" />
                  <span>
                    <strong>Active Literary Engine:</strong> The story narrator strictly follows <strong>Third-Person POV</strong>, <strong>Zero Repetition</strong>, <strong>De-AI sensory grounding</strong>, and character <strong>Voice Tones</strong>. Tell the Director anytime you want to re-tune these laws or assign new tones!
                  </span>
                </div>
                <div className="p-2.5 rounded bg-[#ebf2fc] border border-[#d2e2fa] text-[11px] text-[#1c4587] leading-relaxed flex items-start gap-2">
                  <Paperclip className="w-3.5 h-3.5 text-[#1c4587] shrink-0 mt-0.5" />
                  <span>
                    <strong>File Upload Supported:</strong> You can attach or drag-and-drop <strong>PDF documents, Word DOCX files, Markdown (.md), and plain text</strong> notes to feed character sheets or world compendiums directly to the Director!
                  </span>
                </div>
                <div className="p-2.5 rounded bg-[#f3efe8] border border-[#e0d6c6] text-[11px] text-[#544b40] leading-relaxed flex items-start gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-[#7a282f] shrink-0 mt-0.5" />
                  <span>
                    <strong>Reasoning Modes:</strong> Select <strong>Off</strong>, <strong>Medium</strong>, or <strong>High</strong> above to control how deeply the Director analyzes character agency and worldbuilding mechanics.
                  </span>
                </div>
              </div>

              {/* Quick Idea Sparks */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-[#8c8275] uppercase tracking-wider">
                  Directing Prompts to Try
                </p>
                <div className="flex flex-col gap-1.5">
                  {DIRECTOR_SUGGESTIONS.map((sugg, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleSendMessage(sugg)}
                      className="text-left px-3 py-2 bg-[#ffffff] hover:bg-[#f5efe4] border border-[#e4dccd] rounded text-xs text-[#423b33] transition-colors flex items-center justify-between group"
                    >
                      <span className="font-serif-book italic">"{sugg}"</span>
                      <ArrowRight className="w-3.5 h-3.5 text-[#8c8275] group-hover:text-[#7a282f] shrink-0 transition-colors" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-center gap-1.5 mb-1 px-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8c8275]">
                      {isUser ? 'Author Directive' : 'Story Director'}
                    </span>
                    {msg.reasoningLevel && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#eae2d3] text-[#7a282f] font-mono font-medium uppercase">
                        Reasoning: {msg.reasoningLevel}
                      </span>
                    )}
                    {!isUser && msg.directorMode && (
                      <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-medium uppercase ${
                        msg.directorMode === 'ai'
                          ? 'bg-[#e8f3ec] text-[#2d4b3e]'
                          : 'bg-[#fff3d6] text-[#744210]'
                      }`}>
                        {msg.directorMode === 'ai' ? 'Gemini' : 'Local Canon'}
                      </span>
                    )}
                    <span className="text-[10px] text-[#a89e92]">
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  <div
                    className={`max-w-[90%] rounded-lg p-3 text-xs leading-relaxed shadow-2xs ${
                      isUser
                        ? 'bg-[#24211e] text-[#fbf9f5]'
                        : 'bg-[#ffffff] text-[#2c2621] border border-[#e4dccd]'
                    }`}
                  >
                    {/* Attached Files inside Message Bubble */}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="mb-2.5 pb-2 border-b border-white/10 space-y-1.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wider opacity-75">
                          Attached Reference Documents:
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {msg.attachments.map((att) => (
                            <button
                              key={att.id}
                              type="button"
                              onClick={() => setViewingExcerpt(att)}
                              className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#ffffff]/10 hover:bg-[#ffffff]/20 border border-white/15 text-[11px] text-[#fbf9f5] transition-colors"
                              title="Click to view file details"
                            >
                              {renderFileIcon(att.name, att.type, 'w-3 h-3 text-amber-300')}
                              <span className="max-w-[150px] truncate">{att.name}</span>
                              <span className="text-[9px] opacity-60">
                                ({formatFileSize(att.size)})
                              </span>
                              <Eye className="w-2.5 h-2.5 opacity-60" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Reroll / Passage Context Tag */}
                    {msg.rerollContext && (
                      <div className={`mb-2 pb-1.5 border-b text-[10px] flex items-center gap-1.5 ${
                        isUser ? 'border-white/15 text-amber-200' : 'border-[#e4dccd] text-[#7a282f]'
                      }`}>
                        <RotateCw className="w-3 h-3 shrink-0" />
                        <span className="truncate">
                          Directed for scene in <em>{msg.rerollContext.chapterTitle}</em>
                        </span>
                      </div>
                    )}

                    {/* Collapsible Director's Reasoning / Thought Trace */}
                    {!isUser && msg.thought && (
                      <div className="mb-2.5 rounded bg-[#f7f2ea] border border-[#e8dfd1] overflow-hidden text-[11px]">
                        <button
                          type="button"
                          onClick={() => toggleThought(msg.id)}
                          className="w-full px-2.5 py-1.5 flex items-center justify-between text-left hover:bg-[#efe6d8] transition-colors"
                        >
                          <div className="flex items-center gap-1.5 text-[#7a282f] font-semibold">
                            <Brain className="w-3.5 h-3.5 shrink-0" />
                            <span className="uppercase tracking-wider text-[10px]">
                              Director's Deliberation
                            </span>
                          </div>
                          <div className="flex items-center gap-1 text-[10px] text-[#8c8275]">
                            <span>{expandedThoughts[msg.id] !== false ? 'Hide' : 'Show'}</span>
                            {expandedThoughts[msg.id] !== false ? (
                              <ChevronDown className="w-3 h-3" />
                            ) : (
                              <ChevronRight className="w-3 h-3" />
                            )}
                          </div>
                        </button>
                        {expandedThoughts[msg.id] !== false && (
                          <div className="px-3 py-2 border-t border-[#e8dfd1] text-[#4a4238] font-serif-book whitespace-pre-wrap leading-relaxed text-[11px] bg-[#fbf9f5]">
                            {msg.thought}
                          </div>
                        )}
                      </div>
                    )}

                    <p className="whitespace-pre-wrap font-serif-book">{msg.content}</p>

                    {!isUser && msg.filesRead && msg.filesRead.length > 0 && (
                      <div className="mt-2.5 pt-2.5 border-t border-[#f0e8dc] space-y-1.5">
                        <div className="flex items-center gap-1 text-[#2d4b3e] font-semibold text-[10px] uppercase tracking-wider">
                          <FileText className="w-3 h-3" />
                          <span>AI file read receipt</span>
                        </div>
                        {msg.filesRead.map((file) => (
                          <div key={file.name} className="text-[10px] text-[#5a5247]">
                            <strong>{file.name}:</strong> {file.summary}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Applied Updates Pill inside Assistant Bubble */}
                    {msg.appliedUpdates && msg.appliedUpdates.summaryText && (
                      <div className="mt-2.5 pt-2.5 border-t border-[#f0e8dc] bg-[#fbf9f5] -mx-2 -mb-2 p-2 rounded-b-md text-[11px] space-y-1">
                        <div className="flex items-center gap-1 text-[#2d4b3e] font-semibold">
                          <CheckCircle2 className="w-3 h-3 text-[#2d4b3e]" />
                          <span>Applied to Book Settings:</span>
                        </div>
                        <div className="text-[#5a5247] pl-4 font-mono text-[10px]">
                          {msg.appliedUpdates.summaryText}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex items-center gap-2 p-3 bg-[#ffffff] border border-[#e4dccd] rounded-lg max-w-[75%] text-xs text-[#6e655b] animate-pulse">
              <Sparkles className="w-3.5 h-3.5 text-[#7a282f] animate-spin" />
              <span>The Story Director is reviewing your directive & documents and updating the manuscript...</span>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-[#fdf2f2] border border-[#f5c6cb] text-[#721c24] rounded-lg text-xs">
              {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Current Active Lore Preview (if any) */}
        {book.loreNotes && (
          <div className="px-5 py-2 bg-[#f5efe4] border-t border-[#e4dccd] text-[11px] text-[#6e655b] flex items-center justify-between">
            <span className="truncate">
              <strong>Active Lore:</strong> {book.loreNotes.split('\n')[0]}
            </span>
            <span className="text-[10px] text-[#8c8275] shrink-0 ml-2">Applies to Narrator</span>
          </div>
        )}

        {/* Attachment Staging Area */}
        {attachments.length > 0 && (
          <div className="px-4 py-2.5 bg-[#f6f2ea] border-t border-[#e4dccd] space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-[#6e655b]">
              <span className="flex items-center gap-1">
                <Paperclip className="w-3 h-3 text-[#7a282f]" />
                Attached Files for Director ({attachments.length}):
              </span>
              <span className="text-[10px] text-[#8c8275]">AI analysis required on send</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs shadow-2xs ${renderFileBadgeColor(
                    att.name,
                    att.type
                  )}`}
                >
                  {renderFileIcon(att.name, att.type)}
                  <span className="font-medium max-w-[140px] truncate" title={att.name}>
                    {att.name}
                  </span>
                  <span className="text-[10px] opacity-75">({formatFileSize(att.size)})</span>
                  <span className="text-[9px] font-semibold uppercase opacity-75">
                    {att.readiness === 'pdf-ready'
                      ? 'PDF ready'
                      : `${(att.extractedCharacterCount || att.extractedText?.length || 0).toLocaleString()} chars ready`}
                  </span>

                  {att.extractedText && (
                    <button
                      type="button"
                      onClick={() => setViewingExcerpt(att)}
                      className="p-0.5 hover:opacity-75 rounded transition-opacity"
                      title="Inspect extracted text"
                    >
                      <Eye className="w-3 h-3" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => removeAttachment(att.id)}
                    className="p-0.5 hover:opacity-75 rounded transition-opacity ml-1"
                    title="Remove file"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pending Reroll Context Banner */}
        {pendingRerollContext && (
          <div className="px-4 py-2.5 bg-[#fcf8f2] border-t border-[#ebdccb] flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 overflow-hidden">
              <RotateCw className="w-3.5 h-3.5 text-[#7a282f] shrink-0 animate-spin-slow" />
              <div className="truncate">
                <span className="font-semibold text-[#7a282f]">Directing Rewrite for {pendingRerollContext.chapterTitle}: </span>
                <span className="text-[#6e655b] italic truncate">
                  &ldquo;{pendingRerollContext.passageSnippet.slice(0, 70)}...&rdquo;
                </span>
              </div>
            </div>
            {onClearRerollContext && (
              <button
                type="button"
                onClick={onClearRerollContext}
                className="text-[#8c8275] hover:text-[#24211e] p-1 rounded hover:bg-[#ebdccb]/60 transition-colors shrink-0"
                title="Dismiss passage rewrite context"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Input Bar */}
        <div className="p-4 border-t border-[#eae3d6] bg-[#ffffff]">
          <div className="relative flex items-end gap-2">
            <button
              id="attach-director-file-btn"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || isUploading}
              className="h-[38px] px-2.5 bg-[#fbf9f5] hover:bg-[#f5efe4] border border-[#d8cfc4] hover:border-[#b8ad9f] text-[#524b42] rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors shrink-0 shadow-2xs disabled:opacity-40"
              title="Attach files (PDF, DOCX, Markdown, Text)"
            >
              <Paperclip className="w-4 h-4 text-[#7a282f]" />
              <span className="hidden sm:inline text-[11px]">Attach</span>
            </button>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder={
                attachments.length > 0
                  ? "Describe instructions for these files (or press send to auto-integrate)..."
                  : "Tell the AI how characters relate, world rules to establish, or attach reference docs..."
              }
              rows={1}
              className="flex-1 px-3 py-2 bg-[#fbf9f5] border border-[#d8cfc4] rounded-md text-xs text-[#2c2621] placeholder-[#9c9285] focus:outline-hidden focus:border-[#7a282f] resize-none max-h-32 min-h-[38px]"
              disabled={isLoading || isUploading}
            />

            <button
              id="send-director-message-btn"
              type="button"
              onClick={() => handleSendMessage()}
              disabled={(!input.trim() && attachments.length === 0) || isLoading || isUploading}
              className="h-[38px] px-3.5 bg-[#7a282f] hover:bg-[#632026] disabled:opacity-40 text-[#fbf9f5] rounded-md text-xs font-medium flex items-center justify-center transition-colors shrink-0 shadow-2xs"
              title="Send Directive (Enter)"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="mt-1.5 flex items-center justify-between text-[10px] text-[#8c8275]">
            <span className="truncate">
              Supports <strong>.pdf</strong>, <strong>.docx</strong>, <strong>.md</strong>, <strong>.txt</strong> (Drag & Drop or click Attach)
            </span>
            <span className="shrink-0 ml-2">Press Enter to send</span>
          </div>
        </div>
      </div>

      {/* Document Excerpt Preview Modal */}
      {viewingExcerpt && (
        <div
          className="fixed inset-0 z-60 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setViewingExcerpt(null)}
        >
          <div
            className="bg-[#ffffff] w-full max-w-lg rounded-xl border border-[#e4dccd] shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 bg-[#f5efe4] border-b border-[#e4dccd] flex items-center justify-between">
              <div className="flex items-center gap-2">
                {renderFileIcon(viewingExcerpt.name, viewingExcerpt.type, 'w-4 h-4')}
                <div>
                  <h4 className="text-xs font-bold text-[#24211e] truncate max-w-[280px]">
                    {viewingExcerpt.name}
                  </h4>
                  <p className="text-[10px] text-[#7a7063]">
                    {viewingExcerpt.type} · {formatFileSize(viewingExcerpt.size)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingExcerpt(null)}
                className="p-1 rounded text-[#7a7063] hover:text-[#24211e] hover:bg-[#eae3d6]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 text-xs text-[#38332c] leading-relaxed">
              {viewingExcerpt.base64 && viewingExcerpt.type === 'application/pdf' ? (
                <div className="space-y-3 text-center py-6">
                  <FileText className="w-12 h-12 text-[#b32d2e] mx-auto opacity-80" />
                  <p className="font-medium text-[#24211e]">PDF Document Attached</p>
                  <p className="text-[#6e655b] text-[11px] max-w-xs mx-auto">
                    This PDF is encoded directly for the Gemini model to read multimodal pages, tables, and text layout.
                  </p>
                </div>
              ) : viewingExcerpt.extractedText ? (
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[#8c8275]">
                    Document Content:
                  </div>
                  <pre className="p-3 bg-[#fbf9f5] border border-[#eae3d6] rounded-md font-mono text-[11px] text-[#2c2621] whitespace-pre-wrap leading-relaxed max-h-[50vh] overflow-y-auto">
                    {viewingExcerpt.extractedText}
                  </pre>
                </div>
              ) : (
                <p className="text-[#8c8275] italic">No text excerpt preview available.</p>
              )}
            </div>

            <div className="px-5 py-3 bg-[#fbf9f5] border-t border-[#eae3d6] flex justify-end">
              <button
                type="button"
                onClick={() => setViewingExcerpt(null)}
                className="px-3.5 py-1.5 bg-[#24211e] text-[#fbf9f5] rounded-md text-xs font-medium hover:bg-[#383430] transition-colors"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
