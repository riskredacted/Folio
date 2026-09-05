import React, { useState, useEffect } from 'react';
import { Book, Chapter } from './types';
import {
  getStoredBooks,
  saveBook,
  deleteBook,
  resetLibraryToDefaults,
  addChapterToBook,
  deleteChapterFromBook,
  exportLibraryJSON,
  importLibraryJSON,
} from './lib/storage';
import { HomePage } from './components/HomePage';
import { ChatArea } from './components/ChatArea';
import { BookModal } from './components/BookModal';

export default function App() {
  const [view, setView] = useState<'home' | 'chat'>('home');
  const [books, setBooks] = useState<Book[]>([]);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);

  // Book Modal state (Create / Edit volume)
  const [isBookModalOpen, setIsBookModalOpen] = useState(false);
  const [editingBook, setEditingBook] = useState<Book | null>(null);

  // Notification toast
  const [notification, setNotification] = useState<string | null>(null);

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3500);
  };

  // Load books from storage on mount
  useEffect(() => {
    const loaded = getStoredBooks();
    setBooks(loaded);
  }, []);

  const activeBook = books.find((b) => b.id === activeBookId) || null;
  const activeChapter =
    (activeBook?.chapters && activeBook.chapters.length > 0)
      ? activeBook.chapters.find((ch) => ch.id === activeChapterId) ||
        activeBook.chapters[activeBook.chapters.length - 1]
      : null;

  const handleOpenBook = (book: Book, chapter?: Chapter) => {
    setActiveBookId(book.id);
    let targetChapter = chapter || (book.chapters && book.chapters.length > 0 ? (book.chapters.find((c) => c.id === activeChapterId) || book.chapters[book.chapters.length - 1]) : null);
    if (!targetChapter && (!book.chapters || book.chapters.length === 0)) {
      const createdChapter = addChapterToBook(book.id, 'Chapter I');
      if (createdChapter) {
        setBooks(getStoredBooks());
        targetChapter = createdChapter;
      }
    }
    if (targetChapter) {
      setActiveChapterId(targetChapter.id);
    }
    setView('chat');
  };

  const handleSaveBook = (bookToSave: Book, openImmediately?: boolean) => {
    if (!saveBook(bookToSave)) {
      showNotification('Unable to save this volume to local library storage.');
      return;
    }
    const updated = getStoredBooks();
    setBooks(updated);
    if (openImmediately) {
      handleOpenBook(bookToSave);
    }
    showNotification(`Volume "${bookToSave.title}" bound and saved.`);
  };

  const handleDeleteBook = (bookId: string) => {
    deleteBook(bookId);
    const updated = getStoredBooks();
    setBooks(updated);

    if (activeBookId === bookId) {
      setView('home');
      setActiveBookId(null);
      setActiveChapterId(null);
    }
    showNotification('Volume removed from library.');
  };

  const handleNewChapter = (customTitle?: string) => {
    if (!activeBook) return;
    const newChapter = addChapterToBook(activeBook.id, customTitle);
    if (newChapter) {
      const updated = getStoredBooks();
      setBooks(updated);
      setActiveChapterId(newChapter.id);
      showNotification(`Turned page to "${newChapter.title}".`);
    }
  };

  const handleDeleteChapter = (chapterId: string) => {
    if (!activeBook) return;
    deleteChapterFromBook(activeBook.id, chapterId);
    const updated = getStoredBooks();
    setBooks(updated);

    const refreshedBook = updated.find((b) => b.id === activeBook.id);
    if (refreshedBook && refreshedBook.chapters.length > 0) {
      setActiveChapterId(refreshedBook.chapters[refreshedBook.chapters.length - 1].id);
    }
  };

  const handleUpdateBook = (updatedBook: Book) => {
    if (!saveBook(updatedBook)) {
      showNotification('Unable to persist the latest book or Director changes.');
      return;
    }
    const updated = getStoredBooks();
    setBooks(updated);
  };

  const handleExportLibrary = () => {
    const json = exportLibraryJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `folio-library-books-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotification('Library books exported.');
  };

  const handleImportLibrary = (json: string) => {
    const success = importLibraryJSON(json);
    if (success) {
      setBooks(getStoredBooks());
      showNotification('Library restored successfully.');
    } else {
      alert('Failed to parse book library JSON.');
    }
  };

  const handleResetLibrary = () => {
    resetLibraryToDefaults();
    setBooks(getStoredBooks());
    setView('home');
    setActiveBookId(null);
    setActiveChapterId(null);
    showNotification('Library restored to classic preset volumes.');
  };

  return (
    <div className="min-h-screen bg-[#fbf9f5] font-sans-ui text-[#282522]">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-4 right-4 z-50 bg-[#2b2724] text-[#fbf9f5] text-xs font-medium px-4 py-2.5 rounded-lg shadow-lg border border-[#48423c] animate-fade-in">
          {notification}
        </div>
      )}

      {/* Main View Router */}
      {view === 'home' || !activeBook || !activeChapter ? (
        <HomePage
          books={books}
          onOpenBook={handleOpenBook}
          onOpenNewBookModal={() => {
            setEditingBook(null);
            setIsBookModalOpen(true);
          }}
          onEditBook={(book) => {
            setEditingBook(book);
            setIsBookModalOpen(true);
          }}
          onDeleteBook={handleDeleteBook}
          onExportLibrary={handleExportLibrary}
          onImportLibrary={handleImportLibrary}
          onResetLibrary={handleResetLibrary}
        />
      ) : (
        <ChatArea
          book={activeBook}
          activeChapter={activeChapter}
          onBackToLibrary={() => setView('home')}
          onSelectChapter={(chapter) => setActiveChapterId(chapter.id)}
          onNewChapter={handleNewChapter}
          onDeleteChapter={handleDeleteChapter}
          onUpdateBook={handleUpdateBook}
          onEditBookDetails={() => {
            setEditingBook(activeBook);
            setIsBookModalOpen(true);
          }}
        />
      )}

      {/* Book Creator / Editor Modal */}
      <BookModal
        isOpen={isBookModalOpen}
        onClose={() => {
          setIsBookModalOpen(false);
          setEditingBook(null);
        }}
        onSave={handleSaveBook}
        bookToEdit={editingBook}
      />
    </div>
  );
}
