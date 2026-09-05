import { Book, BookCharacter, Chapter, ChatMessage } from '../types';
import { PRESET_BOOKS } from './presets';

const STORAGE_KEY_BOOKS = 'folio_books_v2';

export function getStoredBooks(): Book[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BOOKS);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY_BOOKS, JSON.stringify([]));
      return [];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Filter out any legacy preset / premade books
      const nonPreset = parsed.filter((book: Book) => {
        if (!book) return false;
        if (book.isPreset) return false;
        if (
          book.id === 'book-midnight-archives' ||
          book.id === 'book-perseus-veil' ||
          book.id === 'book-belvoir-winter'
        ) {
          return false;
        }
        return true;
      });

      let libraryWasMigrated = nonPreset.length !== parsed.length;
      const cleansed = nonPreset.map((book: Book) => {
        if (!book || !Array.isArray(book.characters)) return book;
        let modified = false;
        const newChars = book.characters.map((c, i) => {
          let updatedChar = { ...c };
          if (c && /^[Tt]he\s+[Pp]rotagonist$|^[Pp]rotagonist$|^[Mm]ain\s+[Cc]haracter$|^[Tt]he\s+[Hh]ero$/i.test(c.name.trim())) {
            modified = true;
            updatedChar.name = i === 0 ? 'Julian Cross' : (i === 1 ? 'Evelyn Ward' : `Companion ${i + 1}`);
            updatedChar.role = c.role && !/protagonist/i.test(c.role) ? c.role : 'Lead Adventurer & Seeker';
          }
          if (!updatedChar.voiceTone) {
            updatedChar.voiceTone = (
              /detective|inspector|officer|soldier|commander|gritty|guard|warrior/i.test(`${c.role || ''} ${c.description || ''}`) ? 'Gritty & Blunt' :
              /poet|scholar|archivist|occult|arcane|witch|oracle/i.test(`${c.role || ''} ${c.description || ''}`) ? 'Poetic & Formal' :
              /noble|lord|lady|diplomat|queen|king|aristocrat/i.test(`${c.role || ''} ${c.description || ''}`) ? 'Formal & Aristocratic' :
              /ai|android|synthetic|analyst|engineer|scientist|doctor/i.test(`${c.role || ''} ${c.description || ''}`) ? 'Scholarly & Analytical' :
              /veiled|shadow|mystic|cult|assassin/i.test(`${c.role || ''} ${c.description || ''}`) ? 'Cryptic & Whispering' :
              'Casual & Conversational'
            );
            modified = true;
          }
          return updatedChar;
        });
        const bookDialogueTone = book.dialogueTone || 'Natural & Adaptive';
        const greetingOnly = /^\s*(?:hi|hello|hey|hiya|good\s+(?:morning|afternoon|evening)|greetings)[\s!.,?]*$/i;
        const hasCanonLedger = Array.isArray(book.canonFacts);
        const cleanedCanonFacts = hasCanonLedger
          ? book.canonFacts!.filter((fact) => !greetingOnly.test(fact.text))
          : [];
        const cleanedLoreNotes = typeof book.loreNotes === 'string'
          ? book.loreNotes
              .split(/\n/)
              .filter((line) => !greetingOnly.test(line.replace(/^\s*[•*-]\s*/, '')))
              .join('\n')
              .trim()
          : book.loreNotes;
        if (!hasCanonLedger) modified = true;
        if (hasCanonLedger && cleanedCanonFacts.length !== book.canonFacts!.length) modified = true;
        if (cleanedLoreNotes !== book.loreNotes) modified = true;
        if (modified) libraryWasMigrated = true;
        return modified
          ? { ...book, dialogueTone: bookDialogueTone, characters: newChars, canonFacts: cleanedCanonFacts, loreNotes: cleanedLoreNotes }
          : book;
      });
      if (libraryWasMigrated) {
        localStorage.setItem(STORAGE_KEY_BOOKS, JSON.stringify(cleansed));
      }
      return cleansed;
    }
    return [];
  } catch (err) {
    console.error('Failed to load books from localStorage:', err);
    return [];
  }
}

export function saveBooks(books: Book[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY_BOOKS, JSON.stringify(books));
    return true;
  } catch (err) {
    console.error('Failed to save books to localStorage:', err);
    return false;
  }
}

export function getBookById(id: string): Book | undefined {
  const books = getStoredBooks();
  return books.find((b) => b.id === id);
}

export function saveBook(book: Book): boolean {
  const books = getStoredBooks();
  const index = books.findIndex((b) => b.id === book.id);
  if (index >= 0) {
    books[index] = { ...book, updatedAt: Date.now() };
  } else {
    books.unshift({ ...book, updatedAt: Date.now() });
  }
  return saveBooks(books);
}

