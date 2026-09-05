import React, { useState, useRef, useEffect } from 'react';
import { Book, Chapter, ChatMessage, BookCharacter, RerollPassageContext, VOICE_TONE_OPTIONS } from '../types';
import { safeFetchJson } from '../lib/api';
import { BookText } from './BookText';
import { DirectorDesk } from './DirectorDesk';
import { BookInfoModal } from './BookInfoModal';
import { RerollModal } from './RerollModal';
import { ApiKeyModal } from './ApiKeyModal';
import {
  ArrowLeft,
  Send,
  RotateCcw,
  RotateCw,
  Copy,
  Check,
  Edit3,
  Trash2,
  BookOpen,
  Feather,
  Compass,
  Scroll,
  Sparkles,
  Shield,
  Coffee,
  Plus,
  ChevronDown,
  X,
  AlertCircle,
  Users,
  Info,
  Settings,
  UserPlus,
  BookMarked,
  CornerDownLeft,
  Menu,
  CheckCheck,
  Wand2,
  Loader2,
  Key,
} from 'lucide-react';

interface ChatAreaProps {
  book: Book;
  activeChapter: Chapter;
  onBackToLibrary: () => void;
  onSelectChapter: (chapter: Chapter) => void;
  onNewChapter: (customTitle?: string) => void;
  onDeleteChapter: (chapterId: string) => void;
  onUpdateBook: (updatedBook: Book) => void;
  onEditBookDetails: () => void;
}

const STORY_SPARK_CATEGORIES = [
  {
    category: 'Tension & Conflict',
    sparks: [
      'A sudden urgent knock interrupts the conversation',
      'Tensions flare over a hidden secret or betrayal',
      'An armed guard or rival approaches demanding answers',
      'A candle flickers out, plunging the room into darkness',
    ],
  },
  {
    category: 'Discovery & Clues',
    sparks: [
      'A hidden compartment or encrypted letter is uncovered',
      'Someone notices an impossible discrepancy in the story',
      'An ominous symbol is spotted carved into the wall',
      'A forbidden heirloom or stolen artifact resurfaces',
    ],
  },
  {
    category: 'Encounters & Arrivals',
    sparks: [
      'A mysterious traveler arrives soaked from the storm',
      'A nervous courier delivers an urgent sealed dispatch',
      'An eavesdropper is caught listening just outside the door',
      'A forgotten figure from the past steps out of the shadows',
    ],
  },
  {
    category: 'Atmosphere & Danger',
    sparks: [
      'The storm outside turns violent and traps everyone inside',
      'Church bells toll an alarm across the misty streets',
      'The subtle smell of burning or strange smoke fills the air',
      'Creaking floorboards betray footsteps in the room above',
    ],
  },
];

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  BookOpen,
  Feather,
  Compass,
  Scroll,
  Sparkles,
  Shield,
  Coffee,
};

