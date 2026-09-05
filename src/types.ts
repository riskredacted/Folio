export interface BookCharacter {
  id: string;
  name: string;
  role: string; // e.g. "The Antiquarian", "Deep-space Navigator", "Scotland Yard Inspector"
  description: string; // Summary or persona notes within this book
  appearanceNotes?: string; // How they were introduced or first appeared
  voiceTone?: string; // e.g. "Casual & Conversational", "Poetic & Lyrical", "Formal & Aristocratic", "Gritty & Blunt", etc.
  color?: string; // Distinctive character tag color
  createdAt: number;
}

export const VOICE_TONE_OPTIONS = [
  { id: 'casual', label: 'Casual & Conversational', description: 'Relaxed modern speech, contractions, informal idioms' },
  { id: 'poetic', label: 'Poetic & Lyrical', description: 'Metaphorical, ornate English, rhythmic and evocative cadence' },
  { id: 'formal', label: 'Formal & Aristocratic', description: 'Stately high English, etiquette, polite distance' },
  { id: 'gritty', label: 'Gritty & Blunt', description: 'Clipped sentences, street-level roughness, hardboiled, direct' },
  { id: 'scholarly', label: 'Scholarly & Analytical', description: 'Erudite vocabulary, precise observations, reasoned deductions' },
  { id: 'cryptic', label: 'Cryptic & Whispering', description: 'Veiled riddles, hushed warnings, enigmatic remarks' },
  { id: 'sarcastic', label: 'Sarcastic & Witty', description: 'Dry irony, biting humor, understated sharp quips' },
] as const;

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  speaker?: string; // Optional character or narrator attribution
  isOfflineFallback?: boolean; // True if response was produced by local dynamic premise engine
}

export interface Chapter {
  id: string;
  bookId: string;
  title: string; // e.g. "Chapter I: The Veiled Manuscript"
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface AppliedBookUpdates {
  charactersUpdated?: string[];
  charactersAdded?: string[];
  settingUpdated?: boolean;
  synopsisUpdated?: boolean;
  loreNotesAdded?: boolean;
  dialogueToneUpdated?: boolean;
  summaryText?: string;
}

export interface DirectorAttachment {
  id: string;
  name: string;
  size: number;
  type: string; // e.g. 'application/pdf', 'text/markdown', etc.
  base64?: string;
  extractedText?: string;
  readiness?: 'text-ready' | 'pdf-ready';
  extractedCharacterCount?: number;
}

export interface DirectorFileReadReceipt {
  name: string;
  read: boolean;
  summary: string;
}

export interface RerollPassageContext {
  chapterId: string;
  chapterTitle: string;
  messageId: string;
  passageSnippet: string;
  originalIdea?: string;
}

export interface DirectorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  attachments?: DirectorAttachment[];
  appliedUpdates?: AppliedBookUpdates;
  rerollContext?: RerollPassageContext;
  reasoningLevel?: 'off' | 'medium' | 'high';
  thought?: string;
  directorMode?: 'ai' | 'local';
  filesRead?: DirectorFileReadReceipt[];
}

export interface DirectorCanonFact {
  id: string;
  text: string;
  sourceMessageId: string;
  affectedCharacters?: string[];
  category: 'character' | 'setting' | 'synopsis' | 'lore' | 'mixed';
  createdAt: number;
}

export interface Book {
  id: string;
  title: string;
  subtitle: string; // e.g. "A Victorian Mystery of Forgotten Codices"
  synopsis: string; // Summary of the premise
  setting: string; // Atmosphere, location, era
  dialogueTone?: string; // e.g. "Natural & Casual", "Literary & Formal", "Poetic & Atmospheric", "Gritty & Realistic"
  prologue: string; // Opening narrative that begins the book
  coverColor: string; // Book spine / leather hue
  coverIcon: string; // Lucide icon
  characters: BookCharacter[]; // Characters made/mentioned in this book
  chapters: Chapter[]; // Reading sessions / chapters
  loreNotes?: string; // Additional world lore, rules, or backstory curated by the author and AI
  canonFacts?: DirectorCanonFact[]; // Ordered, persistent facts established through the Director's Desk
  directorMessages?: DirectorMessage[]; // Private author-director consultation history
  directorReasoningLevel?: 'off' | 'medium' | 'high';
  createdAt: number;
  updatedAt: number;
  isPreset?: boolean;
}
