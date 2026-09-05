import { DirectorAttachment } from '../types';

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getFileCategory(filename: string, mimeType: string): 'pdf' | 'word' | 'markdown' | 'text' | 'other' {
  const lowerName = filename.toLowerCase();
  if (lowerName.endsWith('.pdf') || mimeType === 'application/pdf') return 'pdf';
  if (
    lowerName.endsWith('.docx') ||
    lowerName.endsWith('.doc') ||
    mimeType.includes('word') ||
    mimeType.includes('officedocument.wordprocessingml')
  ) {
    return 'word';
  }
  if (lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) return 'markdown';
  if (
    lowerName.endsWith('.txt') ||
    lowerName.endsWith('.rtf') ||
    lowerName.endsWith('.json') ||
    lowerName.endsWith('.csv') ||
    mimeType.startsWith('text/')
  ) {
    return 'text';
  }
  return 'other';
}

export async function processUploadedFile(file: File): Promise<DirectorAttachment> {
  const category = getFileCategory(file.name, file.type);
  const id = `att-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  if (category === 'pdf') {
    // Read as Base64 for Gemini PDF inlineData
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    return {
      id,
      name: file.name,
      size: file.size,
      type: 'application/pdf',
      base64,
      readiness: 'pdf-ready',
    };
  }

  if (category === 'word') {
    let extractedText = '';
    try {
      if (file.name.toLowerCase().endsWith('.docx')) {
        const mammoth = await import('mammoth');
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        extractedText = result.value.trim();
      }
    } catch (err) {
      console.warn('Could not extract docx with mammoth, falling back:', err);
    }

    if (!extractedText) {
      throw new Error(
        file.name.toLowerCase().endsWith('.doc')
          ? `Legacy Word file "${file.name}" cannot be read reliably. Save it as DOCX and attach it again.`
          : `No readable text could be extracted from "${file.name}".`
      );
    }

    return {
      id,
      name: file.name,
      size: file.size,
      type: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extractedText,
      readiness: 'text-ready',
      extractedCharacterCount: extractedText.length,
    };
  }

  // Markdown or plain text
  let text = '';
  try {
    text = await file.text();
  } catch (err) {
    console.warn('Failed to read file as text:', err);
    text = `[Document: ${file.name}]`;
  }

  if (!text.trim()) {
    throw new Error(`The file "${file.name}" does not contain readable text.`);
  }

  return {
    id,
    name: file.name,
    size: file.size,
    type: category === 'markdown' ? 'text/markdown' : file.type || 'text/plain',
    extractedText: text,
    readiness: 'text-ready',
    extractedCharacterCount: text.length,
  };
}
