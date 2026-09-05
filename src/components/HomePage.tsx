import React, { useState } from 'react';
import { Book, Chapter } from '../types';
import {
  BookOpen,
  Feather,
  Compass,
  Scroll,
  Sparkles,
  Shield,
  Coffee,
  Plus,
  Search,
  Users,
  Download,
  Upload,
  RotateCcw,
  MoreVertical,
  Edit2,
  Trash2,
  Settings,
  ArrowRight,
  BookMarked,
} from 'lucide-react';

interface HomePageProps {
  books: Book[];
  onOpenBook: (book: Book, chapter?: Chapter) => void;
  onOpenNewBookModal: () => void;
  onEditBook: (book: Book) => void;
  onDeleteBook: (bookId: string) => void;
  onExportLibrary: () => void;
  onImportLibrary: (json: string) => void;
  onResetLibrary: () => void;
}

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  BookOpen,
  Feather,
  Compass,
  Scroll,
  Sparkles,
  Shield,
  Coffee,
};

export const HomePage: React.FC<HomePageProps> = ({
  books,
  onOpenBook,
  onOpenNewBookModal,
  onEditBook,
  onDeleteBook,
  onExportLibrary,
  onImportLibrary,
  onResetLibrary,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMenuBookId, setActiveMenuBookId] = useState<string | null>(null);
  const [showDataModal, setShowDataModal] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);

  // Filter books by title, subtitle, synopsis, setting, or characters inside
  const filteredBooks = books.filter((b) => {
    const q = searchQuery.toLowerCase();
    const matchesBook =
      b.title.toLowerCase().includes(q) ||
      (b.subtitle && b.subtitle.toLowerCase().includes(q)) ||
      (b.synopsis && b.synopsis.toLowerCase().includes(q)) ||
      (b.setting && b.setting.toLowerCase().includes(q));

    const matchesCharacter = b.characters.some(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.role.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
    );

    return matchesBook || matchesCharacter;
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        onImportLibrary(content);
        setShowDataModal(false);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen bg-[#fbf9f5] text-[#292623] pb-24 selection:bg-[#ecdcc9]">
      {/* Top Literary Header */}
      <header className="border-b border-[#eae3d6] bg-[#fbf9f5]/95 sticky top-0 z-20 backdrop-blur-xs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-sm bg-[#7a282f] text-[#fbf9f5] flex items-center justify-center shadow-xs">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <span className="font-display-book text-xl font-bold tracking-widest text-[#1e1c1a]">
                FOLIO
              </span>
              <span className="hidden sm:inline-block ml-3 text-xs text-[#7e766c] font-serif-book italic">
                A sanctuary for books, living characters, and literary roleplay
              </span>
            </div>
          </div>

          {/* Top Actions */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              id="library-backup-btn"
              type="button"
              onClick={() => setShowDataModal(true)}
              className="p-2 sm:px-3 sm:py-1.5 text-xs text-[#6e655b] hover:text-[#24211e] hover:bg-[#eee7dc] rounded-md border border-transparent hover:border-[#dfd6c8] transition-colors flex items-center gap-1.5"
              title="Backup & Library Storage"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Library Archive</span>
            </button>

            <button
              id="header-new-book-btn"
              type="button"
              onClick={onOpenNewBookModal}
              className="px-3.5 py-1.5 bg-[#7a282f] hover:bg-[#632026] text-[#fbf9f5] rounded-md text-xs font-medium flex items-center gap-1.5 shadow-xs transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#e8c89b]" />
              <span>Conceive New Book</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 sm:pt-10">
        {/* Literary Library Intro */}
        <div className="mb-8 sm:mb-10 text-center max-w-2xl mx-auto">
          <h1 className="font-display-book text-2xl sm:text-3xl text-[#1e1c1a] tracking-wide mb-2">
            The Reading Library
          </h1>
          <p className="text-[#645c52] font-serif-book text-sm sm:text-base leading-relaxed">
            Every story begins with an idea. Share a premise to auto-generate an entire book with its setting, characters, and opening scene — customizable anytime.
          </p>
        </div>

        {/* Search & Stats Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-8 bg-[#f4eee6] p-3 sm:p-4 rounded-lg border border-[#e5dcd0]">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-[#8c8275] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id="library-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search books, settings, or characters..."
              className="w-full pl-9 pr-3 py-1.5 bg-[#ffffff] border border-[#d8cfc4] rounded-md text-xs sm:text-sm text-[#24211e] placeholder-[#a69c8f] focus:outline-none focus:ring-1 focus:ring-[#7a282f]"
            />
          </div>

          <div className="flex items-center gap-4 text-xs text-[#7e766c] w-full sm:w-auto justify-between sm:justify-end">
            <div className="flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-[#7a282f]" />
              <span>{books.length} Volumes Bound</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-[#7a282f]" />
              <span>
                {books.reduce((acc, b) => acc + b.characters.length, 0)} Characters Born
              </span>
            </div>
          </div>
        </div>

        {/* Books Grid */}
        {filteredBooks.length === 0 ? (
          <div className="text-center py-16 bg-[#f4eee6]/60 rounded-lg border border-dashed border-[#d8cfc4]">
            <BookOpen className="w-10 h-10 text-[#8c8275] mx-auto mb-3 opacity-60" />
            <p className="font-display-book text-base text-[#4a4239]">No books match your inquiry</p>
            <p className="text-xs text-[#7e766c] font-serif-book mt-1">
              Try searching with another phrase or bind a new volume.
            </p>
            <button
              type="button"
              onClick={onOpenNewBookModal}
              className="mt-4 px-4 py-2 bg-[#7a282f] text-[#fbf9f5] rounded text-xs font-medium hover:bg-[#632026] transition-colors"
            >
              Bind New Book
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredBooks.map((book) => {
              const IconComp = ICON_MAP[book.coverIcon] || BookOpen;
              const chapterCount = book.chapters.length;
              const charCount = book.characters.length;
              const latestChapter = book.chapters[book.chapters.length - 1];

              return (
                <div
                  key={book.id}
                  id={`book-card-${book.id}`}
                  className="group relative bg-[#ffffff] rounded-lg border border-[#e5dcd0] hover:border-[#cbbfb0] shadow-xs hover:shadow-md transition-all duration-200 flex flex-col overflow-hidden"
                >
                  {/* Spine Header Accent Bar */}
                  <div
                    className="h-2 w-full transition-colors"
                    style={{ backgroundColor: book.coverColor || '#7a282f' }}
                  />

                  <div className="p-5 flex-1 flex flex-col">
                    {/* Top Book Meta & Icon */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-8 h-8 rounded-sm flex items-center justify-center text-[#ffffff] shadow-xs shrink-0"
                          style={{ backgroundColor: book.coverColor || '#7a282f' }}
                        >
                          <IconComp className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="text-[11px] uppercase tracking-wider font-semibold text-[#8c8275]">
                            {chapterCount} {chapterCount === 1 ? 'Chapter' : 'Chapters'}
                          </span>
                        </div>
                      </div>

                      {/* Menu Dropdown */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditBook(book);
                          }}
                          className="p-1 text-[#a69c8f] hover:text-[#7a282f] rounded hover:bg-[#f2ede4] transition-colors"
                          title="Book Settings & Information"
                        >
                          <Settings className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuBookId(
                              activeMenuBookId === book.id ? null : book.id
                            );
                          }}
                          className="p-1 text-[#a69c8f] hover:text-[#24211e] rounded hover:bg-[#f2ede4] transition-colors"
                          title="Volume Options"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>

                        {activeMenuBookId === book.id && (
                          <div
                            className="absolute right-0 top-7 w-48 bg-[#ffffff] rounded-md shadow-lg border border-[#ded5c8] py-1 z-30 text-xs"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuBookId(null);
                                onEditBook(book);
                              }}
                              className="w-full px-3 py-2 text-left text-[#4a4239] hover:bg-[#f4eee6] flex items-center gap-2"
                            >
                              <Settings className="w-3.5 h-3.5 text-[#7a282f]" />
                              <span>Book Settings & Info</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuBookId(null);
                                onDeleteBook(book.id);
                              }}
                              className="w-full px-3 py-2 text-left text-[#9b2c2c] hover:bg-[#fdf2f2] flex items-center gap-2 border-t border-[#eee7dc]"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Delete Book</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Book Title & Subtitle */}
                    <h2 className="font-display-book text-lg font-bold text-[#1e1c1a] group-hover:text-[#7a282f] transition-colors line-clamp-1 mb-1">
                      {book.title}
                    </h2>
                    {book.subtitle && (
                      <p className="text-xs text-[#7a282f] font-serif-book italic mb-2 line-clamp-1">
                        {book.subtitle}
                      </p>
                    )}

                    {/* Synopsis */}
                    <p className="text-xs text-[#574f46] font-serif-book leading-relaxed mb-4 line-clamp-3">
                      {book.synopsis || book.setting || 'An unfolding tale waiting to be explored.'}
                    </p>

                    {/* Characters Born In This Book */}
                    <div className="mt-auto pt-3 border-t border-[#f0e9df]">
                      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold text-[#8c8275] mb-2">
                        <Users className="w-3 h-3 text-[#7a282f]" />
                        <span>Dramatis Personae ({charCount})</span>
                      </div>

                      {charCount > 0 ? (
                        <div className="flex flex-wrap gap-1.5 mb-4">
                          {book.characters.slice(0, 3).map((char) => (
                            <span
                              key={char.id}
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-[#f4eee6] text-[#4a4239] border border-[#ded5c8]"
                              title={`${char.name} · ${char.role}: ${char.description}`}
                            >
                              {char.name}
                            </span>
                          ))}
                          {charCount > 3 && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] bg-[#f0e9df] text-[#7e766c]">
                              +{charCount - 3} more
                            </span>
                          )}
                        </div>
                      ) : (
                        <p className="text-[11px] text-[#8c8275] italic font-serif-book mb-4">
                          Characters emerge dynamically as you or the narrator mention them.
                        </p>
                      )}

                      {/* Open Book Action */}
                      <button
                        type="button"
                        id={`open-book-${book.id}`}
                        onClick={() => onOpenBook(book, latestChapter)}
                        className="w-full py-2 px-3 bg-[#fbf9f5] hover:bg-[#7a282f] text-[#24211e] hover:text-[#fbf9f5] border border-[#d8cfc4] hover:border-[#7a282f] rounded text-xs font-medium flex items-center justify-center gap-2 transition-all shadow-2xs"
                      >
                        <BookMarked className="w-3.5 h-3.5" />
                        <span>Open & Read Volume</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Backup & Library Archive Modal */}
      {showDataModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-[#fbf9f5] w-full max-w-lg rounded-lg shadow-2xl border border-[#d8cfc4] p-6">
            <div className="flex items-center justify-between mb-4 border-b border-[#eae3d6] pb-3">
              <h2 className="font-display-book text-lg text-[#24211e]">
                Library Storage & Archive
              </h2>
              <button
                type="button"
                onClick={() => setShowDataModal(false)}
                className="text-[#8c8275] hover:text-[#24211e] text-sm"
              >
                Close
              </button>
            </div>

            <p className="text-xs text-[#6e655b] font-serif-book mb-4">
              All books, discovered characters, and chapters are stored locally in your browser. You may download a full JSON archive or restore one.
            </p>

            <div className="space-y-4">
              <div className="p-3 bg-[#ffffff] border border-[#ded5c8] rounded flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-[#24211e]">Export Library</h4>
                  <p className="text-[11px] text-[#7e766c]">Download your books and characters</p>
                </div>
                <button
                  type="button"
                  onClick={onExportLibrary}
                  className="px-3 py-1.5 bg-[#f4eee6] hover:bg-[#eae1d2] text-[#24211e] rounded text-xs font-medium border border-[#d8cfc4] flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download JSON</span>
                </button>
              </div>

              <div className="p-3 bg-[#ffffff] border border-[#ded5c8] rounded">
                <h4 className="text-xs font-semibold text-[#24211e] mb-1">Import Library</h4>
                <p className="text-[11px] text-[#7e766c] mb-2">
                  Upload a previously saved JSON library backup file.
                </p>
                <div className="flex items-center gap-2">
                  <label className="px-3 py-1.5 bg-[#f4eee6] hover:bg-[#eae1d2] text-[#24211e] rounded text-xs font-medium border border-[#d8cfc4] cursor-pointer flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload File</span>
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              <div className="pt-2 border-t border-[#eae3d6] flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        'Reset entire library to default books? Any custom stories will be replaced.'
                      )
                    ) {
                      onResetLibrary();
                      setShowDataModal(false);
                    }
                  }}
                  className="text-xs text-[#9b2c2c] hover:underline flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset to Default Volumes</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