export const ChatArea: React.FC<ChatAreaProps> = ({
  book,
  activeChapter,
  onBackToLibrary,
  onSelectChapter,
  onNewChapter,
  onDeleteChapter,
  onUpdateBook,
  onEditBookDetails,
}) => {
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState('');
  const [showChapterMenu, setShowChapterMenu] = useState(false);
  const [showCastDrawer, setShowCastDrawer] = useState(false);
  const [showBookInfo, setShowBookInfo] = useState(false);
  const [showBookInfoModal, setShowBookInfoModal] = useState(false);
  const [showDirectorDesk, setShowDirectorDesk] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [apiWarning, setApiWarning] = useState<string | null>(null);
  const [newCharNotification, setNewCharNotification] = useState<string | null>(null);

  // Reroll & Scene Direction state
  const [rerollMessage, setRerollMessage] = useState<ChatMessage | null>(null);
  const [rerollingMsgId, setRerollingMsgId] = useState<string | null>(null);
  const [pendingDirectorReroll, setPendingDirectorReroll] = useState<RerollPassageContext | null>(null);

  // Character manual addition state inside drawer
  const [manualName, setManualName] = useState('');
  const [manualRole, setManualRole] = useState('');
  const [manualVoiceTone, setManualVoiceTone] = useState<string>('Casual & Conversational');
  const [manualDesc, setManualDesc] = useState('');
  const [isAddingManualChar, setIsAddingManualChar] = useState(false);

  // Mobile burger menu state
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  // Story Sparks Dropdown state
  const [showSparksDropdown, setShowSparksDropdown] = useState(false);
  const sparksDropdownRef = useRef<HTMLDivElement>(null);

  // Grammar Corrector state
  const [isCorrectingGrammar, setIsCorrectingGrammar] = useState(false);
  const [grammarStatus, setGrammarStatus] = useState<'idle' | 'success' | 'no-change' | 'error'>('idle');

  // Chapter renaming state
  const [isRenamingChapter, setIsRenamingChapter] = useState(false);
  const [renameTitle, setRenameTitle] = useState(activeChapter?.title || 'Chapter I');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const IconComp = ICON_MAP[book.coverIcon] || BookOpen;

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeChapter?.messages, isLoading]);

  useEffect(() => {
    if (activeChapter?.title) {
      setRenameTitle(activeChapter.title);
    }
  }, [activeChapter?.title]);

  // Close menus on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setShowMobileMenu(false);
      }
      if (sparksDropdownRef.current && !sparksDropdownRef.current.contains(e.target as Node)) {
        setShowSparksDropdown(false);
      }
    };
    if (showMobileMenu || showSparksDropdown) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [showMobileMenu, showSparksDropdown]);

  const handleSelectSpark = (sparkText: string) => {
    setInputMessage(sparkText);
    setShowSparksDropdown(false);
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = 'auto';
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
        }
      }, 0);
    }
  };

  const handleCorrectGrammar = async () => {
    if (!inputMessage.trim() || isCorrectingGrammar) return;
    setIsCorrectingGrammar(true);
    setGrammarStatus('idle');
    try {
      const data = await safeFetchJson<{ correctedText?: string }>('/api/grammar-correct', {
        method: 'POST',
        body: JSON.stringify({ text: inputMessage }),
      });
      if (data && data.correctedText) {
        const originalTrimmed = inputMessage.trim();
        const correctedTrimmed = data.correctedText.trim();
        if (originalTrimmed === correctedTrimmed) {
          setGrammarStatus('no-change');
        } else {
          setInputMessage(data.correctedText);
          setGrammarStatus('success');
        }
        setTimeout(() => setGrammarStatus('idle'), 3000);
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.style.height = 'auto';
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
            }
          }, 0);
        }
      } else {
        setGrammarStatus('no-change');
        setTimeout(() => setGrammarStatus('idle'), 2500);
      }
    } catch (err) {
      console.error('Grammar corrector error:', err);
      setGrammarStatus('error');
      setTimeout(() => setGrammarStatus('idle'), 3000);
    } finally {
      setIsCorrectingGrammar(false);
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputMessage(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMsgId(id);
    setTimeout(() => setCopiedMsgId(null), 2000);
  };

  // Send message to Gemini server endpoint
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputMessage).trim();
    if (!text || isLoading) return;

    setErrorMessage(null);
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    const updatedMessages = [...activeChapter.messages, userMsg];
    const updatedChapter: Chapter = {
      ...activeChapter,
      messages: updatedMessages,
      updatedAt: Date.now(),
    };

    const updatedBook: Book = {
      ...book,
      chapters: book.chapters.map((ch) =>
        ch.id === activeChapter.id ? updatedChapter : ch
      ),
      updatedAt: Date.now(),
    };

    onUpdateBook(updatedBook);
    setInputMessage('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    setIsLoading(true);

    try {
      const data = await safeFetchJson<{
        reply?: string;
        newCharacters?: Array<{ name: string; role: string; description: string }>;
        apiWarning?: string | null;
      }>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          book: updatedBook,
          chapterTitle: activeChapter.title,
          messages: updatedMessages,
        }),
      });

      if (data.apiWarning) {
        setApiWarning(data.apiWarning);
      } else {
        setApiWarning(null);
      }

      const replyContent =
        data.reply ||
        '*The narrator pauses, turning the page into contemplative silence.*';

      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        role: 'assistant',
        content: replyContent,
        timestamp: Date.now(),
      };

      // Check for dynamically discovered new characters
      let finalCharacters = [...updatedBook.characters];
      const newlyDiscovered = data.newCharacters as
        | Array<{ name: string; role: string; description: string }>
        | undefined;

      if (Array.isArray(newlyDiscovered) && newlyDiscovered.length > 0) {
        const addedNames: string[] = [];
        for (const newChar of newlyDiscovered) {
          if (!newChar.name) continue;
          const exists = finalCharacters.some(
            (c) => c.name.trim().toLowerCase() === newChar.name.trim().toLowerCase()
          );
          if (!exists) {
            finalCharacters.push({
              id: `char-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              name: newChar.name.trim(),
              role: newChar.role || 'Dramatis Persona',
              description: newChar.description || 'Appeared in the story.',
              color: book.coverColor,
              createdAt: Date.now(),
            });
            addedNames.push(newChar.name.trim());
          }
        }

        if (addedNames.length > 0) {
          setNewCharNotification(
            `✨ Character Born in Book: ${addedNames.join(', ')} entered the Dramatis Personae!`
          );
          setTimeout(() => setNewCharNotification(null), 5000);
        }
      }

      const chapterWithReply: Chapter = {
        ...updatedChapter,
        messages: [...updatedMessages, assistantMsg],
        updatedAt: Date.now(),
      };

      const finalBook: Book = {
        ...updatedBook,
        characters: finalCharacters,
        chapters: updatedBook.chapters.map((ch) =>
          ch.id === activeChapter.id ? chapterWithReply : ch
        ),
        updatedAt: Date.now(),
      };

      onUpdateBook(finalBook);
    } catch (err) {
      console.error('Chat error:', err);
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Failed to communicate with the narrative engine. Please check your Gemini API key.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Regenerate last assistant reply
  const handleRegenerate = async () => {
    if (isLoading || activeChapter.messages.length === 0) return;

    let msgs = [...activeChapter.messages];
    if (msgs[msgs.length - 1].role === 'assistant') {
      msgs.pop();
    }
    if (msgs.length === 0) return;

    const updatedChapter: Chapter = {
      ...activeChapter,
      messages: msgs,
      updatedAt: Date.now(),
    };

    const updatedBook: Book = {
      ...book,
      chapters: book.chapters.map((ch) =>
        ch.id === activeChapter.id ? updatedChapter : ch
      ),
      updatedAt: Date.now(),
    };

    onUpdateBook(updatedBook);
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const data = await safeFetchJson<{
        reply?: string;
        newCharacters?: Array<{ name: string; role: string; description: string }>;
        apiWarning?: string | null;
      }>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          book: updatedBook,
          chapterTitle: activeChapter.title,
          messages: msgs,
        }),
      });

      if (data.apiWarning) {
        setApiWarning(data.apiWarning);
      } else {
        setApiWarning(null);
      }

      const replyContent = data.reply || '*The pages turn softly.*';

      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: replyContent,
        timestamp: Date.now(),
      };

      const chapterWithReply: Chapter = {
        ...updatedChapter,
        messages: [...msgs, assistantMsg],
        updatedAt: Date.now(),
      };

      const finalBook: Book = {
        ...updatedBook,
        chapters: updatedBook.chapters.map((ch) =>
          ch.id === activeChapter.id ? chapterWithReply : ch
        ),
        updatedAt: Date.now(),
      };

      onUpdateBook(finalBook);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Regeneration failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Message editing
  const handleStartEdit = (msg: ChatMessage) => {
    setEditingMsgId(msg.id);
    setEditInput(msg.content);
  };

  const handleSaveEdit = () => {
    if (!editingMsgId) return;
    const updatedMessages = activeChapter.messages.map((m) =>
      m.id === editingMsgId ? { ...m, content: editInput.trim() } : m
    );

    const updatedChapter: Chapter = {
      ...activeChapter,
      messages: updatedMessages,
      updatedAt: Date.now(),
    };

    const updatedBook: Book = {
      ...book,
      chapters: book.chapters.map((ch) =>
        ch.id === activeChapter.id ? updatedChapter : ch
      ),
      updatedAt: Date.now(),
    };

    onUpdateBook(updatedBook);
    setEditingMsgId(null);
    setEditInput('');
  };

  const handleDeleteMessage = (msgId: string) => {
    const updatedMessages = activeChapter.messages.filter((m) => m.id !== msgId);
    const updatedChapter: Chapter = {
      ...activeChapter,
      messages: updatedMessages,
      updatedAt: Date.now(),
    };

    const updatedBook: Book = {
      ...book,
      chapters: book.chapters.map((ch) =>
        ch.id === activeChapter.id ? updatedChapter : ch
      ),
      updatedAt: Date.now(),
    };

    onUpdateBook(updatedBook);
  };

  // Handle direct rewrite of a message from the RerollModal
  const handleRerollRewrite = (rewrittenText: string, newCharacters: BookCharacter[]) => {
    if (!rerollMessage) return;

    const updatedMessages = activeChapter.messages.map((m) =>
      m.id === rerollMessage.id ? { ...m, content: rewrittenText } : m
    );

    const updatedChapter: Chapter = {
      ...activeChapter,
      messages: updatedMessages,
      updatedAt: Date.now(),
    };

    let existingChars = [...(book.characters || [])];
    if (newCharacters && newCharacters.length > 0) {
      for (const nc of newCharacters) {
        if (!existingChars.some((c) => c.name.trim().toLowerCase() === nc.name.trim().toLowerCase())) {
          existingChars.push(nc);
        }
      }
    }

    const updatedBook: Book = {
      ...book,
      characters: existingChars,
      chapters: book.chapters.map((ch) =>
        ch.id === activeChapter.id ? updatedChapter : ch
      ),
      updatedAt: Date.now(),
    };

    onUpdateBook(updatedBook);
    setRerollMessage(null);
    if (newCharacters && newCharacters.length > 0) {
      setNewCharNotification(`Added ${newCharacters.length} character(s) to cast.`);
      setTimeout(() => setNewCharNotification(null), 4000);
    }
  };

  // Quick 1-click in-place passage reroll
  const handleQuickReroll = async (msg: ChatMessage) => {
    setRerollingMsgId(msg.id);
    try {
      const data = await safeFetchJson<{
        rewrittenPassage?: string;
        reply?: string;
        newCharacters?: BookCharacter[];
      }>('/api/rewrite-passage', {
        method: 'POST',
        body: JSON.stringify({
          book,
          chapterTitle: activeChapter.title,
          originalPassage: msg.content,
          userInstruction: '',
        }),
      });

      const rewritten = data.rewrittenPassage || data.reply;
      if (rewritten) {
        const updatedMessages = activeChapter.messages.map((m) =>
          m.id === msg.id ? { ...m, content: rewritten } : m
        );
        const updatedChapter: Chapter = {
          ...activeChapter,
          messages: updatedMessages,
          updatedAt: Date.now(),
        };

        let existingChars = [...(book.characters || [])];
        if (data.newCharacters && data.newCharacters.length > 0) {
          for (const nc of data.newCharacters) {
            if (!existingChars.some((c) => c.name.trim().toLowerCase() === nc.name.trim().toLowerCase())) {
              existingChars.push(nc);
            }
          }
        }

        const updatedBook: Book = {
          ...book,
          characters: existingChars,
          chapters: book.chapters.map((ch) =>
            ch.id === activeChapter.id ? updatedChapter : ch
          ),
          updatedAt: Date.now(),
        };
        onUpdateBook(updatedBook);
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to reroll passage.');
    } finally {
      setRerollingMsgId(null);
    }
  };

  // Switch to DirectorDesk with the scene context preloaded
  const handleConsultDirectorForReroll = (context: RerollPassageContext) => {
    setRerollMessage(null);
    setPendingDirectorReroll(context);
    setShowDirectorDesk(true);
  };

  // Manual character addition into book
  const handleAddManualCharacter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualName.trim()) return;

    const newChar: BookCharacter = {
      id: `char-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: manualName.trim(),
      role: manualRole.trim() || 'Dramatis Persona',
      voiceTone: manualVoiceTone.trim() || 'Casual & Conversational',
      description: manualDesc.trim() || 'Introduced into the book.',
      color: book.coverColor,
      createdAt: Date.now(),
    };

    const updatedBook: Book = {
      ...book,
      characters: [...book.characters, newChar],
      updatedAt: Date.now(),
    };

    onUpdateBook(updatedBook);
    setManualName('');
    setManualRole('');
    setManualVoiceTone('Casual & Conversational');
    setManualDesc('');
    setIsAddingManualChar(false);
  };

  const handleUpdateCharacterTone = (charId: string, newTone: string) => {
    const updatedBook: Book = {
      ...book,
      characters: book.characters.map((c) =>
        c.id === charId ? { ...c, voiceTone: newTone } : c
      ),
      updatedAt: Date.now(),
    };
    onUpdateBook(updatedBook);
  };

  const handleRemoveCharacter = (charId: string) => {
    const updatedBook: Book = {
      ...book,
      characters: book.characters.filter((c) => c.id !== charId),
      updatedAt: Date.now(),
    };
    onUpdateBook(updatedBook);
  };

  // Save renamed chapter title
  const handleSaveChapterTitle = () => {
    if (!renameTitle.trim()) return;
    const updatedChapter: Chapter = {
      ...activeChapter,
      title: renameTitle.trim(),
      updatedAt: Date.now(),
    };
    const updatedBook: Book = {
      ...book,
      chapters: book.chapters.map((ch) =>
        ch.id === activeChapter.id ? updatedChapter : ch
      ),
      updatedAt: Date.now(),
    };
    onUpdateBook(updatedBook);
    setIsRenamingChapter(false);
  };

  // Quick insertion of addressing a character
  const handleAddressCharacter = (charName: string) => {
    const textToAppend = `*Addressing ${charName},* "`;
    setInputMessage((prev) => (prev ? `${prev} ${textToAppend}` : textToAppend));
    textareaRef.current?.focus();
  };

  return (
    <div className="h-screen max-h-screen bg-[#fbf9f5] flex flex-col selection:bg-[#ecdcc9] text-[#292623] overflow-hidden">
      {/* Top Reading Room Navigation Bar */}
      <header className="border-b border-[#eae3d6] bg-[#fbf9f5]/95 shrink-0 z-30 backdrop-blur-xs">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          {/* Back & Book Title */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              id="back-to-library-btn"
              type="button"
              onClick={onBackToLibrary}
              className="p-1.5 text-[#6e655b] hover:text-[#1e1c1a] hover:bg-[#ede6d9] rounded transition-colors"
              title="Return to Reading Library"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            <div
              className="w-7 h-7 rounded-sm flex items-center justify-center text-[#fbf9f5] shrink-0 shadow-2xs"
              style={{ backgroundColor: book.coverColor || '#7a282f' }}
            >
              <IconComp className="w-4 h-4" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-display-book text-sm sm:text-base font-bold text-[#1e1c1a] truncate">
                  {book.title}
                </h1>
                <button
                  id="book-info-header-badge-btn"
                  type="button"
                  onClick={() => setShowBookInfoModal(true)}
                  className="px-1.5 py-0.5 rounded text-[11px] font-medium text-[#7a282f] bg-[#ffffff] hover:bg-[#eae1d2] border border-[#d8cfc4] flex items-center gap-1 transition-colors shadow-2xs shrink-0"
                  title="View Book Settings & Information"
                >
                  <Info className="w-3 h-3 text-[#7a282f]" />
                  <span className="hidden sm:inline">Settings & Info</span>
                </button>
              </div>

              {/* Active Chapter Selector */}
              <div className="relative flex items-center gap-1.5">
                {isRenamingChapter ? (
                  <div className="flex items-center gap-1 mt-0.5">
                    <input
                      type="text"
                      value={renameTitle}
                      onChange={(e) => setRenameTitle(e.target.value)}
                      className="px-1.5 py-0.5 text-xs bg-[#ffffff] border border-[#d8cfc4] rounded"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={handleSaveChapterTitle}
                      className="p-0.5 text-xs text-[#2d4b3e]"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsRenamingChapter(false)}
                      className="p-0.5 text-xs text-[#8c8275]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowChapterMenu(!showChapterMenu)}
                    className="flex items-center gap-1 text-xs text-[#7a282f] hover:text-[#521b20] font-serif-book italic truncate"
                  >
                    <span>{activeChapter.title}</span>
                    <ChevronDown className="w-3 h-3" />
                  </button>
                )}

                {/* Chapter Selection Dropdown */}
                {showChapterMenu && (
                  <div className="absolute left-0 top-6 w-64 bg-[#ffffff] rounded-md shadow-xl border border-[#ded5c8] py-1.5 z-40 text-xs">
                    <div className="px-3 py-1 text-[11px] font-semibold text-[#8c8275] uppercase tracking-wider border-b border-[#f0e9df] flex items-center justify-between">
                      <span>Chapters in Volume</span>
                      <button
                        type="button"
                        onClick={() => {
                          setShowChapterMenu(false);
                          onNewChapter();
                        }}
                        className="text-[#7a282f] hover:underline flex items-center gap-0.5 normal-case font-normal"
                      >
                        <Plus className="w-3 h-3" />
                        <span>New</span>
                      </button>
                    </div>

                    <div className="max-h-56 overflow-y-auto">
                      {book.chapters.map((ch) => (
                        <div
                          key={ch.id}
                          className={`px-3 py-2 flex items-center justify-between hover:bg-[#f4eee6] cursor-pointer ${
                            ch.id === activeChapter.id
                              ? 'bg-[#f4eee6] font-medium text-[#7a282f]'
                              : 'text-[#4a4239]'
                          }`}
                          onClick={() => {
                            onSelectChapter(ch);
                            setShowChapterMenu(false);
                          }}
                        >
                          <span className="truncate flex-1">{ch.title}</span>
                          {book.chapters.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (
                                  window.confirm(
                                    `Delete chapter "${ch.title}"? This cannot be undone.`
                                  )
                                ) {
                                  onDeleteChapter(ch.id);
                                }
                              }}
                              className="p-1 text-[#a69c8f] hover:text-[#9b2c2c] ml-2"
                              title="Delete chapter"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="pt-1 mt-1 border-t border-[#f0e9df] px-3 py-1 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => {
                          setShowChapterMenu(false);
                          setIsRenamingChapter(true);
                        }}
                        className="text-[11px] text-[#6e655b] hover:text-[#1e1c1a]"
                      >
                        Rename active chapter
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Desktop Header Controls: Book Settings, Director's Desk & Dramatis Personae */}
          <div className="hidden md:flex items-center gap-2">
            <button
              id="open-api-key-header-btn"
              type="button"
              onClick={() => setShowApiKeyModal(true)}
              className="px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 border transition-colors bg-[#ffffff] text-[#3d362e] border-[#d8cfc4] hover:bg-[#f2ede4] hover:border-[#b8ad9e] shadow-2xs"
              title="Configure Gemini API Key & Connection Status"
            >
              <Key className="w-3.5 h-3.5 text-[#7a282f]" />
              <span className="font-sans">AI Key</span>
            </button>

            <button
              id="open-book-settings-header-btn"
              type="button"
              onClick={() => setShowBookInfoModal(true)}
              className="px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 border transition-colors bg-[#ffffff] text-[#3d362e] border-[#d8cfc4] hover:bg-[#f2ede4] hover:border-[#b8ad9e] shadow-2xs"
              title="Open Book Settings, World Lore, Synopsis & Information"
            >
              <Settings className="w-3.5 h-3.5 text-[#7a282f]" />
              <span className="font-sans">Book Settings</span>
            </button>

            <button
              id="open-director-desk-header-btn"
              type="button"
              onClick={() => setShowDirectorDesk(true)}
              className="px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 border transition-colors bg-[#ffffff] text-[#3d362e] border-[#d8cfc4] hover:bg-[#f2ede4] hover:border-[#b8ad9e] shadow-2xs"
              title="Private conversation with the AI to adjust character relationships, lore, and directions"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#7a282f]" />
              <span className="font-sans">Director's Desk</span>
              {book.directorMessages && book.directorMessages.length > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-[#7a282f]" title="Active consultations" />
              )}
            </button>

            <button
              id="toggle-cast-drawer-btn"
              type="button"
              onClick={() => setShowCastDrawer(!showCastDrawer)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 border transition-colors ${
                showCastDrawer
                  ? 'bg-[#24211e] text-[#fbf9f5] border-[#24211e]'
                  : 'bg-[#ffffff] text-[#4a4239] border-[#d8cfc4] hover:bg-[#f2ede4]'
              }`}
            >
              <Users className="w-3.5 h-3.5 text-[#7a282f]" />
              <span className="font-sans">Dramatis Personae</span>
              <span className="px-1.5 py-0.2 bg-[#f0e9df] text-[#4a4239] rounded-full text-[10px] font-semibold">
                {book.characters.length}
              </span>
            </button>
          </div>

          {/* Mobile Burger Button & Menu */}
          <div className="relative flex md:hidden items-center" ref={mobileMenuRef}>
            <button
              id="mobile-burger-menu-btn"
              type="button"
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              className={`p-2 rounded-lg border transition-colors flex items-center justify-center relative ${
                showMobileMenu
                  ? 'bg-[#7a282f] text-[#fbf9f5] border-[#7a282f]'
                  : 'bg-[#ffffff] text-[#3d362e] border-[#d8cfc4] hover:bg-[#f2ede4]'
              }`}
              title="Open Navigation Menu"
              aria-label="Navigation Menu"
            >
              <Menu className="w-5 h-5" />
              {book.directorMessages && book.directorMessages.length > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#e53e3e] ring-2 ring-white" />
              )}
            </button>

            {/* Mobile Burger Dropdown Menu */}
            {showMobileMenu && (
              <div className="absolute right-0 top-11 w-64 bg-[#ffffff] rounded-xl shadow-2xl border border-[#ded5c8] py-2 z-50 text-xs animate-fade-in font-sans">
                <div className="px-3.5 py-2 border-b border-[#f0e9df] bg-[#faf7f2] rounded-t-lg">
                  <p className="font-display-book font-bold text-[#1e1c1a] text-sm truncate">
                    {book.title}
                  </p>
                  <p className="text-[11px] text-[#8c8275] font-serif-book italic truncate">
                    {activeChapter.title}
                  </p>
                </div>

                <div className="p-1.5 space-y-1">
                  {/* Button 0: API Key Settings */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowMobileMenu(false);
                      setShowApiKeyModal(true);
                    }}
                    className="w-full px-3 py-2 rounded-lg text-left text-xs font-medium text-[#2d2823] hover:bg-[#f4eee6] flex items-center justify-between transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-md bg-[#f4eee6] flex items-center justify-center text-[#7a282f]">
                        <Key className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <p className="font-semibold">Gemini API Key</p>
                        <p className="text-[10px] text-[#8c8275]">Configure & Test AI Connection</p>
                      </div>
                    </div>
                  </button>

                  {/* Button 1: Book Settings */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowMobileMenu(false);
                      setShowBookInfoModal(true);
                    }}
                    className="w-full px-3 py-2 rounded-lg text-left text-xs font-medium text-[#2d2823] hover:bg-[#f4eee6] flex items-center justify-between transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-md bg-[#f4eee6] flex items-center justify-center text-[#7a282f]">
                        <Settings className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <p className="font-semibold">Book Settings</p>
                        <p className="text-[10px] text-[#8c8275]">World Lore, Rules & Synopsis</p>
                      </div>
                    </div>
                  </button>

                  {/* Button 2: Director's Desk */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowMobileMenu(false);
                      setShowDirectorDesk(true);
                    }}
                    className="w-full px-3 py-2 rounded-lg text-left text-xs font-medium text-[#2d2823] hover:bg-[#f4eee6] flex items-center justify-between transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-md bg-[#f4eee6] flex items-center justify-center text-[#7a282f]">
                        <Sparkles className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <p className="font-semibold flex items-center gap-1.5">
                          <span>Director's Desk</span>
                          {book.directorMessages && book.directorMessages.length > 0 && (
                            <span className="w-1.5 h-1.5 rounded-full bg-[#7a282f]" />
                          )}
                        </p>
                        <p className="text-[10px] text-[#8c8275]">Private AI Author Consultation</p>
                      </div>
                    </div>
                  </button>

                  {/* Button 3: Dramatis Personae */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowMobileMenu(false);
                      setShowCastDrawer(true);
                    }}
                    className="w-full px-3 py-2 rounded-lg text-left text-xs font-medium text-[#2d2823] hover:bg-[#f4eee6] flex items-center justify-between transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-md bg-[#f4eee6] flex items-center justify-center text-[#7a282f]">
                        <Users className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <p className="font-semibold">Dramatis Personae</p>
                        <p className="text-[10px] text-[#8c8275]">View & Direct Characters</p>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 bg-[#f0e9df] text-[#4a4239] rounded-full text-[10px] font-bold">
                      {book.characters.length}
                    </span>
                  </button>
                </div>

                <div className="pt-1.5 mt-1 border-t border-[#f0e9df] px-2 space-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      setShowMobileMenu(false);
                      onNewChapter();
                    }}
                    className="w-full px-2.5 py-1.5 text-left text-[11px] text-[#7a282f] hover:bg-[#f4eee6] rounded-md flex items-center gap-1.5"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Conceive Next Chapter</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowMobileMenu(false);
                      onBackToLibrary();
                    }}
                    className="w-full px-2.5 py-1.5 text-left text-[11px] text-[#6e655b] hover:bg-[#f4eee6] rounded-md flex items-center gap-1.5"
                  >
                    <ArrowLeft className="w-3 h-3" />
                    <span>Return to Library</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* API Warning / Key Depleted Notice Banner */}
      {apiWarning && (
        <div className="bg-[#fff8e6] border-b border-[#f3d99f] px-4 sm:px-6 py-2.5 text-xs animate-fade-in">
          <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[#7c5e10]">
              <AlertCircle className="w-4 h-4 text-[#d97706] shrink-0" />
              <span>{apiWarning}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowApiKeyModal(true)}
                className="px-2.5 py-1 bg-[#d97706] hover:bg-[#b45309] text-white rounded text-[11px] font-medium transition-colors shadow-2xs"
              >
                Configure Key
              </button>
              <button
                type="button"
                onClick={() => setApiWarning(null)}
                className="p-1 text-[#a17822] hover:text-[#5a4209] transition-colors"
                title="Dismiss notice"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Book Synopsis & Atmosphere Banner (Collapsible) */}
      {showBookInfo && (
        <div className="bg-[#f2ede4] border-b border-[#dfd6c8] px-4 sm:px-6 py-3 text-xs">
          <div className="max-w-4xl mx-auto flex items-start justify-between gap-4">
            <div className="space-y-1.5 flex-1 min-w-0">
              <p className="font-semibold text-[#24211e]">
                {book.title} — {book.subtitle || 'A Living Literary Tale'}
              </p>
              {book.setting && (
                <p className="text-[#645c52]">
                  <span className="font-medium text-[#24211e]">Setting:</span> {book.setting}
                </p>
              )}
              {book.synopsis && (
                <p className="text-[#645c52]">
                  <span className="font-medium text-[#24211e]">Synopsis:</span> {book.synopsis}
                </p>
              )}
              {book.loreNotes && (
                <p className="text-[#645c52] bg-[#ffffff]/60 p-2 rounded border border-[#ded5c8]">
                  <span className="font-medium text-[#7a282f]">World Lore & Rules:</span>{' '}
                  <span className="font-serif-book whitespace-pre-wrap">{book.loreNotes}</span>
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowBookInfo(false);
                  setShowDirectorDesk(true);
                }}
                className="px-2.5 py-1 bg-[#7a282f] text-[#fbf9f5] rounded text-[11px] hover:bg-[#632026] flex items-center gap-1 shadow-2xs"
              >
                <Sparkles className="w-3 h-3 text-[#f5d9aa]" />
                <span>Direct with AI</span>
              </button>
              <button
                type="button"
                onClick={onEditBookDetails}
                className="px-2 py-1 bg-[#ffffff] border border-[#d8cfc4] rounded text-[11px] hover:bg-[#eae1d2]"
              >
                Edit Volume
              </button>
              <button
                type="button"
                onClick={() => setShowBookInfo(false)}
                className="text-[#8c8275] hover:text-[#24211e]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification for Dynamically Discovered Characters */}
      {newCharNotification && (
        <div className="bg-[#2d4b3e] text-[#fbf9f5] px-4 py-2 text-xs text-center font-serif-book italic flex items-center justify-center gap-2 sticky top-[57px] z-20 shadow-md animate-fade-in">
          <span>{newCharNotification}</span>
          <button
            type="button"
            onClick={() => setNewCharNotification(null)}
            className="text-white/80 hover:text-white"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Main Layout: Reading Page & Optional Dramatis Personae Side Drawer */}
      <div className="flex-1 flex max-w-5xl mx-auto w-full relative min-h-0 overflow-hidden">
        {/* The Reading Page Column (Scrollable Messages + Attached Bottom Composer) */}
        <div className="flex-1 flex flex-col h-full min-h-0 min-w-0">
          {/* Scrollable Messages Container */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-8 space-y-8 scroll-smooth">
            {/* Chapter Opening Header */}
            <div className="text-center mb-10 pb-6 border-b border-[#eae3d6]">
              <span className="text-[11px] uppercase tracking-widest font-semibold text-[#8c8275] block mb-1">
                Volume {book.title}
              </span>
              <h2 className="font-display-book text-2xl text-[#1e1c1a]">
                {activeChapter.title}
              </h2>
              <div className="w-12 h-0.5 bg-[#7a282f] mx-auto mt-3 mb-2 opacity-60" />
              <p className="text-xs text-[#7e766c] font-serif-book italic">
                Characters live within this book. Mention or introduce anyone anytime.
              </p>
            </div>

            {/* Messages Flow */}
            <div className="space-y-8">
              {activeChapter.messages.map((msg, index) => {
                const isAssistant = msg.role === 'assistant';
                const isEditing = editingMsgId === msg.id;

                return (
                  <div
                    key={msg.id}
                    className={`group relative transition-all ${
                      isAssistant
                        ? 'pl-2 sm:pl-4 border-l-2 border-[#d8cfc4] hover:border-[#7a282f]'
                        : 'bg-[#f4eee6]/70 p-4 rounded-lg border border-[#e5dcd0]'
                    }`}
                  >
                    {/* Speaker Label / Role Indicator */}
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] uppercase tracking-wider font-semibold">
                        {isAssistant ? (
                          <span className="text-[#7a282f] font-serif-book italic font-normal flex items-center gap-1.5">
                            <BookOpen className="w-3.5 h-3.5 text-[#7a282f]" />
                            <span>The Narrator · Living Story</span>
                          </span>
                        ) : (
                          <span className="text-[#4a4239] font-medium flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-[#b7791f]" />
                            <span>Your Story Idea / Direction</span>
                          </span>
                        )}
                      </span>
                    </div>

                    {/* Message Content or Edit Input */}
                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          rows={4}
                          value={editInput}
                          onChange={(e) => setEditInput(e.target.value)}
                          className="w-full p-2.5 bg-[#ffffff] border border-[#d8cfc4] rounded text-sm text-[#24211e] font-serif-book leading-relaxed focus:outline-none focus:ring-1 focus:ring-[#7a282f]"
                        />
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingMsgId(null)}
                            className="px-2.5 py-1 text-xs text-[#6e655b] hover:bg-[#ede6d9] rounded"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleSaveEdit}
                            className="px-3 py-1 text-xs bg-[#7a282f] text-[#fbf9f5] rounded hover:bg-[#632026]"
                          >
                            Save Changes
                          </button>
                        </div>
                      </div>
                    ) : isAssistant ? (
                      <BookText content={msg.content} />
                    ) : (
                      <div className="text-sm sm:text-base font-serif-book text-[#24211e] italic leading-relaxed">
                        &ldquo;{msg.content}&rdquo;
                      </div>
                    )}

                    {/* Action Controls below Output */}
                    {!isEditing && (
                      <div className="mt-3 pt-2 flex items-center justify-end gap-1.5 text-xs text-[#8c8275] border-t border-[#ede6d9]/60 opacity-80 group-hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        {isAssistant && (
                          <>
                            <button
                              type="button"
                              disabled={rerollingMsgId === msg.id}
                              onClick={() => handleQuickReroll(msg)}
                              className="px-2 py-1 hover:text-[#7a282f] rounded hover:bg-[#ede6d9] flex items-center gap-1.5 text-[11px] font-sans-ui text-[#6e655b] border border-transparent hover:border-[#ded5c8] transition-colors disabled:opacity-50"
                              title="Quick reroll of this passage"
                            >
                              <RotateCw className={`w-3 h-3 text-[#7a282f] ${rerollingMsgId === msg.id ? 'animate-spin' : ''}`} />
                              <span>{rerollingMsgId === msg.id ? 'Rerolling...' : 'Reroll'}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setRerollMessage(msg)}
                              className="px-2 py-1 hover:text-[#b7791f] rounded hover:bg-[#ede6d9] flex items-center gap-1.5 text-[11px] font-sans-ui text-[#6e655b] border border-transparent hover:border-[#ded5c8] transition-colors"
                              title="Direct or give specific instructions for this passage"
                            >
                              <Wand2 className="w-3 h-3 text-[#b7791f]" />
                              <span>Direct</span>
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          onClick={() => handleCopy(msg.id, msg.content)}
                          className="px-2 py-1 hover:text-[#24211e] rounded hover:bg-[#ede6d9] flex items-center gap-1.5 text-[11px] font-sans-ui transition-colors"
                          title="Copy text"
                        >
                          {copiedMsgId === msg.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-[#2d4b3e]" />
                              <span className="text-[#2d4b3e]">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleStartEdit(msg)}
                          className="px-2 py-1 hover:text-[#24211e] rounded hover:bg-[#ede6d9] flex items-center gap-1.5 text-[11px] font-sans-ui transition-colors"
                          title="Edit text"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </button>

                        {index > 0 && (
                          <button
                            type="button"
                            onClick={() => handleDeleteMessage(msg.id)}
                            className="p-1 hover:text-[#9b2c2c] rounded hover:bg-[#ede6d9] transition-colors ml-1"
                            title="Delete passage"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Thinking / Loading Indicator */}
              {isLoading && (
                <div className="pl-4 border-l-2 border-[#7a282f] py-3 text-xs text-[#7a282f] font-serif-book italic flex items-center gap-2.5 bg-[#fbf5ee]/60 rounded-r-md">
                  <Feather className="w-4 h-4 text-[#7a282f] animate-bounce" />
                  <span>The narrator takes your idea and weaves it into the living prose...</span>
                </div>
              )}

              {/* Error Message */}
              {errorMessage && (
                <div className="p-3 bg-[#fff5f5] border border-[#fed7d7] rounded-md text-xs text-[#9b2c2c] flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold">Narrative Paused</p>
                    <p>{errorMessage}</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRegenerate}
                    className="px-2 py-1 bg-[#ffffff] border border-[#fed7d7] rounded hover:bg-[#fff0f0] font-medium"
                  >
                    Retry
                  </button>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Attached Bottom Input Bar (Docked below the reading pane) */}
          <div className="shrink-0 px-4 sm:px-8 pt-2.5 pb-3 sm:pb-4 bg-[#fbf9f5]/95 backdrop-blur-md border-t border-[#eae3d6] shadow-[0_-4px_20px_rgba(0,0,0,0.03)] z-20">
            {/* Top Action Bar: Story Sparks Dropdown & Director's Desk Perfectly Aligned */}
            <div className="mb-2 flex items-center justify-between gap-3 w-full">
              {/* Story Sparks Dropdown */}
              <div className="relative" ref={sparksDropdownRef}>
                <button
                  id="story-sparks-dropdown-btn"
                  type="button"
                  onClick={() => setShowSparksDropdown(!showSparksDropdown)}
                  className={`h-8 px-3 rounded-lg text-xs font-medium border inline-flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer ${
                    showSparksDropdown
                      ? 'bg-[#7a282f] text-[#fbf9f5] border-[#7a282f]'
                      : 'bg-[#ffffff] hover:bg-[#f4eee6] text-[#4a4239] border-[#d8cfc4]'
                  }`}
                  title="Choose a Story Spark to inspire a scene direction"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#b7791f] shrink-0" />
                  <span>Story Sparks</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform shrink-0 ${showSparksDropdown ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown Menu */}
                {showSparksDropdown && (
                  <div className="absolute left-0 bottom-full mb-1.5 w-80 sm:w-96 max-h-80 overflow-y-auto bg-[#ffffff] rounded-xl shadow-xl border border-[#ded5c8] py-2 z-40 text-xs animate-fade-in font-sans">
                    <div className="px-3.5 py-1.5 border-b border-[#f0e9df] bg-[#faf7f2] flex items-center justify-between">
                      <span className="font-semibold text-[#1e1c1a] flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-[#b7791f]" />
                        <span>Story Sparks & Plot Beats</span>
                      </span>
                      <span className="text-[10px] text-[#8c8275] font-serif-book italic">
                        Click to insert into idea box
                      </span>
                    </div>

                    <div className="p-2 space-y-3">
                      {STORY_SPARK_CATEGORIES.map((cat, cIdx) => (
                        <div key={cIdx} className="space-y-1">
                          <p className="px-1.5 text-[10px] uppercase font-bold tracking-wider text-[#8c8275]">
                            {cat.category}
                          </p>
                          <div className="space-y-0.5">
                            {cat.sparks.map((spark, sIdx) => (
                              <button
                                key={sIdx}
                                type="button"
                                onClick={() => handleSelectSpark(spark)}
                                className="w-full text-left px-2.5 py-1.5 rounded-md text-xs text-[#3d362e] hover:bg-[#f4eee6] hover:text-[#7a282f] transition-colors flex items-start gap-1.5"
                              >
                                <span className="text-[#b7791f] mt-0.5 shrink-0">•</span>
                                <span className="font-serif-book">{spark}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Director's Desk Button */}
              <div className="flex items-center gap-2">
                <button
                  id="open-director-desk-inline-btn"
                  type="button"
                  onClick={() => setShowDirectorDesk(true)}
                  className="h-8 px-3 rounded-lg text-xs font-medium border inline-flex items-center gap-1.5 transition-colors shadow-2xs bg-[#f4eee6] hover:bg-[#eae0d0] text-[#7a282f] border-[#dfd5c5] cursor-pointer"
                  title="Private conversation with the AI to adjust character relationships, lore, or book settings"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#7a282f] shrink-0" />
                  <span>Director's Desk</span>
                  {book.directorMessages && book.directorMessages.length > 0 && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#7a282f]" />
                  )}
                </button>
              </div>
            </div>

            {/* Writing Composer */}
            <div className="relative bg-[#ffffff] rounded-lg border border-[#d8cfc4] shadow-xs focus-within:border-[#7a282f] transition-all outline-none">
              <textarea
                ref={textareaRef}
                rows={1}
                value={inputMessage}
                onChange={handleTextareaChange}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="Give the Narrator an idea, action, or plot beat (e.g. 'Arthur notices someone listening outside', or describe what happens)..."
                className="w-full py-2.5 pl-3.5 pr-14 bg-transparent resize-none text-sm text-[#24211e] placeholder-[#a69c8f] font-serif-book leading-relaxed focus:outline-none outline-none ring-0 border-0 focus:ring-0 min-h-[56px] max-h-36"
              />

              {/* Action Buttons Column on the Right: Fix Grammar above Send Button */}
              <div className="absolute right-2.5 top-2.5 bottom-2.5 flex flex-col justify-between items-center gap-1 z-10">
                {/* Fix Grammar Icon Button (Small, like Send) */}
                <div className="relative group flex items-center justify-center">
                  <button
                    id="fix-grammar-btn"
                    type="button"
                    onClick={handleCorrectGrammar}
                    disabled={!inputMessage.trim() || isCorrectingGrammar}
                    className={`w-7 h-7 rounded-md flex items-center justify-center transition-all border outline-none focus:outline-none ${
                      grammarStatus === 'success'
                        ? 'bg-[#2d6a4f] text-[#ffffff] border-[#2d6a4f] shadow-2xs'
                        : grammarStatus === 'no-change'
                        ? 'bg-[#52796f] text-[#ffffff] border-[#52796f]'
                        : grammarStatus === 'error'
                        ? 'bg-[#9b2c2c] text-[#ffffff] border-[#9b2c2c]'
                        : inputMessage.trim() && !isCorrectingGrammar
                        ? 'bg-[#f4eee6] hover:bg-[#eae0d0] text-[#7a282f] hover:text-[#5c1c22] border-[#dfd5c5] shadow-2xs cursor-pointer'
                        : 'opacity-30 bg-[#faf7f2] text-[#a69c8f] border-[#e8dfd2] cursor-not-allowed'
                    }`}
                    title={
                      grammarStatus === 'success'
                        ? 'Grammar refined!'
                        : grammarStatus === 'no-change'
                        ? 'Already clear & correct'
                        : 'Fix grammar, typos & clarity'
                    }
                  >
                    {isCorrectingGrammar ? (
                      <Loader2 className="w-4 h-4 animate-spin text-[#7a282f]" />
                    ) : grammarStatus === 'success' || grammarStatus === 'no-change' ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <CheckCheck className="w-4 h-4 text-[#7a282f]" />
                    )}
                  </button>

                  {/* Status Tooltip / Badge - Only rendered when status is active (not idle) */}
                  {grammarStatus !== 'idle' && (
                    <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap px-2.5 py-1 rounded text-[10px] font-medium bg-[#1e1c1a] text-[#ffffff] shadow-md z-30 pointer-events-none animate-fade-in">
                      {grammarStatus === 'success' && '✓ Grammar refined'}
                      {grammarStatus === 'no-change' && '✓ Already clear & correct'}
                      {grammarStatus === 'error' && '! Could not check'}
                    </div>
                  )}
                </div>

                {/* Send Button */}
                <button
                  id="send-message-btn"
                  type="button"
                  onClick={() => handleSendMessage()}
                  disabled={!inputMessage.trim() || isLoading}
                  className="w-7 h-7 bg-[#7a282f] hover:bg-[#632026] disabled:opacity-30 text-[#fbf9f5] rounded-md transition-colors shadow-xs flex items-center justify-center cursor-pointer outline-none focus:outline-none"
                  title="Narrate & Bring Idea to Life (Enter)"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between mt-2 text-[11px] text-[#8c8275] font-serif-book">
              <span>Press Enter to send · Shift+Enter for new line</span>
              {activeChapter.messages.length > 1 && (
                <button
                  type="button"
                  onClick={handleRegenerate}
                  disabled={isLoading}
                  className="hover:text-[#24211e] flex items-center gap-1 underline cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Turn the page again (Regenerate)</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Dramatis Personae (Cast of Characters) Side Drawer */}
        {showCastDrawer && (
          <>
            {/* Mobile Backdrop Overlay */}
            <div
              className="fixed inset-0 bg-black/40 z-40 md:hidden backdrop-blur-2xs animate-fade-in"
              onClick={() => setShowCastDrawer(false)}
            />

            <aside className="fixed inset-y-0 right-0 z-50 w-80 max-w-[85vw] border-l border-[#eae3d6] bg-[#fdfbf7] p-5 flex flex-col shrink-0 shadow-2xl md:static md:w-80 md:z-auto md:shadow-none animate-slide-in">
              <div className="flex items-center justify-between pb-3 border-b border-[#eae3d6] mb-4">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#7a282f]" />
                  <h3 className="font-display-book text-sm font-bold text-[#1e1c1a]">
                    Dramatis Personae
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCastDrawer(false)}
                  className="text-[#8c8275] hover:text-[#24211e]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

            <p className="text-[11px] text-[#7e766c] font-serif-book italic mb-3 leading-relaxed">
              Characters live within this book. They emerge automatically whenever you or the narrator mentions them in the story.
            </p>

            {/* Private AI Consultation Banner */}
            <div className="mb-4 p-2.5 rounded-lg bg-[#f5efe4] border border-[#e8dfd0] text-xs space-y-1.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#1e1c1a] flex items-center gap-1.5 text-xs">
                  <Sparkles className="w-3.5 h-3.5 text-[#7a282f]" />
                  <span>Direct Relationships</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setShowCastDrawer(false);
                    setShowDirectorDesk(true);
                  }}
                  className="px-2 py-0.5 rounded bg-[#7a282f] text-[#fbf9f5] hover:bg-[#632026] text-[10px] font-medium transition-colors"
                >
                  Consult AI
                </button>
              </div>
              <p className="text-[11px] text-[#635b51] font-serif-book leading-tight">
                Want characters to be best friends, rivals, or relatives? Talk to the Director to update their descriptions.
              </p>
            </div>

            {/* List of Characters In This Book */}
            <div className="space-y-3 flex-1 overflow-y-auto pr-1">
              {book.characters.length === 0 ? (
                <div className="text-center py-8 bg-[#f4eee6]/60 rounded border border-dashed border-[#ded5c8]">
                  <p className="text-xs text-[#8c8275] italic font-serif-book">
                    No characters recorded yet. Mention someone in the story or add them below.
                  </p>
                </div>
              ) : (
                book.characters.map((char) => (
                  <div
                    key={char.id}
                    className="p-3 bg-[#ffffff] rounded border border-[#e5dcd0] hover:border-[#cbbfb0] shadow-2xs transition-all text-xs"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div>
                        <h4 className="font-semibold text-[#1e1c1a]">{char.name}</h4>
                        <p className="text-[11px] text-[#7a282f] italic font-serif-book">
                          {char.role}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveCharacter(char.id)}
                        className="text-[#a69c8f] hover:text-[#9b2c2c] p-0.5"
                        title="Remove character"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Character Voice Tone Register */}
                    <div className="mb-2 flex items-center gap-1.5">
                      <span className="text-[10px] text-[#8c8275] uppercase tracking-wider font-semibold">Voice:</span>
                      <select
                        value={char.voiceTone || 'Casual & Conversational'}
                        onChange={(e) => handleUpdateCharacterTone(char.id, e.target.value)}
                        className="text-[11px] bg-[#f5efe4] text-[#4a4239] border border-[#e0d6c7] rounded px-1.5 py-0.5 font-medium cursor-pointer hover:border-[#b8aa96] focus:outline-none flex-1 truncate"
                        title="Change dialogue tone / voice register for this character"
                      >
                        {VOICE_TONE_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.label}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <p className="text-[11px] text-[#574f46] leading-relaxed mb-2.5">
                      {char.description}
                    </p>

                    <button
                      type="button"
                      onClick={() => handleAddressCharacter(char.name)}
                      className="w-full py-1 bg-[#f4eee6] hover:bg-[#eae1d2] text-[#4a4239] rounded text-[11px] font-medium flex items-center justify-center gap-1 transition-colors"
                    >
                      <CornerDownLeft className="w-3 h-3" />
                      <span>Address in Story</span>
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Manual Introduce Character section */}
            <div className="pt-3 border-t border-[#eae3d6] mt-3">
              {isAddingManualChar ? (
                <form onSubmit={handleAddManualCharacter} className="space-y-2 text-xs">
                  <span className="font-semibold text-[#24211e] block">
                    Introduce Character
                  </span>
                  <input
                    type="text"
                    required
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="Character Name"
                    className="w-full px-2.5 py-1.5 bg-[#ffffff] border border-[#d8cfc4] rounded text-xs"
                  />
                  <input
                    type="text"
                    value={manualRole}
                    onChange={(e) => setManualRole(e.target.value)}
                    placeholder="Role / Title"
                    className="w-full px-2.5 py-1.5 bg-[#ffffff] border border-[#d8cfc4] rounded text-xs"
                  />
                  <div className="space-y-0.5">
                    <label className="text-[10px] text-[#7e766c] uppercase tracking-wider font-semibold block">
                      Dialogue & Voice Tone
                    </label>
                    <select
                      value={manualVoiceTone}
                      onChange={(e) => setManualVoiceTone(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-[#ffffff] border border-[#d8cfc4] rounded text-xs text-[#24211e]"
                    >
                      {VOICE_TONE_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.label}>
                          {opt.label} ({opt.description.split(',')[0]})
                        </option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    rows={2}
                    value={manualDesc}
                    onChange={(e) => setManualDesc(e.target.value)}
                    placeholder="Brief description or persona..."
                    className="w-full px-2.5 py-1.5 bg-[#ffffff] border border-[#d8cfc4] rounded text-xs"
                  />
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsAddingManualChar(false)}
                      className="px-2 py-1 text-[#6e655b]"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-1 bg-[#7a282f] text-[#fbf9f5] rounded hover:bg-[#632026]"
                    >
                      Save to Cast
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsAddingManualChar(true)}
                  className="w-full py-2 bg-[#f4eee6] hover:bg-[#eae1d2] text-[#24211e] rounded text-xs font-medium border border-[#ded5c8] flex items-center justify-center gap-1.5 transition-colors"
                >
                  <UserPlus className="w-3.5 h-3.5 text-[#7a282f]" />
                  <span>+ Introduce Character</span>
                </button>
              )}
            </div>
          </aside>
        </>
      )}
      </div>

      {/* Private AI Director's Desk */}
      <DirectorDesk
        isOpen={showDirectorDesk}
        book={book}
        onClose={() => setShowDirectorDesk(false)}
        onUpdateBook={onUpdateBook}
        onOpenCastDrawer={() => setShowCastDrawer(true)}
        onOpenBookInfo={() => setShowBookInfoModal(true)}
        pendingRerollContext={pendingDirectorReroll}
        onClearRerollContext={() => setPendingDirectorReroll(null)}
      />

      {/* Reroll / Direct Passage Modal */}
      {rerollMessage && (
        <RerollModal
          isOpen={true}
          message={rerollMessage}
          book={book}
          chapterTitle={activeChapter.title}
          onClose={() => setRerollMessage(null)}
          onRewriteSubmitted={handleRerollRewrite}
          onConsultDirector={handleConsultDirectorForReroll}
        />
      )}

      {/* Book Information & Settings Modal */}
      <BookInfoModal
        isOpen={showBookInfoModal}
        book={book}
        onClose={() => setShowBookInfoModal(false)}
        onEditSettings={onEditBookDetails}
        onOpenDirectorDesk={() => setShowDirectorDesk(true)}
        onOpenCastDrawer={() => setShowCastDrawer(true)}
      />

      {/* Google Gemini API Key Settings & Diagnostic Modal */}
      <ApiKeyModal
        isOpen={showApiKeyModal}
        onClose={() => setShowApiKeyModal(false)}
        onKeyUpdated={(hasKey) => {
          if (hasKey) setApiWarning(null);
        }}
      />
    </div>
  );
};