export function deleteBook(id: string): void {
  const books = getStoredBooks();
  const filtered = books.filter((b) => b.id !== id);
  saveBooks(filtered);
}

export function resetLibraryToDefaults(): void {
  localStorage.setItem(STORAGE_KEY_BOOKS, JSON.stringify(PRESET_BOOKS));
}

export function addCharacterToBook(
  bookId: string,
  characterData: {
    name: string;
    role: string;
    description: string;
    appearanceNotes?: string;
    color?: string;
  }
): BookCharacter | null {
  const books = getStoredBooks();
  const book = books.find((b) => b.id === bookId);
  if (!book) return null;

  // Check if character with same name already exists in this book (case-insensitive)
  const existing = book.characters.find(
    (c) => c.name.trim().toLowerCase() === characterData.name.trim().toLowerCase()
  );
  if (existing) {
    // Update description if richer
    if (characterData.description && characterData.description.length > existing.description.length) {
      existing.description = characterData.description;
    }
    if (characterData.role) {
      existing.role = characterData.role;
    }
    book.updatedAt = Date.now();
    saveBooks(books);
    return existing;
  }

  const newChar: BookCharacter = {
    id: `char-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    name: characterData.name.trim(),
    role: characterData.role.trim() || 'Dramatis Persona',
    description: characterData.description.trim(),
    appearanceNotes: characterData.appearanceNotes,
    color: characterData.color || '#5a3d28',
    createdAt: Date.now(),
  };

  book.characters.push(newChar);
  book.updatedAt = Date.now();
  saveBooks(books);
  return newChar;
}

export function updateCharacterInBook(
  bookId: string,
  characterId: string,
  updates: Partial<BookCharacter>
): void {
  const books = getStoredBooks();
  const book = books.find((b) => b.id === bookId);
  if (!book) return;

  const char = book.characters.find((c) => c.id === characterId);
  if (char) {
    Object.assign(char, updates);
    book.updatedAt = Date.now();
    saveBooks(books);
  }
}

export function removeCharacterFromBook(bookId: string, characterId: string): void {
  const books = getStoredBooks();
  const book = books.find((b) => b.id === bookId);
  if (!book) return;

  book.characters = book.characters.filter((c) => c.id !== characterId);
  book.updatedAt = Date.now();
  saveBooks(books);
}

export function addChapterToBook(bookId: string, customTitle?: string): Chapter | null {
  const books = getStoredBooks();
  const book = books.find((b) => b.id === bookId);
  if (!book) return null;

  const chapterCount = book.chapters.length + 1;
  const romanNumerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  const numeral = romanNumerals[chapterCount - 1] || `${chapterCount}`;
  const title = customTitle || `Chapter ${numeral}: Untitled Sequence`;

  // Start with the book's prologue or an opening atmospheric tone
  const initialMessage: ChatMessage = {
    id: `msg-${Date.now()}`,
    role: 'assistant',
    content: book.prologue || `*The pages turn to Chapter ${numeral}. The silence settles over the room.*`,
    timestamp: Date.now(),
  };

  const newChapter: Chapter = {
    id: `chap-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    bookId,
    title,
    messages: [initialMessage],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  book.chapters.push(newChapter);
  book.updatedAt = Date.now();
  saveBooks(books);
  return newChapter;
}

export function updateChapterMessages(
  bookId: string,
  chapterId: string,
  messages: ChatMessage[]
): void {
  const books = getStoredBooks();
  const book = books.find((b) => b.id === bookId);
  if (!book) return;

  const chapter = book.chapters.find((ch) => ch.id === chapterId);
  if (chapter) {
    chapter.messages = messages;
    chapter.updatedAt = Date.now();
    book.updatedAt = Date.now();
    saveBooks(books);
  }
}

export function deleteChapterFromBook(bookId: string, chapterId: string): void {
  const books = getStoredBooks();
  const book = books.find((b) => b.id === bookId);
  if (!book) return;

  book.chapters = book.chapters.filter((ch) => ch.id !== chapterId);
  // Guarantee at least one chapter remains
  if (book.chapters.length === 0) {
    addChapterToBook(bookId, 'Chapter I: The Opening Passage');
  } else {
    book.updatedAt = Date.now();
    saveBooks(books);
  }
}

export function exportLibraryJSON(): string {
  const books = getStoredBooks();
  return JSON.stringify(books, null, 2);
}

export function importLibraryJSON(jsonStr: string): boolean {
  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].title && parsed[0].id) {
      saveBooks(parsed);
      return true;
    }
    return false;
  } catch (err) {
    console.error('Failed to import books JSON:', err);
    return false;
  }
}
