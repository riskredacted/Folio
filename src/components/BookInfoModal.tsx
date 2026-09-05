import React from 'react';
import { Book } from '../types';
import {
  X,
  Settings,
  Sparkles,
  Users,
  Compass,
  Scroll,
  BookOpen,
  Edit3,
  Calendar,
  Layers,
  FileText,
  ShieldAlert,
  ChevronRight,
} from 'lucide-react';

interface BookInfoModalProps {
  isOpen: boolean;
  book: Book;
  onClose: () => void;
  onEditSettings: () => void;
  onOpenDirectorDesk?: () => void;
  onOpenCastDrawer?: () => void;
}

export const BookInfoModal: React.FC<BookInfoModalProps> = ({
  isOpen,
  book,
  onClose,
  onEditSettings,
  onOpenDirectorDesk,
  onOpenCastDrawer,
}) => {
  if (!isOpen) return null;

  const totalWords = book.chapters.reduce(
    (acc, ch) => acc + ch.messages.reduce((mAcc, m) => mAcc + m.content.split(/\s+/).length, 0),
    0
  );

  return (
    <div
      id="book-info-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="book-info-modal-dialog"
        className="bg-[#fbf9f5] w-full max-w-2xl rounded-xl shadow-2xl border border-[#ded5c8] flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-[#f5efe4] border-b border-[#e5dcce] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center text-white shadow-xs"
              style={{ backgroundColor: book.coverColor || '#7a282f' }}
            >
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display-book text-lg font-bold text-[#1e1c1a] leading-tight">
                  Book Information & Settings
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase bg-[#ded5c8] text-[#554c42]">
                  Volume
                </span>
              </div>
              <p className="text-xs text-[#6e655b] font-serif-book">
                Metadata, setting environment, world lore & cast configuration
              </p>
            </div>
          </div>

          <button
            id="close-book-info-modal-btn"
            type="button"
            onClick={onClose}
            className="p-1.5 text-[#6e655b] hover:text-[#1e1c1a] hover:bg-[#eae3d6] rounded-md transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Main Book Banner */}
          <div className="p-4 rounded-lg bg-[#ffffff] border border-[#e4dccd] shadow-2xs flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold tracking-wider text-[#8c8275]">
                Active Volume
              </span>
              <h3 className="font-display-book text-xl font-bold text-[#1e1c1a]">
                {book.title}
              </h3>
              <p className="text-xs text-[#7a282f] font-serif-book italic">
                {book.subtitle || 'A Living Literary Tale'}
              </p>
            </div>

            <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end shrink-0">
              <button
                id="edit-book-settings-btn"
                type="button"
                onClick={() => {
                  onClose();
                  onEditSettings();
                }}
                className="px-3 py-1.5 rounded-md bg-[#24211e] hover:bg-[#3d3834] text-[#fbf9f5] text-xs font-medium flex items-center gap-1.5 transition-colors shadow-2xs"
                title="Edit Title, Cover, Synopsis, Lore, and Characters"
              >
                <Edit3 className="w-3.5 h-3.5 text-[#e8c89b]" />
                <span>Edit Settings</span>
              </button>

              {onOpenDirectorDesk && (
                <button
                  id="consult-director-from-info-btn"
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenDirectorDesk();
                  }}
                  className="px-3 py-1.5 rounded-md bg-[#7a282f] hover:bg-[#632026] text-[#fbf9f5] text-xs font-medium flex items-center gap-1.5 transition-colors shadow-2xs"
                  title="Direct AI on relationships or world rules"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#f5d9aa]" />
                  <span>Direct AI</span>
                </button>
              )}
            </div>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-[#ffffff] border border-[#e4dccd] rounded-lg">
              <div className="flex items-center gap-1.5 text-[#8c8275] text-[11px] mb-1">
                <Layers className="w-3.5 h-3.5" />
                <span>Chapters</span>
              </div>
              <p className="text-sm font-bold text-[#1e1c1a]">{book.chapters.length}</p>
            </div>

            <div className="p-3 bg-[#ffffff] border border-[#e4dccd] rounded-lg">
              <div className="flex items-center gap-1.5 text-[#8c8275] text-[11px] mb-1">
                <Users className="w-3.5 h-3.5 text-[#7a282f]" />
                <span>Cast (Personae)</span>
              </div>
              <p className="text-sm font-bold text-[#1e1c1a]">{book.characters.length}</p>
            </div>

            <div className="p-3 bg-[#ffffff] border border-[#e4dccd] rounded-lg">
              <div className="flex items-center gap-1.5 text-[#8c8275] text-[11px] mb-1">
                <FileText className="w-3.5 h-3.5" />
                <span>Approx. Words</span>
              </div>
              <p className="text-sm font-bold text-[#1e1c1a]">{totalWords.toLocaleString()}</p>
            </div>

            <div className="p-3 bg-[#ffffff] border border-[#e4dccd] rounded-lg">
              <div className="flex items-center gap-1.5 text-[#8c8275] text-[11px] mb-1">
                <Calendar className="w-3.5 h-3.5" />
                <span>Last Updated</span>
              </div>
              <p className="text-xs font-medium text-[#1e1c1a]">
                {new Date(book.updatedAt).toLocaleDateString([], {
                  month: 'short',
                  day: 'numeric',
                })}
              </p>
            </div>
          </div>

          {/* Setting & Atmosphere */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#574f46]">
              <Compass className="w-3.5 h-3.5 text-[#7a282f]" />
              <span>Setting & Atmosphere</span>
            </div>
            <div className="p-3 bg-[#ffffff] rounded-lg border border-[#e4dccd] text-xs text-[#3b342c] font-serif-book leading-relaxed space-y-2">
              <div>
                {book.setting ? (
                  book.setting
                ) : (
                  <span className="text-[#9c9285] italic">
                    No specific setting provided yet. Click "Edit Settings" or ask the Director to define the world environment.
                  </span>
                )}
              </div>
              {book.dialogueTone && (
                <div className="pt-2 border-t border-[#f0eae0] flex items-center gap-1.5 text-[11px] text-[#7a282f] font-sans">
                  <span className="font-semibold uppercase tracking-wider text-[10px] text-[#8c8275]">Dialogue Tone:</span>
                  <span className="px-2 py-0.5 rounded bg-[#f5efe4] border border-[#e2d7c7] font-medium">{book.dialogueTone}</span>
                </div>
              )}
            </div>
          </div>

          {/* Synopsis & Premise */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#574f46]">
              <BookOpen className="w-3.5 h-3.5 text-[#1e3a5f]" />
              <span>Synopsis & Plot Premise</span>
            </div>
            <div className="p-3 bg-[#ffffff] rounded-lg border border-[#e4dccd] text-xs text-[#3b342c] font-serif-book leading-relaxed">
              {book.synopsis ? (
                book.synopsis
              ) : (
                <span className="text-[#9c9285] italic">
                  No synopsis recorded. You can add one anytime in Book Settings.
                </span>
              )}
            </div>
          </div>

          {/* World Lore, Rules & Character Directives */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#7a282f]">
                <Scroll className="w-3.5 h-3.5" />
                <span>World Lore, Rules & Directives</span>
              </div>
              <span className="text-[10px] text-[#8c8275] bg-[#eae2d3] px-2 py-0.5 rounded">
                Guides the Narrator
              </span>
            </div>
            <div className="p-3 bg-[#fdfaf5] rounded-lg border border-[#ded5c8] text-xs leading-relaxed">
              {book.loreNotes ? (
                <p className="font-serif-book whitespace-pre-wrap text-[#2c2621]">
                  {book.loreNotes}
                </p>
              ) : (
                <div className="text-xs text-[#7e7467] font-serif-book space-y-1.5">
                  <p className="italic">
                    No custom world lore or story rules defined yet.
                  </p>
                  <p className="text-[11px] text-[#9c9285]">
                    Tip: Open the <strong>Director's Desk</strong> to instruct the AI (e.g. <em>"William and Gabrielle are best friends in the same course"</em> or <em>"Only whispered words can open sealed tombs"</em>).
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Dramatis Personae Overview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#574f46]">
                <Users className="w-3.5 h-3.5 text-[#7a282f]" />
                <span>Dramatis Personae ({book.characters.length})</span>
              </div>
              {onOpenCastDrawer && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenCastDrawer();
                  }}
                  className="text-xs text-[#7a282f] hover:underline flex items-center gap-0.5"
                >
                  <span>Open Full Cast</span>
                  <ChevronRight className="w-3 h-3" />
                </button>
              )}
            </div>

            {book.characters.length === 0 ? (
              <div className="p-3 bg-[#ffffff] rounded-lg border border-[#e4dccd] text-xs text-[#9c9285] font-serif-book italic">
                No characters registered yet. Characters automatically emerge as they appear in the dialogue or can be added in Book Settings.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {book.characters.map((char) => (
                  <div
                    key={char.id}
                    className="p-2.5 rounded-lg bg-[#ffffff] border border-[#e4dccd] flex items-start gap-2.5 shadow-2xs"
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5"
                      style={{ backgroundColor: char.color || '#5a3d28' }}
                    >
                      {char.name[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-1">
                        <h4 className="text-xs font-semibold text-[#1e1c1a] truncate">
                          {char.name}
                        </h4>
                        <span className="text-[10px] text-[#7a282f] truncate shrink-0 font-medium">
                          {char.role}
                        </span>
                      </div>
                      {char.voiceTone && (
                        <div className="mt-0.5">
                          <span className="inline-block text-[9px] px-1.5 py-0.5 rounded bg-[#f5efe4] text-[#635b51] font-medium border border-[#ded5c8]">
                            Voice: {char.voiceTone}
                          </span>
                        </div>
                      )}
                      <p className="text-[11px] text-[#635b51] font-serif-book line-clamp-2 mt-0.5 leading-snug">
                        {char.description || 'Active dramatis persona.'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 bg-[#f5efe4] border-t border-[#e5dcce] flex items-center justify-between shrink-0">
          <div className="text-[11px] text-[#7a7266] font-serif-book">
            Settings apply automatically to all chapters in this volume.
          </div>

          <div className="flex items-center gap-2">
            <button
              id="close-book-info-footer-btn"
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-md bg-[#ffffff] hover:bg-[#eae3d6] border border-[#d8cfc4] text-xs font-medium text-[#4a4239] transition-colors"
            >
              Close
            </button>
            <button
              id="edit-book-settings-footer-btn"
              type="button"
              onClick={() => {
                onClose();
                onEditSettings();
              }}
              className="px-4 py-1.5 rounded-md bg-[#7a282f] hover:bg-[#632026] text-[#fbf9f5] text-xs font-medium flex items-center gap-1.5 transition-colors shadow-2xs"
            >
              <Settings className="w-3.5 h-3.5 text-[#e8c89b]" />
              <span>Configure Settings</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
