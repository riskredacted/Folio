import React from 'react';

interface BookTextProps {
  content: string;
  className?: string;
}

/**
 * Renders roleplay narrative text with literary styling.
 * Applies justified alignment and standard literary first-line paragraph indents.
 * Formats actions in asterisks *like this* as subtle italicized prose,
 * and highlights spoken dialogue in quotes cleanly.
 */
export const BookText: React.FC<BookTextProps> = ({ content, className = '' }) => {
  if (!content) return null;

  // Split content by paragraphs (handles both double newlines and single newline separation)
  const rawParagraphs = content.split(/\n\s*\n/);
  const paragraphs = rawParagraphs
    .flatMap((p) => (p.includes('\n') ? p.split('\n') : [p]))
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div
      className={`space-y-3.5 font-serif-book text-[16.5px] leading-relaxed text-[#2b2725] text-justify [text-align:justify] [text-justify:inter-word] hyphens-auto selection:bg-[#ecdcc9] ${className}`}
    >
      {paragraphs.map((para, pIdx) => {
        // Tokenize paragraph by asterisks to detect *action or description*
        // E.g. "He smiles. *He turns the page.* "Indeed," he says."
        const parts = para.split(/(\*[^*]+\*)/g);

        return (
          <p
            key={pIdx}
            className="text-[#2b2725] text-justify [text-align:justify] [text-justify:inter-word] indent-6 sm:indent-8 leading-relaxed selection:bg-[#ecdcc9]"
          >
            {parts.map((part, partIdx) => {
              if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
                const actionText = part.slice(1, -1);
                return (
                  <span
                    key={partIdx}
                    className="italic text-[#5c554e] font-serif-book font-normal tracking-wide"
                  >
                    {actionText}
                  </span>
                );
              }

              // Highlight quoted dialogue slightly if present
              const dialogueParts = part.split(/("[^"]*")/g);
              return (
                <span key={partIdx}>
                  {dialogueParts.map((sub, subIdx) => {
                    if (sub.startsWith('"') && sub.endsWith('"') && sub.length > 1) {
                      return (
                        <span
                          key={subIdx}
                          className="text-[#191716] font-medium font-serif-book"
                        >
                          {sub}
                        </span>
                      );
                    }
                    return <span key={subIdx}>{sub}</span>;
                  })}
                </span>
              );
            })}
          </p>
        );
      })}
    </div>
  );
};
