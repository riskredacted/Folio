import React, { useState, useEffect } from 'react';
import { Book, BookCharacter, VOICE_TONE_OPTIONS } from '../types';
import { safeFetchJson } from '../lib/api';
import {
  X,
  BookOpen,
  Feather,
  Compass,
  Scroll,
  Sparkles,
  Shield,
  Coffee,
  Plus,
  Trash2,
  Users,
  Wand2,
  ArrowRight,
  Sliders,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface BookModalProps {
  isOpen: boolean;
  bookToEdit?: Book | null;
  onClose: () => void;
  onSave: (book: Book, openImmediately?: boolean) => void;
}

const COVER_COLORS = [
  { name: 'Antique Burgundy', hex: '#7a282f' },
  { name: 'Nautical Navy', hex: '#1e3a5f' },
  { name: 'Spruce Green', hex: '#2d4b3e' },
  { name: 'Ink Charcoal', hex: '#2c2c2e' },
  { name: 'Rich Mahogany', hex: '#633924' },
  { name: 'Deep Plum', hex: '#44337a' },
  { name: 'Gilded Ochre', hex: '#744210' },
];

const AVAILABLE_ICONS = [
  { name: 'BookOpen', label: 'Tome', Icon: BookOpen },
  { name: 'Feather', label: 'Quill', Icon: Feather },
  { name: 'Compass', label: 'Compass', Icon: Compass },
  { name: 'Scroll', label: 'Scroll', Icon: Scroll },
  { name: 'Sparkles', label: 'Mystery', Icon: Sparkles },
  { name: 'Shield', label: 'Garrison', Icon: Shield },
  { name: 'Coffee', label: 'Salon', Icon: Coffee },
];

const IDEA_SPARKS = [
  'A forgotten Victorian lighthouse where strange radio ciphers are picked up in the fog.',
  'An antiquarian bookshop in Prague hiding a subterranean vault of forbidden alchemy.',
  'A stranded crew on a derelict research satellite drifting near an uncharted purple nebula.',
  'An alpine winter estate where exiled diplomats and masked couriers gather during a blizzard.',
  'A cozy midnight tea salon in old Kyoto that only opens during torrential rainstorms.',
  'A steampunk expedition trapped under the polar ice cap discovering a brass machine.',
];

export const BookModal: React.FC<BookModalProps> = ({
  isOpen,
  bookToEdit,
  onClose,
  onSave,
}) => {
  // Modal mode: 'idea' (inputting idea), 'generating' (AI working), 'preview' (review generated book), 'customize' (full field editor)
  const [mode, setMode] = useState<'idea' | 'generating' | 'preview' | 'customize'>('idea');

  // Idea input state
  const [ideaText, setIdeaText] = useState('');
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generationNotice, setGenerationNotice] = useState<string | null>(null);

  // Form fields for the book
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [synopsis, setSynopsis] = useState('');
  const [setting, setSetting] = useState('');
  const [prologue, setPrologue] = useState('');
  const [coverColor, setCoverColor] = useState(COVER_COLORS[0].hex);
  const [coverIcon, setCoverIcon] = useState('BookOpen');
  const [dialogueTone, setDialogueTone] = useState('Simple, Natural & Conversational');
  const [characters, setCharacters] = useState<
    Array<{ name: string; role: string; description: string; voiceTone?: string }>
  >([]);
  const [loreNotes, setLoreNotes] = useState('');

  // Manual character field inside customize mode
  const [newCharName, setNewCharName] = useState('');
  const [newCharRole, setNewCharRole] = useState('');
  const [newCharVoiceTone, setNewCharVoiceTone] = useState<string>('Casual & Conversational');
  const [newCharDesc, setNewCharDesc] = useState('');

  // Reset or populate modal whenever isOpen or bookToEdit changes
  useEffect(() => {
    if (!isOpen) return;

    if (bookToEdit) {
      // Editing existing book -> directly go to customize mode
      setMode('customize');
      setTitle(bookToEdit.title);
      setSubtitle(bookToEdit.subtitle || '');
      setSynopsis(bookToEdit.synopsis || '');
      setSetting(bookToEdit.setting || '');
      setDialogueTone(bookToEdit.dialogueTone || 'Simple, Natural & Conversational');
      setPrologue(bookToEdit.prologue || '');
      setCoverColor(bookToEdit.coverColor || COVER_COLORS[0].hex);
      setCoverIcon(bookToEdit.coverIcon || 'BookOpen');
      setCharacters(
        bookToEdit.characters.map((c) => ({
          name: c.name,
          role: c.role,
          voiceTone: c.voiceTone || 'Casual & Conversational',
          description: c.description,
        }))
      );
      setLoreNotes(bookToEdit.loreNotes || '');
    } else {
      // Creating a new book -> default to the Idea pop-up
      setMode('idea');
      setIdeaText('');
      setGenerateError(null);
      setGenerationNotice(null);
      setTitle('');
      setSubtitle('');
      setSynopsis('');
      setSetting('');
      setDialogueTone('Simple, Natural & Conversational');
      setLoreNotes('');
      setPrologue('');
      setCoverColor(COVER_COLORS[0].hex);
      setCoverIcon('BookOpen');
      setCharacters([]);
    }
    setNewCharName('');
    setNewCharRole('');
    setNewCharVoiceTone('Casual & Conversational');
    setNewCharDesc('');
  }, [bookToEdit, isOpen]);

  if (!isOpen) return null;

  // Auto-generate book from idea via server endpoint
  const handleGenerateBook = async () => {
    if (!ideaText.trim()) return;

    setMode('generating');
    setGenerateError(null);
    setGenerationNotice(null);

    try {
      const data = await safeFetchJson<{ book: any; fallbackUsed?: boolean; note?: string }>('/api/generate-book', {
        method: 'POST',
        body: JSON.stringify({ idea: ideaText.trim() }),
      });

      const genBook = data.book || {};

      setTitle(genBook.title || 'The Unwritten Folio');
      setSubtitle(genBook.subtitle || 'A Tale Conceived in Silence');
      setSetting(genBook.setting || '');
      setSynopsis(genBook.synopsis || ideaText.trim());
      setPrologue(genBook.prologue || '');
      setCoverColor(genBook.coverColor || COVER_COLORS[0].hex);
      setCoverIcon(genBook.coverIcon || 'BookOpen');
      setCharacters(
        Array.isArray(genBook.characters)
          ? genBook.characters.map((c: { name: string; role?: string; description?: string; voiceTone?: string }) => ({
              name: c.name || 'Unknown Stranger',
              role: c.role || 'Dramatis Persona',
              voiceTone: c.voiceTone || genBook.dialogueTone || 'Casual & Conversational',
              description: c.description || 'Appeared in the story.',
            }))
          : []
      );
      setGenerationNotice(data.fallbackUsed
        ? data.note || 'Gemini was unavailable, so this draft was built directly from your premise.'
        : null
      );

      setMode('preview');
    } catch (err) {
      console.error('Failed to auto-generate book:', err);
      setGenerateError(
        err instanceof Error
          ? err.message
          : 'Unable to auto-generate book. Please check your Gemini API key.'
      );
      setMode('idea');
    }
  };

  // Add a manual character in customize mode
  const handleAddCharacter = () => {
    if (!newCharName.trim()) return;
    setCharacters((prev) => [
      ...prev,
      {
        name: newCharName.trim(),
        role: newCharRole.trim() || 'Dramatis Persona',
        voiceTone: newCharVoiceTone.trim() || 'Casual & Conversational',
        description: newCharDesc.trim() || 'A character residing in this book.',
      },
    ]);
    setNewCharName('');
    setNewCharRole('');
    setNewCharVoiceTone('Casual & Conversational');
    setNewCharDesc('');
  };

  const handleRemoveCharacter = (idx: number) => {
    setCharacters((prev) => prev.filter((_, i) => i !== idx));
  };

  // Save book (either directly from preview or after customizing)
  const handleSaveAndFinalize = (openImmediately: boolean) => {
    if (!title.trim()) return;

    const bookId = bookToEdit ? bookToEdit.id : `book-${Date.now()}`;
    const defaultPrologue =
      prologue.trim() ||
      `*The heavy leather binding opens, revealing Chapter I of "${title.trim()}". The silence of the room deepens as the story begins.*`;

    const bookCharacters: BookCharacter[] = characters.map((c, i) => ({
      id: `char-${Date.now()}-${i}`,
      name: c.name,
      role: c.role,
      voiceTone: c.voiceTone || 'Casual & Conversational',
      description: c.description,
      color: coverColor,
      createdAt: Date.now() + i,
    }));

    // If editing, preserve existing chapters; if new, initialize Chapter I
    const bookChapters =
      bookToEdit?.chapters && bookToEdit.chapters.length > 0
        ? bookToEdit.chapters
        : [
            {
              id: `chap-${Date.now()}`,
              bookId,
              title: 'Chapter I: The Opening Passage',
              messages: [
                {
                  id: `msg-${Date.now()}`,
                  role: 'assistant' as const,
                  content: defaultPrologue,
                  timestamp: Date.now(),
                },
              ],
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ];

    const finalizedBook: Book = {
      id: bookId,
      title: title.trim(),
      subtitle: subtitle.trim(),
      synopsis: synopsis.trim(),
      setting: setting.trim(),
      dialogueTone: dialogueTone.trim() || undefined,
      loreNotes: loreNotes.trim() || undefined,
      canonFacts: bookToEdit?.canonFacts,
      directorMessages: bookToEdit?.directorMessages,
      prologue: defaultPrologue,
      coverColor,
      coverIcon,
      characters: bookCharacters,
      chapters: bookChapters,
      createdAt: bookToEdit ? bookToEdit.createdAt : Date.now(),
      updatedAt: Date.now(),
      isPreset: bookToEdit?.isPreset || false,
    };

    onSave(finalizedBook, openImmediately);
    onClose();
  };

  const IconComp = AVAILABLE_ICONS.find((i) => i.name === coverIcon)?.Icon || BookOpen;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs">
      <div className="bg-[#fbf9f5] w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-lg shadow-2xl border border-[#d8cfc4] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#eae3d6] flex items-center justify-between sticky top-0 bg-[#fbf9f5] z-10">
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-sm flex items-center justify-center text-white shadow-2xs"
              style={{ backgroundColor: coverColor }}
            >
              <IconComp className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display-book text-xl text-[#24211e]">
                {bookToEdit
                  ? 'Customize Book Volume'
                  : mode === 'preview'
                  ? 'Volume Conceived'
                  : mode === 'customize'
                  ? 'Customize Book Details'
                  : 'Conceive a New Book'}
              </h2>
              <p className="text-xs text-[#7e766c] font-serif-book italic mt-0.5">
                {bookToEdit || mode === 'customize'
                  ? 'Fine-tune the world, setting, prologue, and characters'
                  : 'Enter your idea — the narrator will auto-generate the book for you'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {mode === 'idea' && !bookToEdit && (
              <button
                type="button"
                onClick={() => setMode('customize')}
                className="text-xs text-[#7a282f] hover:underline flex items-center gap-1 font-medium"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Manual Setup</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-[#8c8275] hover:text-[#24211e] hover:bg-[#ede6d9] rounded transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* MODE 1: IDEA INPUT (The Auto-Generate Pop-up requested by user)           */}
        {/* ========================================================================= */}
        {mode === 'idea' && (
          <div className="p-6 space-y-6">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#574f46] mb-2 flex items-center gap-1.5">
                <Wand2 className="w-4 h-4 text-[#7a282f]" />
                <span>What is your story idea?</span>
              </label>
              <p className="text-xs text-[#6e655b] font-serif-book mb-3 leading-relaxed">
                Describe a concept, premise, setting, or conflict. The narrator will take your seed and auto-generate the complete book, title, atmosphere, opening chapter, and cast of characters.
              </p>
              <textarea
                id="book-idea-textarea"
                rows={4}
                value={ideaText}
                onChange={(e) => setIdeaText(e.target.value)}
                placeholder="e.g. An antiquarian bookshop in Victorian London where strange documents surface from the subterranean vaults, or a stranded crew on an observation deck listening for cosmic signals..."
                className="w-full p-3.5 bg-[#ffffff] border border-[#d8cfc4] rounded-md text-sm text-[#24211e] placeholder-[#a69c8f] focus:outline-none focus:ring-1 focus:ring-[#7a282f] focus:border-[#7a282f] font-serif-book leading-relaxed shadow-2xs"
                autoFocus
              />
            </div>

            {/* Inspiration Idea Chips */}
            <div>
              <span className="text-[11px] font-semibold text-[#8c8275] uppercase tracking-wider block mb-2">
                Need inspiration? Click a premise:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {IDEA_SPARKS.map((spark, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setIdeaText(spark)}
                    className="text-left px-2.5 py-1.5 rounded bg-[#f4eee6] hover:bg-[#eae1d2] text-[#4a4239] hover:text-[#1e1c1a] border border-[#ded5c8] text-xs transition-colors"
                  >
                    ✦ {spark}
                  </button>
                ))}
              </div>
            </div>

            {/* Error banner if generation failed */}
            {generateError && (
              <div className="p-3 bg-[#fff5f5] border border-[#fed7d7] rounded text-xs text-[#9b2c2c] flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Auto-generation paused</p>
                  <p>{generateError}</p>
                </div>
              </div>
            )}

            {/* Action Bar */}
            <div className="pt-4 border-t border-[#eae3d6] flex items-center justify-between">
              <span className="text-[11px] text-[#7e766c] font-serif-book italic">
                You can customize all details anytime after generation
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium text-[#574f46] hover:bg-[#ede6d9] rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  id="generate-book-btn"
                  type="button"
                  onClick={handleGenerateBook}
                  disabled={!ideaText.trim()}
                  className="px-5 py-2.5 text-xs font-medium bg-[#7a282f] hover:bg-[#632026] disabled:opacity-45 text-[#fbf9f5] rounded-md shadow-xs transition-all flex items-center gap-2"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Auto-Generate Book</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* MODE 2: GENERATING ANIMATION                                              */}
        {/* ========================================================================= */}
        {mode === 'generating' && (
          <div className="p-12 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-[#f4eee6] border border-[#ded5c8] flex items-center justify-center mx-auto text-[#7a282f] animate-pulse">
              <Feather className="w-6 h-6 animate-bounce" />
            </div>
            <div>
              <h3 className="font-display-book text-lg text-[#1e1c1a] mb-1">
                Conceiving the Volume
              </h3>
              <p className="text-xs text-[#7e766c] font-serif-book italic max-w-md mx-auto leading-relaxed">
                The narrator is binding the book, weaving the atmosphere, naming the characters, and penning Chapter I from your idea...
              </p>
            </div>
            <div className="w-32 h-1 bg-[#eae3d6] rounded-full mx-auto overflow-hidden">
              <div className="w-full h-full bg-[#7a282f] animate-pulse" />
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* MODE 3: PREVIEW GENERATED BOOK                                            */}
        {/* ========================================================================= */}
        {mode === 'preview' && (
          <div className="p-6 space-y-5">
            <div className={`flex items-center gap-2 text-xs font-medium p-2.5 rounded border ${
              generationNotice
                ? 'text-[#744210] bg-[#fffaf0] border-[#e9d8a6]'
                : 'text-[#2d4b3e] bg-[#edf7ed] border-[#c3e6cb]'
            }`}>
              {generationNotice ? (
                <AlertCircle className="w-4 h-4 text-[#744210] shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-[#2d4b3e] shrink-0" />
              )}
              <span>
                {generationNotice || 'Your book has been auto-generated! You can enter the story immediately or customize details first.'}
              </span>
            </div>

            {/* Generated Book Card Summary */}
            <div className="bg-[#ffffff] rounded-lg border border-[#e5dcd0] overflow-hidden shadow-xs">
              <div className="h-2 w-full" style={{ backgroundColor: coverColor }} />
              <div className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display-book text-xl font-bold text-[#1e1c1a]">
                      {title}
                    </h3>
                    {subtitle && (
                      <p className="text-xs text-[#7a282f] font-serif-book italic mt-0.5">
                        {subtitle}
                      </p>
                    )}
                  </div>
                  <div
                    className="w-8 h-8 rounded-sm flex items-center justify-center text-white shrink-0"
                    style={{ backgroundColor: coverColor }}
                  >
                    <IconComp className="w-4 h-4" />
                  </div>
                </div>

                {setting && (
                  <p className="text-xs text-[#574f46]">
                    <span className="font-semibold text-[#24211e]">Setting:</span> {setting}
                  </p>
                )}

                <p className="text-xs text-[#574f46] font-serif-book leading-relaxed">
                  <span className="font-semibold text-[#24211e]">Synopsis:</span> {synopsis}
                </p>

                {/* Generated Characters */}
                <div className="pt-2 border-t border-[#f0e9df]">
                  <span className="text-[11px] font-semibold text-[#8c8275] uppercase tracking-wider block mb-1.5 flex items-center gap-1">
                    <Users className="w-3.5 h-3.5 text-[#7a282f]" />
                    <span>Initial Cast Born into this Book ({characters.length})</span>
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {characters.map((c, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded bg-[#fbf9f5] border border-[#eae3d6] text-xs"
                      >
                        <span className="font-semibold text-[#1e1c1a]">{c.name}</span>
                        <span className="mx-1 text-[#a69c8f]">·</span>
                        <span className="italic text-[#7a282f] font-serif-book">{c.role}</span>
                        <p className="text-[11px] text-[#6e655b] mt-0.5 line-clamp-2">
                          {c.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Opening Prologue snippet */}
                {prologue && (
                  <div className="pt-2 border-t border-[#f0e9df]">
                    <span className="text-[11px] font-semibold text-[#8c8275] uppercase tracking-wider block mb-1">
                      Opening Passage (Chapter I):
                    </span>
                    <p className="text-xs text-[#574f46] font-serif-book italic line-clamp-3 bg-[#fdfbf7] p-2.5 rounded border border-[#f0e9df]">
                      {prologue}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Actions: Open directly or customize */}
            <div className="pt-3 border-t border-[#eae3d6] flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setMode('customize')}
                className="px-3.5 py-2 text-xs font-medium text-[#4a4239] hover:text-[#1e1c1a] hover:bg-[#ede6d9] rounded border border-[#d8cfc4] flex items-center gap-1.5 transition-colors"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Customize Book Details</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleSaveAndFinalize(false)}
                  className="px-3.5 py-2 text-xs font-medium text-[#574f46] hover:bg-[#ede6d9] rounded transition-colors"
                >
                  Save to Shelf
                </button>
                <button
                  id="open-generated-book-btn"
                  type="button"
                  onClick={() => handleSaveAndFinalize(true)}
                  className="px-5 py-2 text-xs font-medium bg-[#7a282f] hover:bg-[#632026] text-[#fbf9f5] rounded shadow-xs flex items-center gap-2 transition-colors"
                >
                  <span>Open Book & Enter Story</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* MODE 4: CUSTOMIZE BOOK (Full editor available anytime)                    */}
        {/* ========================================================================= */}
        {mode === 'customize' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSaveAndFinalize(!bookToEdit);
            }}
            className="p-6 space-y-5"
          >
            {/* Title & Subtitle */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#574f46] mb-1.5">
                  Book Title *
                </label>
                <input
                  id="book-modal-title"
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. The Midnight Archives"
                  className="w-full px-3 py-2 bg-[#ffffff] border border-[#d8cfc4] rounded-md text-sm text-[#24211e] placeholder-[#a69c8f] focus:outline-none focus:ring-1 focus:ring-[#7a282f] focus:border-[#7a282f]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#574f46] mb-1.5">
                  Subtitle / Genre
                </label>
                <input
                  id="book-modal-subtitle"
                  type="text"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="e.g. A Victorian Mystery of Forbidden Codices"
                  className="w-full px-3 py-2 bg-[#ffffff] border border-[#d8cfc4] rounded-md text-sm text-[#24211e] placeholder-[#a69c8f] focus:outline-none focus:ring-1 focus:ring-[#7a282f] focus:border-[#7a282f]"
                />
              </div>
            </div>

            {/* Setting & Atmosphere and Dialogue Tone */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#574f46] mb-1.5">
                  Setting, Era & Atmosphere
                </label>
                <input
                  id="book-modal-setting"
                  type="text"
                  value={setting}
                  onChange={(e) => setSetting(e.target.value)}
                  placeholder="e.g. London, autumn 1888. Rain-beaten antiquarian shop with crackling hearths."
                  className="w-full px-3 py-2 bg-[#ffffff] border border-[#d8cfc4] rounded-md text-sm text-[#24211e] placeholder-[#a69c8f] focus:outline-none focus:ring-1 focus:ring-[#7a282f] focus:border-[#7a282f]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#574f46] mb-1.5">
                  Overall Dialogue & Narrative Tone
                </label>
                <input
                  id="book-modal-dialogue-tone"
                  type="text"
                  value={dialogueTone}
                  onChange={(e) => setDialogueTone(e.target.value)}
                  placeholder="e.g. Simple, Natural & Conversational, or Casual & Direct"
                  className="w-full px-3 py-2 bg-[#ffffff] border border-[#d8cfc4] rounded-md text-sm text-[#24211e] placeholder-[#a69c8f] focus:outline-none focus:ring-1 focus:ring-[#7a282f] focus:border-[#7a282f]"
                />
              </div>
            </div>

            {/* Synopsis */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#574f46] mb-1.5">
                Premise & Synopsis
              </label>
              <textarea
                id="book-modal-synopsis"
                rows={2}
                value={synopsis}
                onChange={(e) => setSynopsis(e.target.value)}
                placeholder="Brief summary of the story's conflict, mystery, or world..."
                className="w-full px-3 py-2 bg-[#ffffff] border border-[#d8cfc4] rounded-md text-sm text-[#24211e] placeholder-[#a69c8f] focus:outline-none focus:ring-1 focus:ring-[#7a282f] focus:border-[#7a282f]"
              />
            </div>

            {/* World Lore & Story Directives */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#574f46]">
                  World Lore, Rules & Character Notes
                </label>
                <span className="text-[11px] text-[#7a282f] font-serif-book italic">
                  Informs the narrator during chat
                </span>
              </div>
              <textarea
                id="book-modal-lore-notes"
                rows={2}
                value={loreNotes}
                onChange={(e) => setLoreNotes(e.target.value)}
                placeholder="Key facts, character ties, or rules (e.g., 'William and Gabrielle are best friends in the same course', 'The clocktower rings only when someone disappears')..."
                className="w-full px-3 py-2 bg-[#ffffff] border border-[#d8cfc4] rounded-md text-sm text-[#24211e] placeholder-[#a69c8f] focus:outline-none focus:ring-1 focus:ring-[#7a282f] focus:border-[#7a282f] font-serif-book"
              />
            </div>

            {/* Opening Scene / Prologue */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#574f46]">
                  Opening Prologue / Chapter I Scene
                </label>
                <span className="text-[11px] text-[#8c8275] font-serif-book italic">
                  *asterisks* for action, &quot;quotes&quot; for dialogue
                </span>
              </div>
              <textarea
                id="book-modal-prologue"
                rows={4}
                value={prologue}
                onChange={(e) => setPrologue(e.target.value)}
                placeholder="*Rain taps rhythmically on the glass...* &quot;Come in,&quot; a voice calls out..."
                className="w-full px-3 py-2 bg-[#ffffff] border border-[#d8cfc4] rounded-md text-sm text-[#24211e] placeholder-[#a69c8f] focus:outline-none focus:ring-1 focus:ring-[#7a282f] focus:border-[#7a282f] font-serif-book leading-relaxed"
              />
            </div>

            {/* Leather Binding Color & Emblem */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[#eae3d6]">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#574f46] mb-2">
                  Book Cover Palette
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  {COVER_COLORS.map((col) => (
                    <button
                      key={col.hex}
                      type="button"
                      onClick={() => setCoverColor(col.hex)}
                      style={{ backgroundColor: col.hex }}
                      className={`w-7 h-7 rounded-full border-2 transition-transform ${
                        coverColor === col.hex
                          ? 'border-[#24211e] scale-110 shadow-xs'
                          : 'border-transparent hover:scale-105'
                      }`}
                      title={col.name}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#574f46] mb-2">
                  Book Emblem Seal
                </label>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {AVAILABLE_ICONS.map(({ name, label, Icon }) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setCoverIcon(name)}
                      className={`px-2 py-1 rounded text-xs flex items-center gap-1 border transition-colors ${
                        coverIcon === name
                          ? 'bg-[#24211e] text-[#fbf9f5] border-[#24211e]'
                          : 'bg-[#ffffff] text-[#574f46] border-[#d8cfc4] hover:bg-[#f2ede4]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Dramatis Personae (Characters in this book) */}
            <div className="pt-3 border-t border-[#eae3d6]">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#7a282f]" />
                  <label className="block text-xs font-semibold uppercase tracking-wider text-[#574f46]">
                    Dramatis Personae (Cast of Characters)
                  </label>
                </div>
                <span className="text-[11px] text-[#7e766c] italic font-serif-book">
                  Characters also emerge dynamically when mentioned in the story!
                </span>
              </div>

              {/* Characters list */}
              {characters.length > 0 ? (
                <div className="space-y-2 mb-3 max-h-40 overflow-y-auto pr-1">
                  {characters.map((char, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2 rounded bg-[#ffffff] border border-[#e5dcd0] text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-[#24211e]">{char.name}</span>
                          <span className="text-[#a69c8f]">·</span>
                          <span className="italic text-[#7a282f] font-serif-book">{char.role}</span>
                          {char.voiceTone && (
                            <span className="px-1.5 py-0.5 rounded bg-[#f5efe4] text-[#635b51] text-[10px] font-medium border border-[#ded5c8]">
                              Voice: {char.voiceTone}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#6e655b] mt-0.5 line-clamp-1">
                          {char.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveCharacter(idx)}
                        className="p-1 text-[#a69c8f] hover:text-[#9b2c2c] transition-colors"
                        title="Remove character from this book"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[#8c8275] italic font-serif-book py-1.5 mb-2">
                  No characters recorded yet. You or the narrator can mention any character anytime in the story.
                </p>
              )}

              {/* Quick Add Character input row */}
              <div className="p-2.5 rounded-md bg-[#f4eee6] border border-[#ded5c8] space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={newCharName}
                    onChange={(e) => setNewCharName(e.target.value)}
                    placeholder="Character name (e.g. Master Barnaby)"
                    className="px-2.5 py-1.5 bg-[#ffffff] border border-[#d8cfc4] rounded text-xs text-[#24211e] placeholder-[#a69c8f] focus:outline-none"
                  />
                  <input
                    type="text"
                    value={newCharRole}
                    onChange={(e) => setNewCharRole(e.target.value)}
                    placeholder="Role / Title (e.g. Harbor Master)"
                    className="px-2.5 py-1.5 bg-[#ffffff] border border-[#d8cfc4] rounded text-xs text-[#24211e] placeholder-[#a69c8f] focus:outline-none"
                  />
                  <select
                    value={newCharVoiceTone}
                    onChange={(e) => setNewCharVoiceTone(e.target.value)}
                    className="px-2 py-1.5 bg-[#ffffff] border border-[#d8cfc4] rounded text-xs text-[#24211e] focus:outline-none"
                    title="Dialogue tone for this character"
                  >
                    {VOICE_TONE_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.label}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newCharDesc}
                    onChange={(e) => setNewCharDesc(e.target.value)}
                    placeholder="Brief note on personality or position..."
                    className="flex-1 px-2.5 py-1.5 bg-[#ffffff] border border-[#d8cfc4] rounded text-xs text-[#24211e] placeholder-[#a69c8f] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddCharacter}
                    disabled={!newCharName.trim()}
                    className="px-3 py-1.5 bg-[#7a282f] hover:bg-[#632026] text-[#fbf9f5] rounded text-xs font-medium disabled:opacity-50 flex items-center gap-1 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="pt-4 border-t border-[#eae3d6] flex items-center justify-between">
              {!bookToEdit && (
                <button
                  type="button"
                  onClick={() => setMode('idea')}
                  className="text-xs text-[#7a282f] hover:underline"
                >
                  ← Back to Idea Generator
                </button>
              )}
              <div className="flex items-center gap-3 ml-auto">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium text-[#574f46] hover:bg-[#ede6d9] rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  id="book-modal-submit-btn"
                  type="submit"
                  className="px-5 py-2 text-xs font-medium bg-[#7a282f] hover:bg-[#632026] text-[#fbf9f5] rounded shadow-xs transition-colors"
                >
                  {bookToEdit ? 'Save Volume Changes' : 'Bind & Save Book'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
