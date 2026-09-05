import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "25mb" }));

  // Helper to initialize Gemini client lazily
  function getGeminiClient(): GoogleGenAI | null {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return null;
    }
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }

  // Helper to call Gemini with multi-model fallback and transient error retry (503/429)
  async function generateWithModelFallback(
    client: GoogleGenAI,
    options: {
      contents: any;
      systemInstruction?: string;
      temperature?: number;
      topP?: number;
      presencePenalty?: number;
      frequencyPenalty?: number;
      responseMimeType?: string;
      thinkingConfig?: { thinkingBudget?: number };
    }
  ): Promise<string> {
    const candidateModels = [
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
    ];

    let lastError: unknown = null;

    for (let i = 0; i < candidateModels.length; i++) {
      const modelName = candidateModels[i];
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const config: Record<string, any> = {
            temperature: options.temperature ?? 0.85,
            topP: options.topP ?? 0.95,
          };
          if (options.systemInstruction) {
            config.systemInstruction = options.systemInstruction;
          }
          if (options.presencePenalty !== undefined) {
            config.presencePenalty = options.presencePenalty;
          }
          if (options.frequencyPenalty !== undefined) {
            config.frequencyPenalty = options.frequencyPenalty;
          }
          if (options.responseMimeType) {
            config.responseMimeType = options.responseMimeType;
          }
          if (options.thinkingConfig) {
            config.thinkingConfig = options.thinkingConfig;
          }

          const response = await client.models.generateContent({
            model: modelName,
            contents: options.contents,
            config,
          });

          if (response.text) {
            return response.text;
          }
        } catch (err: any) {
          lastError = err;
          const status = err?.status || err?.code;
          const isQuotaDepleted =
            err?.message?.includes("depleted") ||
            err?.message?.includes("RESOURCE_EXHAUSTED") ||
            err?.message?.includes("billing");

          if (isQuotaDepleted) {
            throw err;
          }

          const isTransient =
            (status === 503 ||
            status === 429 ||
            err?.message?.includes("503") ||
            err?.message?.includes("high demand")) &&
            !isQuotaDepleted;

          if (isTransient && attempt === 0) {
            // Short backoff before second attempt
            await new Promise((resolve) => setTimeout(resolve, 400));
          } else {
            break; // Proceed to next candidate model or fallback
          }
        }
      }
    }

    throw lastError;
  }

  // Robust JSON parser that handles markdown fences, commentary, and trailing characters
  function safeParseJsonObject(raw: string): any {
    if (!raw || typeof raw !== "string") {
      throw new Error("Empty or invalid model response string");
    }

    const trimmed = raw.trim();

    // 1. Direct parse attempt
    try {
      return JSON.parse(trimmed);
    } catch {
      // Continue to smart extraction
    }

    // 2. Extract markdown code block if present
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch && codeBlockMatch[1]) {
      const blockContent = codeBlockMatch[1].trim();
      try {
        return JSON.parse(blockContent);
      } catch {
        // Continue to brace tracking
      }
    }

    // 3. Locate first opening brace
    const firstBrace = trimmed.indexOf("{");
    if (firstBrace === -1) {
      throw new Error("No opening JSON brace '{' found in model response");
    }

    // 4. Balanced brace tracking taking string escapes into account
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let endBrace = -1;

    for (let i = firstBrace; i < trimmed.length; i++) {
      const ch = trimmed[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (ch === "\\") {
        escapeNext = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (ch === "{") {
          depth++;
        } else if (ch === "}") {
          depth--;
          if (depth === 0) {
            endBrace = i;
            break;
          }
        }
      }
    }

    const candidate =
      endBrace !== -1
        ? trimmed.slice(firstBrace, endBrace + 1)
        : trimmed.slice(firstBrace, trimmed.lastIndexOf("}") + 1);

    try {
      return JSON.parse(candidate);
    } catch (err) {
      // Fallback: clean trailing commas before closing braces/brackets
      const cleaned = candidate.replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(cleaned);
    }
  }

  // Robust narrative text sanitizer that replaces accidental placeholder leaks and strips common AI clichés
  function sanitizeNarrativeOutput(text: string, book?: any): string {
    if (!text) return "";

    let leadName = "";
    if (book && Array.isArray(book.characters) && book.characters.length > 0) {
      const leadChar =
        book.characters.find(
          (c: any) =>
            c &&
            c.name &&
            /protagonist|main|lead|hero|pov/i.test(c.role || "") &&
            !/protagonist/i.test(c.name)
        ) ||
        book.characters.find(
          (c: any) => c && c.name && !/protagonist/i.test(c.name)
        );

      if (leadChar && leadChar.name) {
        leadName = leadChar.name.trim();
      }
    }

    const firstCharName = Array.isArray(book?.characters) && book.characters[0]?.name ? book.characters[0].name.trim() : "";
    const replacementName = leadName || firstCharName || "the lead";
    const possessiveName = leadName ? `${leadName}'s` : (firstCharName ? `${firstCharName}'s` : "their");

    let sanitized = text
      .replace(/\b[Tt]he\s+[Pp]rotagonist's\b/g, possessiveName)
      .replace(/\b[Pp]rotagonist's\b/g, possessiveName)
      .replace(/\b[Tt]he\s+[Pp]rotagonist\b/g, replacementName)
      .replace(/\b[Pp]rotagonist\b/g, replacementName)
      .replace(/\b[Tt]he\s+[Mm]ain\s+[Cc]haracter's\b/g, possessiveName)
      .replace(/\b[Tt]he\s+[Mm]ain\s+[Cc]haracter\b/g, replacementName);

    // Strip common AI meta introductions / preambles
    sanitized = sanitized
      .replace(/^(?:Certainly!|Sure!|Here is the next scene:?|As requested:?|Here's what happens next:?)\s*\n+/i, "")
      .replace(/\n+(?:What will .* do next\?|Will they survive\?|What happens next\?.*)$/i, "");

    // Scrub classic AI writing clichés & replace with grounded tactile phrasing
    sanitized = sanitized
      // "breath they didn't know they were holding"
      .replace(/\b(?:let|letting|released?)\s+out\s+a\s+breath\s+(?:they|he|she|I)\s+(?:didn't|did\s+not)\s+know\s+(?:they|he|she|I)\s+(?:were|was)\s+holding\b/gi, "exhaled slowly")
      .replace(/\ba\s+breath\s+(?:they|he|she|I)\s+(?:didn't|did\s+not)\s+know\s+(?:they|he|she|I)\s+(?:were|was)\s+holding\b/gi, "a sharp breath")
      // "testament to"
      .replace(/\b(?:stands?\s+as\s+)?a\s+testament\s+to\b/gi, "clear proof of")
      // "tapestry of / rich tapestry"
      .replace(/\b(?:rich\s+|delicate\s+|intricate\s+)?tapestry\s+of\b/gi, "network of")
      // "shiver down their spine"
      .replace(/\b(?:a\s+)?shiver\s+(?:ran|coursed|shot|went)\s+down\s+(?:their|his|her|my)\s+spine\b/gi, "a sudden coldness settled in")
      .replace(/\bsent\s+(?:a\s+)?shiver\s+down\s+(?:their|his|her|my)\s+spine\b/gi, "brought a sharp chill")
      // "the tension was palpable / palpable tension"
      .replace(/\b(?:the\s+)?tension\s+was\s+palpable\b/gi, "the room went dead silent")
      .replace(/\bpalpable\s+tension\b/gi, "heavy stillness")
      // "little did they know / unbeknownst to them"
      .replace(/\b[Ll]ittle\s+did\s+(?:they|he|she|we)\s+know,?\s*/gi, "")
      .replace(/\b[Uu]nbeknownst\s+to\s+(?:them|him|her|us),?\s*/gi, "")
      // "deadly dance / dance of shadows"
      .replace(/\ba\s+(?:deadly|delicate|graceful)\s+dance\s+of\b/gi, "a sharp clash of")
      // "delve deep / delve into"
      .replace(/\bdelve(?:d|s)?\s+deep(?:ly)?\s+into\b/gi, "dig deep into")
      .replace(/\bdelve(?:d|s)?\s+into\b/gi, "explore")
      // "smirked knowingly / wry smile / wry chuckle"
      .replace(/\bsmirked\s+knowingly\b/gi, "smiled faintly")
      .replace(/\ba\s+wry\s+(?:smile|chuckle|grin)\b/gi, "a dry smirk")
      // "time seemed to stand still"
      .replace(/\btime\s+seemed\s+to\s+stand\s+still\b/gi, "everything went still")
      // "beacon of hope"
      .replace(/\ba\s+beacon\s+of\s+hope\b/gi, "a rare light")
      // "stark reminder"
      .replace(/\ba\s+stark\s+reminder\s+(?:of|that)\b/gi, "a stark warning that")
      // Perceptual filters & hedging
      .replace(/\b(?:could\s+feel|felt)\s+a\s+sense\s+of\s+([a-z]+)\b/gi, "$1 tightened")
      .replace(/\b(?:could\s+feel|felt)\s+the\s+([a-z]+)\s+washing\s+over\b/gi, "$1 gripped")
      .replace(/\ba\s+ghost\s+of\s+a\s+smile\b/gi, "a faint smile")
      .replace(/\ba\s+flicker\s+of\s+([a-z]+)\s+(?:passed|crossed|flashed)\s+across\b/gi, "$1 showed in")
      .replace(/\ban\s+unreadable\s+expression\b/gi, "a guarded expression")
      .replace(/\bsteering\s+the\s+scene\s+precisely\s+in\s+the\s+direction\s+you\s+intended\b/gi, "cutting through the silence")
      .replace(/\baltering\s+the\s+balance\s+of\s+the\s+room\s+exactly\s+as\s+you\s+directed\b/gi, "shifting the room's momentum")
      .replace(/\bremains\s+grounded\s+in\s+the\s+facts\s+already\s+established\s+about\s+them\b/gi, "stays watchful at their side")
      .replace(/\bstays\s+watchful\s+at\s+your\s+side\b/gi, "stays watchful at their side")
      .replace(/\bthe\s+air\s+between\s+you\b/gi, "the air between them")
      .replace(/\bbetween\s+you\b/gi, "between them");

    return sanitized;
  }

  const NON_PERSON_LOCATION_KEYWORDS = new Set([
    // Educational & Academic
    "school", "highschool", "high", "elementary", "academy", "university", "college", "institute", "institution", "campus", "dorm", "dormitory", "classroom", "faculty", "seminary",
    // Medical & Public Facilities
    "hospital", "clinic", "asylum", "sanatorium", "infirmary", "ward", "station", "terminal", "airport", "harbor", "port", "depot", "pier", "dock", "docks",
    // Religious & Sacred
    "church", "cathedral", "chapel", "temple", "monastery", "convent", "shrine", "mosque", "synagogue", "parish", "abbey", "sanctuary",
    // Architectural & Castles
    "castle", "palace", "manor", "estate", "hall", "mansion", "tower", "keep", "fort", "fortress", "citadel", "bunker", "vault", "dungeon", "prison", "jail", "penitentiary",
    // Hospitality & Social
    "hotel", "inn", "tavern", "pub", "bar", "saloon", "diner", "cafe", "restaurant", "motel", "hostel",
    // Cultural
    "library", "museum", "archive", "archives", "gallery", "theater", "theatre", "cinema", "stadium", "arena", "colosseum",
    // Commercial & Industrial
    "center", "centre", "complex", "building", "lab", "laboratory", "office", "headquarters", "facility", "plant", "factory", "mill", "warehouse", "shop", "store", "market",
    // Streets & Geography
    "street", "avenue", "boulevard", "road", "lane", "drive", "way", "alley", "court", "plaza", "square", "bridge",
    "city", "town", "village", "county", "district", "borough", "state", "province", "country", "kingdom", "empire", "republic", "realm", "capital",
    "lake", "river", "sea", "ocean", "mountain", "mount", "valley", "forest", "woods", "swamp", "marsh", "desert", "island", "isle", "bay", "cove", "gulf", "coast", "shore",
    "planet", "star", "galaxy", "nebula", "system", "orbit", "earth", "mars", "jupiter", "moon", "sun",
    // Organizations & Collectives
    "department", "agency", "bureau", "federation", "corporation", "company", "guild", "order", "society", "council", "syndicate", "police", "alliance", "union", "league", "cult", "coven",
    // Structural / Common words
    "chapter", "volume", "prologue", "epilogue", "book", "story", "novel", "chronicle", "chronicles", "tale", "tales"
  ]);

  function isNonPersonName(name: string): boolean {
    if (!name || typeof name !== "string") return true;
    const trimmed = name.trim();
    if (!trimmed) return true;
    const words = trimmed.toLowerCase().split(/\s+/);
    for (const word of words) {
      const cleanWord = word.replace(/[^a-z]/g, "");
      if (NON_PERSON_LOCATION_KEYWORDS.has(cleanWord)) return true;
    }
    return false;
  }

  // Pull explicit living person names from a prose premise while strictly excluding locations and institutions
  function extractExplicitCharacterNames(idea: string): string[] {
    const nonNameOpeners = new Set([
      "A", "An", "The", "This", "That", "These", "Those", "It", "Its", "They", "We", "You",
      "Chapter", "Book", "Story", "In", "On", "At", "When", "While", "Where", "Why", "How",
      "After", "Before", "Two", "Three", "Four", "Five", "Many", "Some", "Every", "All",
      "During", "Under", "Inside", "Outside", "Across", "Along", "Between", "From", "Into",
      "With", "Without", "Through", "Once", "One", "There", "Here", "Then", "Now"
    ]);

    const candidates: string[] = [];

    // 1. Explicit multi-word proper names: "Arthur Pendelton", "Julian Cross"
    const multiWordPattern =
      /\b([A-Z][A-Za-z'’\-]+(?:\s+(?:(?:de|del|della|di|da|dos|du|la|le|van|von|der|den|bin|al)\s+)?[A-Z][A-Za-z'’\-]+){1,3})\b/g;
    for (const match of idea.matchAll(multiWordPattern)) {
      candidates.push(match[1].trim().replace(/[.,;:!?]+$/g, ""));
    }

    // 2. Co-occurring single names: "William and Gabrielle", "Julian & Silas"
    const pairPattern = /\b([A-Z][A-Za-z'’\-]{2,})\s+(?:and|&)\s+([A-Z][A-Za-z'’\-]{2,})\b/g;
    for (const match of idea.matchAll(pairPattern)) {
      candidates.push(match[1].trim().replace(/[.,;:!?]+$/g, ""));
      candidates.push(match[2].trim().replace(/[.,;:!?]+$/g, ""));
    }

    // 3. Titled names: "Professor Higgins", "Detective Miller", "Lady Cordelia"
    const titlePattern =
      /\b(?:Detective|Inspector|Doctor|Dr\.|Professor|Prof\.|Captain|Lord|Lady|Madame|Madam|Officer|Agent)\s+([A-Z][A-Za-z'’\-]+(?:\s+[A-Z][A-Za-z'’\-]+)?)\b/g;
    for (const match of idea.matchAll(titlePattern)) {
      candidates.push(match[1].trim().replace(/[.,;:!?]+$/g, ""));
    }

    const filteredNames: string[] = [];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const firstWord = candidate.split(/\s+/)[0];
      if (nonNameOpeners.has(firstWord)) continue;
      if (isNonPersonName(candidate)) continue;
      if (!filteredNames.some((name) => name.toLowerCase() === candidate.toLowerCase())) {
        filteredNames.push(candidate);
      }
    }

    return filteredNames;
  }

  function createPremiseCharacters(idea: string, names: string[]) {
    const isCollegeStory = /\b(?:college|university|campus)\b/i.test(idea);
    const areBestFriends = /\bbest\s*friends?\b/i.test(idea);

    return names.map((name, index) => {
      const otherNames = names.filter((_, otherIndex) => otherIndex !== index);
      const relationship = areBestFriends && otherNames.length > 0
        ? `${otherNames.join(" and ")}'s best friend${isCollegeStory ? " and fellow college student" : ""}`
        : isCollegeStory
          ? "A college student central to the story"
          : "A central character named in the premise";

      return {
        name,
        role: isCollegeStory ? "College Student" : "Central Character",
        description: `${relationship}, exactly as established in the original premise.`,
        voiceTone: index === 0 ? "Casual & Conversational" : (index === 1 ? "Sarcastic & Witty" : "Casual & Conversational"),
      };
    });
  }

  // Graceful fallback synthesizer when Gemini is unavailable
  function createFallbackBookFromIdea(idea: string) {
    const words = idea.trim().split(/\s+/).filter(Boolean);
    const titleSnippet = words
      .slice(0, 5)
      .join(" ")
      .replace(/[^\w\s]/g, "");
    const formattedTitle =
      titleSnippet.length > 2
        ? titleSnippet.replace(/\b\w/g, (c) => c.toUpperCase())
        : "The Unwritten Folio";

    const explicitNames = extractExplicitCharacterNames(idea);
    const characters = createPremiseCharacters(idea, explicitNames);
    const displayNames = explicitNames.length > 0
      ? explicitNames.join(explicitNames.length === 2 ? " and " : ", ")
      : "the lives at its center";

    const inferredTone = /poetic|verse|lyrical|ballad/i.test(idea)
      ? "Poetic & Lyrical"
      : /formal|court|palace|royal|empire|victorian/i.test(idea)
        ? "Formal & Aristocratic"
        : /gritty|noir|crime|detective|street/i.test(idea)
          ? "Gritty & Blunt"
          : /academic|professor|research|library|scholar/i.test(idea)
            ? "Scholarly & Analytical"
            : "Casual & Conversational";

    return {
      title: `The Chronicles of ${formattedTitle}`,
      subtitle: "A Manuscript Born of an Instant Idea",
      setting: idea.trim(),
      dialogueTone: inferredTone,
      synopsis: idea.trim(),
      prologue: `Morning gathers over the world in its familiar rhythm. ${displayNames} move through it with their history already woven between them.\n\n${idea.trim()}\n\nSomething in that ordinary day is about to change.`,
      coverColor: "#7a282f",
      coverIcon: "BookOpen",
      characters,
    };
  }

  // Graceful storytelling narrative generator with deep obedience to director lore and user prompts
  function createFallbackNarrative(book: any, userPrompt: string): string {
    const chars = Array.isArray(book?.characters) && book.characters.length > 0
      ? book.characters
      : [{ name: "The Companion", role: "Ally", description: "" }];

    const loreText = (book?.loreNotes || "").toLowerCase();
    const settingText = String(book?.setting || "the established world")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 260);
    const combinedCanon = [
      book?.loreNotes || "",
      ...chars.map((character: any) => `${character?.name || ""}: ${character?.description || ""}`),
    ].join("\n");

    const latestCharacterCanon = (character: any) => {
      const description = String(character?.description || "");
      const matches = [...description.matchAll(/\[(?:Director Canon|Author Directive):\s*([^\]]+)\]/gi)];
      return matches.length > 0 ? matches[matches.length - 1][1] : description;
    };

    // Identify which characters are restricted from speaking. The newest
    // Director fact can explicitly reverse an older restriction.
    const isSilentChar = (c: any) => {
      const latestCanon = latestCharacterCanon(c).toLowerCase();
      if (/\b(?:can|may|should)\s+(?:speak|talk)|\bno longer\s+(?:silent|mute)|\b(?:speaks?|talks?)\s+normally\b/i.test(latestCanon)) {
        return false;
      }
      const desc = ((c?.role || "") + " " + latestCanon).toLowerCase();
      return /silent|stoic|mute|never speak|does not speak|doesn't speak|shouldn't speak/i.test(desc) ||
             (c?.name && loreText.includes(`${c.name.toLowerCase()} does not speak`)) ||
             (c?.name && loreText.includes(`${c.name.toLowerCase()} is silent`));
    };

    // Find a speaking character and any silent characters
    const speakingChars = chars.filter((c: any) => !isSilentChar(c));
    const silentChars = chars.filter((c: any) => isSilentChar(c));

    const promptLower = (userPrompt || "").toLowerCase();
    // Check if user specifically addressed or interacted with a named character
    let addressedChar = chars.find((c: any) => {
      if (!c?.name) return false;
      const parts = c.name.toLowerCase().split(/\s+/);
      return promptLower.includes(c.name.toLowerCase()) ||
        parts.some((part: string) => part.length >= 3 && new RegExp(`\\b${part}\\b`, "i").test(promptLower));
    }) || null;

    const activeSpeaker = (addressedChar && !isSilentChar(addressedChar))
      ? addressedChar.name
      : (speakingChars[0]?.name || (chars[0]?.name && !isSilentChar(chars[0]) ? chars[0].name : "Someone nearby"));

    const activeSilent = silentChars.length > 0 ? silentChars[0].name : null;
    const cleanPrompt = userPrompt.trim();

    // Check if user input is dialogue, action, or combined
    const dialogueMatch = cleanPrompt.match(/"([^"]+)"|“([^”]+)”/);
    let spokenText = dialogueMatch ? (dialogueMatch[1] || dialogueMatch[2]) : null;
    if (!spokenText && (/\?$/.test(cleanPrompt) || /^(say|ask|whisper|tell|demand|shout|call)\b/i.test(cleanPrompt) || (addressedChar && !/^\*[^*]+\*$/.test(cleanPrompt)))) {
      spokenText = cleanPrompt.replace(/^\*[^*]+\*,?\s*/, "").replace(/^["'\s]+|["'\s]+$/g, "");
    }

    const protectiveChar = chars.find((character: any) =>
      /\bprotective\b/i.test(latestCharacterCanon(character)) &&
      !/\b(?:not|no longer)\s+protective\b/i.test(latestCharacterCanon(character))
    );
    const shyChar = chars.find((character: any) =>
      /\b(?:shy|reserved|timid)\b/i.test(latestCharacterCanon(character)) &&
      !/\b(?:not|no longer)\s+(?:shy|reserved|timid)\b/i.test(latestCharacterCanon(character))
    );
    const otherCharacter = protectiveChar
      ? chars.find((character: any) => character?.name !== protectiveChar.name)
      : chars.find((character: any) => character?.name !== activeSpeaker);
    const relationshipBeat = protectiveChar && otherCharacter
      ? `${protectiveChar.name}${shyChar?.name === protectiveChar.name ? " hesitates at first, reserved and watchful, but" : ""} stays close to ${otherCharacter.name}, visibly protective without taking control away from them.`
      : /\bbest\s*friends?\b/i.test(combinedCanon) && chars.length >= 2
        ? `${chars[0].name} and ${chars[1].name} move with the instinctive familiarity of longtime best friends.`
        : chars.length === 1
          ? `${chars[0].name} stays close, watching the perimeter with quiet vigilance.`
          : `${chars.map((character: any) => character.name).filter(Boolean).slice(0, 2).join(" and ") || "Those present"} hold their ground with watchful wariness.`;

    const genreStr = `${book?.genre || ""} ${book?.setting || ""} ${book?.title || ""}`.toLowerCase();
    const isSciFi = /sci-fi|space|cyber|futur|station|star|orbit|ship|horizon|hull/i.test(genreStr);
    const isGothic = /gothic|victorian|mystery|detective|investigation|occult|archives|manor|estate|highgate|belvoir/i.test(genreStr);
    const isFantasy = /fantasy|magic|wizard|sorcer|sword|castle|dragon|alchem|realm/i.test(genreStr);

    // Genre-tailored sensory hooks and unexpected escalating ripples
    const sensoryRipple = isSciFi
      ? "Down the corridor, a pressurized valve lets out a sudden hydraulic hiss. The atmospheric scrubbers cycle with a low, thrumming shudder, and an auxiliary monitor blinks awake with an unacknowledged proximity alert."
      : isGothic
        ? "Outside, a sudden squall whips rain against the tall windowpanes, rattling the leaded glass. From somewhere deep in the foundation, the low groan of settling timber is answered by the sharp, distant snap of a closing iron latch."
        : isFantasy
          ? "The shadows along the stonework waver as an unnatural chill stirs the torchlight. Across the flagstones, a thin tracery of old dust swirls in an unseen draft, gathering around the threshold like iron filings to a lodestone."
          : "The air between them tightens with immediate consequence. In the distance, the heavy scrape of a closing gate echoes down the street, signaling that the window of opportunity is rapidly shutting.";

    // 1. User is speaking to a silent character
    if (spokenText && addressedChar && isSilentChar(addressedChar)) {
      const targetCharName = otherCharacter?.name || chars.find((c: any) => c?.name !== addressedChar?.name)?.name || "their companion";
      return `*The words hang in the cold air of ${settingText}.*

*${addressedChar.name} does not answer aloud—their silence is deliberate, unyielding, and absolute. Yet their eyes lock onto ${targetCharName} with sharp comprehension. With a slow, calculated motion, ${addressedChar.name} steps past into the corridor and gestures toward the darkened entryway, indicating that the move just initiated has already forced the next decision into play.*

*${sensoryRipple}*

*${relationshipBeat}*`;
    }

    // 2. Standard User dialogue
    const activeCharObj = chars.find((c: any) => c?.name === activeSpeaker) || addressedChar || speakingChars[0] || chars[0] || null;
    const toneRaw = String(activeCharObj?.voiceTone || book?.dialogueTone || "").toLowerCase();

    const isCasualTone = /casual|conversational|relaxed|modern|informal/i.test(toneRaw);
    const isPoeticTone = /poetic|lyrical|verse|melodic|bardic/i.test(toneRaw);
    const isFormalTone = /formal|aristocratic|stately|noble|courtly|proper|regal|high english/i.test(toneRaw);
    const isGrittyTone = /gritty|blunt|rough|hardboiled|street|clipped/i.test(toneRaw);
    const isScholarlyTone = /scholarly|analytical|academic|intellectual|scientific|logical/i.test(toneRaw);
    const isCrypticTone = /cryptic|whispering|mystic|riddle|prophet|shadowy/i.test(toneRaw);
    const isSarcasticTone = /sarcastic|witty|ironic|cynical|snarky/i.test(toneRaw);

    if (spokenText) {
      const isQuestion = /\?|\b(?:who|what|where|why|how|did|is|are|can|could|would|will|which)\b/i.test(spokenText);
      let activeNPCReply = "";

      if (isCasualTone) {
        activeNPCReply = isQuestion
          ? `"Look, you're asking the one thing everyone around here is trying to sweep under the rug," ${activeSpeaker} says, leaning in with a quick grin and lowering their voice. "The truth is, whoever pulled this off knew exactly what they were doing—and they left us holding the bag."`
          : `"Alright, yeah, I'm with you on that," ${activeSpeaker} replies with a nod, cracking their knuckles. "If we're really gonna do this, we better move before the whole block catches on."`;
      } else if (isPoeticTone) {
        activeNPCReply = isQuestion
          ? `"You seek the song the quiet earth refuses to sing," ${activeSpeaker} speaks, words falling like rain upon velvet, their gaze lingering on the trembling shadows. "The veil was not torn by chance; it was parted by an ancient longing, and the wound in the dark bleeds memory."`
          : `"Then let the stars bear witness to this hour," ${activeSpeaker} murmurs softly, a quiet reverie blooming in their eyes. "We step upon a thread of silver, where every breath is a vow and every shadow a slumbering verse."`;
      } else if (isFormalTone) {
        activeNPCReply = isQuestion
          ? `"You inquire into a matter that decorum—and the highest authorities—expressly forbade from public record," ${activeSpeaker} remarks with immaculate composure, adjusting their cuffs without haste. "I assure you, the records were not misplaced; they were expunged with deliberate, calculated precision."`
          : `"Very well. Your proposal is both prudent and entirely acceptable," ${activeSpeaker} replies with a dignified inclination of the head. "Let us proceed with the requisite discretion, lest untoward scrutiny compromise our objective."`;
      } else if (isGrittyTone) {
        activeNPCReply = isQuestion
          ? `"Cut the noise," ${activeSpeaker} snarls, spitting to the side and glancing toward the doorway. "You already know damn well who did it. The bastards took what they wanted, burned the rest, and left us to bleed."`
          : `"Done," ${activeSpeaker} grunts, checking the cylinder of their piece. "Quit talking and get moving. We got two minutes before this place crawls with trouble."`;
      } else if (isScholarlyTone) {
        activeNPCReply = isQuestion
          ? `"The inquiry is statistically inevitable, given the anomalous readings," ${activeSpeaker} notes, tracing an index finger across the schematics with precise focus. "Notice the fracture pattern: the stress was not externally applied, but synthesized from within the apparatus itself."`
          : `"The hypothesis holds, and empirical conditions favor immediate execution," ${activeSpeaker} states evenly, making a swift notation. "Provided our margin of error remains within acceptable bounds, this trajectory minimizes risk."`;
      } else if (isCrypticTone) {
        activeNPCReply = isQuestion
          ? `"The raven asks of the cage what the key has long forgotten," ${activeSpeaker} whispers from the hollow gloom, their smile thin and veiled. "Listen beneath the floorboards... it was never stolen. It was offered willingly to the dark."`
          : `"The thread is pulled, and the tapestry unravels," ${activeSpeaker} sibilates, fingers tracing an invisible circle in the dust. "Go forward, then. But do not look back when the mirror begins to answer."`;
      } else if (isSarcasticTone) {
        activeNPCReply = isQuestion
          ? `"Oh, fantastic question. Truly, a masterpiece of timing," ${activeSpeaker} says with an amused roll of their eyes. "Would you also like me to ask the assassins nicely if they'd mind waiting outside while we figure it out?"`
          : `"Brilliant plan. What could possibly go wrong besides, well, literally everything?" ${activeSpeaker} quips with a dry smirk, already checking the latch. "Lead the way, genius. I'll be right behind you taking notes for the eulogy."`;
      } else {
        activeNPCReply = isQuestion
          ? (isSciFi
              ? `"You're asking the one question the station log was wiped to hide," ${activeSpeaker} says under their breath, tapping a rapid override into their console. "Look at the power draw—someone didn't just take the data, they severed the telemetry lines from this exact deck."`
              : isGothic
                ? `"Lower your voice," ${activeSpeaker} warns, stepping closer as their eyes dart toward the transom above the door. "You're asking about the one ledger that was never entered into the public registry. Look closely at the desk—the lock wasn't picked. It was melted from the inside."`
                : isFantasy
                  ? `"Because the sigil was broken before nightfall," ${activeSpeaker} answers grimly, a hand resting on their scabbard. "The seal didn't shatter on its own. Someone on our side gave them the pass-phrase."`
                  : `"You know the answer as well as I do," ${activeSpeaker} murmurs, tension hard in their jaw. "The moment we spoke that name aloud, we gave up the luxury of retreat. We have maybe three minutes before their watchers report in."`)
          : (isSciFi
              ? `"Acknowledged. Setting the trajectory now," ${activeSpeaker} replies, their fingers moving without hesitation across the control interface. "If we're breaching that sector, we need to move before their automated quarantine protocol kicks in."`
              : isGothic
                ? `"Then it's settled," ${activeSpeaker} says, voice low and resolute as they button their heavy wool coat against the draft. "We take the eastern passageway before the night watch changes. But take heed: whatever is buried in that archive, it won't remain quiet once disturbed."`
                : isFantasy
                  ? `"So be it," ${activeSpeaker} whispers, their eyes catching the amber glow of the fire. "We take the road through the lower pass. Draw your steel, and don't trust any shadow that moves against the wind."`
                  : `"Consider it done," ${activeSpeaker} says, stepping into motion with decisive focus. "We follow through on this right now, before anyone has the chance to organize a counter-move."`);
      }

      return `*The words hang in the air of ${settingText}, demanding an immediate answer.*

${activeNPCReply}

*${sensoryRipple}*

*${relationshipBeat}${activeSilent ? ` ${activeSilent} stays watchful at the perimeter, communicating urgency through a sharp, warning nod.` : ""}*`;
    }

    // 3. User action or narrative directive
    const actionClean = cleanPrompt.replace(/^[*_]|[*_]$/g, "").trim();
    const actionDesc = actionClean.length > 0
      ? (actionClean.charAt(0).toUpperCase() + actionClean.slice(1)).replace(/\.+$/, "")
      : "The decisive step is taken";

    let reactionDialogue = "";
    if (isCasualTone) {
      reactionDialogue = `"Whoa, hey, that actually worked," ${activeSpeaker} laughs, shaking their head in disbelief. "Don't just stand there staring—come on, grab your gear before someone notices!"`;
    } else if (isPoeticTone) {
      reactionDialogue = `"Behold how swiftly destiny answers," ${activeSpeaker} breathes, as if watching petals scatter on water. "The seal has broken, and from its ashes, the dawn of something untamed begins to stir."`;
    } else if (isFormalTone) {
      reactionDialogue = `"An impressive execution," ${activeSpeaker} observes, tone calm yet unmistakably impressed. "The obstacle has been decisively removed. I suggest we capitalize upon this advantage forthwith."`;
    } else if (isGrittyTone) {
      reactionDialogue = `"Down, now!" ${activeSpeaker} barks, slamming a shoulder against the frame to hold the line. "Door's kicked in, but the real fight just started. Move your feet!"`;
    } else if (isScholarlyTone) {
      reactionDialogue = `"Fascinating," ${activeSpeaker} murmurs, eyes scanning the immediate physical aftermath. "The kinetic transfer exceeded initial calculations by roughly thirty percent. We must document the structural variance immediately."`;
    } else if (isCrypticTone) {
      reactionDialogue = `"It is awakened," ${activeSpeaker} breathes, cold eyes gleaming from beneath the cowl. "The seal splits, and the bell tolls for what sleeps beneath. Walk softly... it is already listening."`;
    } else if (isSarcasticTone) {
      reactionDialogue = `"Well, look at that. You didn't blow us both up," ${activeSpeaker} remarks with a theatrical slow clap. "Ten points for style, zero points for stealth. Shall we take a bow before the guards arrive, or run?"`;
    } else {
      reactionDialogue = isSciFi
        ? `"Breach confirmed," ${activeSpeaker} reports, their pulse rifle coming up to cover the sector. "Look at the bulkhead seam—that mechanism just tripped an encrypted sequence. We've got company coming down the service shaft."`
        : isGothic
          ? `"By the saints," ${activeSpeaker} breathes, stepping in to examine the immediate result. "Look at what was concealed behind the panel—the wax is still warm. Someone was standing right here moments before we entered."`
          : isFantasy
            ? `"It's done," ${activeSpeaker} whispers, breath rising white against the cold air as they draw their blade. "The barrier yielded. But listen—the wards on the upper parapet are vibrating. They know we've broken through."`
            : `"That did it," ${activeSpeaker} says, voice tight with adrenaline as they secure the flank. "The advantage is ours, but only if we push through right now before they recover."`;
    }

    return `*${actionDesc}. The physical momentum jolts through ${settingText}, triggering an immediate chain reaction.*

${reactionDialogue}

*${sensoryRipple}*

*${relationshipBeat}${activeSilent ? ` ${activeSilent} keeps their silence, hands ready and eyes tracking the doorway for the immediate backlash.` : ""}*`;
  }

  // Graceful storytelling passage rewrite generator with deep instruction understanding
  function createFallbackRewrite(passage: string, instruction?: string, book?: any): string {
    const cleanPassage = passage.trim();
    const inst = (instruction || "").trim();
    const instLower = inst.toLowerCase();

    // Extract character names from book or common names
    const knownCharNames: string[] = [];
    if (book && Array.isArray(book.characters)) {
      for (const c of book.characters) {
        if (c?.name) knownCharNames.push(c.name);
      }
    }

    // Check if any character is explicitly directed not to speak or to stay silent
    const silenceRegex = /(?:shouldn'?t|don'?t|do not|never|stop|not|won'?t|doesn'?t|does not)\s+(?:speak|talk|say|utter|interject|open (?:his|her|their) mouth)|(?:silent|quiet|mute|stoic|taciturn|stop talking|no dialogue)/i;
    const isSilenceDirective = silenceRegex.test(instLower);

    let silentCharName: string | null = null;
    if (isSilenceDirective) {
      // Find which character was mentioned in the instruction
      for (const name of knownCharNames) {
        if (instLower.includes(name.toLowerCase())) {
          silentCharName = name;
          break;
        }
      }
      // If not in known chars, extract capitalized word preceding shouldn't/doesn't/etc.
      if (!silentCharName) {
        const nameMatch = inst.match(/([A-Z][a-z]+)\s+(?:shouldn'?t|doesn'?t|does not|never|won'?t|is not|to be)/);
        if (nameMatch) {
          silentCharName = nameMatch[1];
        } else {
          // Check for any capital word in the instruction
          const words = inst.split(/\s+/);
          for (const w of words) {
            const cleanW = w.replace(/[^a-zA-Z]/g, "");
            if (cleanW.length > 2 && /^[A-Z]/.test(cleanW) && !["The", "Make", "Let", "Have", "When", "Because", "Please"].includes(cleanW)) {
              silentCharName = cleanW;
              break;
            }
          }
        }
      }
    }

    // 1. SILENCE DIRECTIVE REWRITE
    if (isSilenceDirective && silentCharName) {
      // Strip dialogue spoken by the silent character and replace with tense silent actions
      const paragraphs = cleanPassage.split(/\n\s*\n/).filter(Boolean);
      const transformedParagraphs: string[] = [];

      for (const p of paragraphs) {
        const hasQuotes = /"[^"]+"|“[^”]+”/.test(p);
        const mentionsChar = p.toLowerCase().includes(silentCharName.toLowerCase());

        if (mentionsChar && hasQuotes) {
          // Replace dialogue with stoic silence
          transformedParagraphs.push(
            `*${silentCharName} remains entirely silent. His expression is cold and guarded as his gaze sweeps the room, refusing to utter a single word. A subtle, sharp tilt of his head toward the door conveys all the urgency that words never could.*`
          );
        } else if (hasQuotes) {
          // Keep other dialogue or adjust to acknowledge the silence
          transformedParagraphs.push(p);
        } else {
          transformedParagraphs.push(p);
        }
      }

      if (transformedParagraphs.length === 0 || !transformedParagraphs.some(p => p.includes(silentCharName!))) {
        transformedParagraphs.push(
          `*${silentCharName} does not speak. He stands in absolute stillness against the darkened wood, his jaw tight and hands resting motionless. The silence between them carries a profound, unspoken weight.*`
        );
      }

      return transformedParagraphs.join("\n\n");
    }

    // 2. ATMOSPHERIC / DARK / TENSION DIRECTIVE
    if (/dark|tension|danger|intense|atmospheric|scary|horror|creepy|shadow/i.test(instLower)) {
      return `*The ambient light dims to a cold, suffocating twilight. A sudden chill sweeps through the cracks in the walls, carrying the metallic scent of damp earth and approaching danger.*

*Breath catches in the throat as shadows along the floor stretch and twist.*

"Listen," a voice whispers with razor-sharp urgency from the gloom. "Do not move, and do not make a sound. Whatever is out there... it has already picked up our trail."

*The silence that follows is heavy enough to break, wound tight with anticipation of what comes next.*`;
    }

    // 3. ACTION / COMBAT / URGENT DIRECTIVE
    if (/action|fight|combat|run|chase|urgent|fast|attack|strike|shatter/i.test(instLower)) {
      const activeFighter = knownCharNames[0] || "The fighter";
      return `*The sudden roar of splintering wood shatters the tense calm. In an instant, the scene erupts into blinding, heart-pounding motion.*

*Boot heels skid across the floor as a sudden strike shears through the air, sending shards of glass and dust scattering across the stones.*

"Move! Now!" comes the shouted command above the chaos, followed by the hard scrape of steel against iron.

*${activeFighter} pivots on a heel, dodging the incoming impact as the corridor collapses into sheer adrenaline and fast-paced instinct.*`;
    }

    // TONE-SPECIFIC REWRITE DIRECTIVES
    if (/poetic|lyrical|verse|ornate|melodic/i.test(instLower)) {
      const speaker = knownCharNames[0] || "A soft voice";
      return `*The passage dissolves into shimmering lyricism. Moonlight spills across the flagstones like liquid silver, draping the room in quiet reverie.*

"Look how the night holds its breath for us," ${speaker} whispers, voice laden with melancholic beauty. "Every step we take is an echo carved into the marrow of time, unmaking the sorrows that came before."

*The shadows gently sway, as if the very stones were humming an ancient lullaby of remembrance and longing.*`;
    }

    if (/formal|aristocratic|stately|noble|high english|decorum|proper english/i.test(instLower)) {
      const speaker = knownCharNames[0] || "An esteemed voice";
      return `*Courtly decorum settles over the chamber. Every posture straightens; every movement adheres to the exacting standards of high society.*

"We shall conduct ourselves with the utmost propriety," ${speaker} states with measured, unyielding composure, inclining their head. "The gravity of this juncture admits of neither hesitation nor vulgar haste."

*The grandfather clock tolls with stately resonance, casting an aura of ancestral dignity across the polished wood.*`;
    }

    if (/casual|conversational|modern|relaxed|informal|colloquial/i.test(instLower)) {
      const speaker = knownCharNames[0] || "Someone nearby";
      return `*The stiffness drains from the room, replaced by an easy, relaxed rhythm.*

"Hey, don't sweat it too much," ${speaker} says with an easy chuckle, leaning back and tossing a small coin into the air. "We've gotten out of way worse messes than this. Let's just grab a bite and figure it out on the fly."

*Outside, the low buzz of street banter drifts through the open window, grounding the moment in comfortable ease.*`;
    }

    if (/gritty|blunt|harsh|street|hardboiled|rough/i.test(instLower)) {
      const speaker = knownCharNames[0] || "A gravelly voice";
      return `*The atmosphere turns harsh and raw, thick with grease, smoke, and cold sweat.*

"Quit stalling," ${speaker} growls, knuckles white around a bruised pipe. "The clock's ticking, the street's blocked, and nobody's coming to save our skins. We push through now or we don't push through at all."

*Rain slashes sideways through the broken slats, stinging like needles against bare skin.*`;
    }

    if (/scholarly|analytical|academic|scientific|logical/i.test(instLower)) {
      const speaker = knownCharNames[0] || "The observer";
      return `*A clinical, observant stillness pervades the scene as every detail is scrutinized.*

"The deductive correlation is unmistakable," ${speaker} remarks, making a swift calculation in the margins of a weathered notebook. "When we isolate the external variables, the only tenable conclusion points directly toward this threshold."

*The steady scratching of a nib against vellum marks the orderly progression of reason against the chaotic dark.*`;
    }

    if (/cryptic|whisper|eerie|mysterious|riddle/i.test(instLower)) {
      const speaker = knownCharNames[0] || "A veiled silhouette";
      return `*The lantern light gutters down to a smoky ember. The chill of the crypt slips beneath the door, smelling of dust and centuries.*

"The lock was never locked," ${speaker} whispers, an eerie smile flickering in the gloom. "The door was waiting for hands that bear the mark. You opened it... but do you know what followed you inside?"

*A cold breath brushes the nape of the neck, though the air in the chamber is dead calm.*`;
    }

    if (/sarcastic|witty|snarky|dry humor|cynical|ironic/i.test(instLower)) {
      const speaker = knownCharNames[0] || "A cynical voice";
      return `*The tension is punctured by a dry, theatrical groan that echoes off the walls.*

"Oh, marvelous. Truly, a five-star operation," ${speaker} quips, brushing ash from their lapel with exaggerated care. "Remind me to thank you personally for choosing the only route guaranteed to end in spectacular disaster."

*They offer a half-hearted salute before checking the lock with a smirk.*`;
    }

    // 4. CUSTOM INSTRUCTION DIRECTIVE
    if (inst.length > 5) {
      const cleanInst = inst.replace(/[".]/g, "").trim();
      const actionSubject = cleanInst.charAt(0).toUpperCase() + cleanInst.slice(1);
      const speaker = knownCharNames[0] || "A nearby presence";
      const secondChar = knownCharNames[1] || null;

      return `*${actionSubject}. The physical momentum cuts through the room, leaving no doubt that the move has been made.*

*The surrounding atmosphere tightens as the immediate impact uncovers a deeper, unforeseen complication.*

"Look closely," ${speaker} whispers, stepping forward with heightened wariness as the dust settles. "What happened just now... it didn't just clear our path. It woke up whatever was waiting behind the wall."

*${secondChar ? `${secondChar} moves into a defensive flank, eyes locked on the shadows ahead.` : "A low, mechanical tremor vibrates through the floor, signaling that the next wave of events is already in motion."}*`;
    }

    // 5. GENERAL HIGH-CRAFT REROLL (Dynamic varied options)
    const charName = knownCharNames[0] || "A presence";
    const secondName = knownCharNames[1] || null;

    const variations = [
      `*A tense stillness descends over the room as the moment hangs in the balance. The faint amber glow of the lantern flickers against the damp plaster walls, casting long, wavering silhouettes across the floor.*

"There is no turning back from this threshold," ${charName} remarks, the words measured with deliberate weight. "Once the seals are broken, we take responsibility for whatever answers we uncover."

*${secondName ? `${secondName} glances toward the window, watching the mist roll silently down the street.` : `A sudden gust rattles the iron fixtures outside, underscoring the gravity of the road ahead.`}*`,

      `*The floorboards groan underfoot as the silence stretches between them. A cool draft seeps through the doorframe, carrying the faint scent of rain and old soot.*

"Keep your focus sharp," ${charName} murmurs, stepping forward with cautious vigilance. "If we move now, the night is on our side. Hesitate, and the opportunity is gone."

*${secondName ? `${secondName} nods quietly, fingers resting lightly on the hilt of a hidden blade.` : `Shadows lengthen along the hallway, framing the path forward into the unknown.`}*`,

      `*A sudden rustle of parchment cuts through the quiet room. ${charName} pauses, eyes narrowing as they survey the surrounding space.*

"Something about this room has changed since we arrived," ${charName} says in a hushed, guarded tone. "Look at the dust disturbed near the threshold."

*${secondName ? `Beside ${charName}, ${secondName} stiffens, catching the subtle shift in the air before anyone else can react.` : `The candle flame dips low, casting jittery patterns across the ceiling before righting itself.`}*`,

      `*The heavy atmosphere tightens as an unspoken understanding passes between them. The ticking of a grandfather clock in the next hall echoes like slow footsteps approaching.*

"We cannot afford another delay," ${charName} whispers, turning with resolute determination. "Whatever is waiting on the other side of that door, we face it together."

*${secondName ? `${secondName} gives a sharp, decisive nod, bracing for the next move.` : `A sharp creak from above warns that time is slipping away fast.`}*`
    ];

    const randomIndex = Math.floor(Math.random() * variations.length);
    return variations[randomIndex];
  }


  // Health check endpoint
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  // Auto-generate book concept from an idea
  app.post("/api/generate-book", async (req, res) => {
    const { idea } = req.body;
    if (!idea || typeof idea !== "string" || !idea.trim()) {
      return res.status(400).json({ error: "Please provide an idea for the book." });
    }

    const explicitCharacterNames = extractExplicitCharacterNames(idea);
    const explicitCharacterInstruction = explicitCharacterNames.length > 0
      ? `The author explicitly named these people: ${explicitCharacterNames.join(", ")}. Preserve every full name EXACTLY as written. Include all of them in the characters array. Do not rename, omit, merge, or replace them. Do not add other named characters to the cast unless the author explicitly named them in the premise.`
      : "The author did not explicitly name anyone. You may create characters appropriate to the premise.";

    const client = getGeminiClient();
    if (!client) {
      // If no API key configured, generate a high-quality template book concept
      return res.json({
        book: createFallbackBookFromIdea(idea),
        note: "Created using default literary template (GEMINI_API_KEY not set).",
      });
    }

    const prompt = `You are the Master Narrator and Living World-Weaver.
An author has entrusted you with their creative idea:
"${idea.trim()}"

YOUR SACRED MISSION AS THE NARRATOR:
Take this raw creative spark and BREATHE PULSING, VIVID LIFE INTO IT.
Transform the author's vision into a living, breathing literary universe—grounded with rich sensory atmosphere, compelling characters with real agency, and an electrifying opening prologue that immediately plunges the reader into the story.

CRITICAL CHARACTER & CAST MANDATE:
- The "characters" array MUST ONLY contain actual living, sentient human or creature characters (e.g. students, professors, detectives, travelers, friends, rivals).
- ABSOLUTE BAN ON INANIMATE LOCATIONS AS CHARACTERS:
  NEVER EVER create a character out of a school, academy, university, college, building, city, hospital, organization, or inanimate location mentioned in the premise!
  For example, if the author mentions "St. Jude Academy" or "London", that is the SETTING, NEVER a character in the cast!
- ${explicitCharacterInstruction}
- Every character in the "characters" array MUST have an authentic, distinctive, evocative proper name (e.g., 'Julian Mercer', 'Captain Kaelen Thorne', 'Evelyn Cross', 'Silas Kane').
- In the "prologue" and "synopsis", write STRICTLY in the third person. Refer to characters ONLY by their actual proper names or third-person pronouns ('he', 'she', 'they')—NEVER use second-person 'you' in narration, and NEVER use the word 'protagonist'.
- ABSOLUTE BAN ON AI WRITING CLICHÉS & REPETITION: Strictly forbid exhausted tropes ("breath they didn't know they were holding", "stands as a testament", "rich tapestry of", "shiver down spine", "little did they know", "deadly dance", "tension was palpable", "delve into"). Strictly avoid word repetition, echo vocabulary, or looped sentence structures. Keep it tactile, sensory, varied, and grounded.

Output MUST be a single valid JSON object with EXACTLY this structure:
{
  "title": "A captivating, evocative book title born from the author's idea",
  "subtitle": "An evocative subtitle or genre flavor (e.g. 'A Victorian Alchemical Mystery' or 'Chronicles of the Deep Nebula')",
  "setting": "Sensory, visceral description of the era, location, weather, and atmosphere that makes the world feel alive",
  "dialogueTone": "Overarching dialogue tone: 'Casual & Conversational', 'Poetic & Lyrical', 'Formal & Aristocratic', 'Gritty & Blunt', 'Scholarly & Analytical', 'Cryptic & Whispering', or 'Sarcastic & Witty'",
  "synopsis": "A compelling 2-3 sentence overview of the core mystery, stakes, and narrative premise. Written strictly in the third person, referring to characters by their proper names.",
  "prologue": "A vivid, gritty opening scene (2-3 paragraphs separated by newlines) that immerses the reader into the story. Written strictly in the third person ('he', 'she', 'they', or proper names; never 'you' in narration). The lead characters are present by their proper names, surrounded by dynamic background NPCs reacting to the world. Zero repetition of phrases or crutch words. Use simple accessible English, natural dialogue, zero gaming terminology (no HP, stats, or game words), asterisks for physical actions (*rain taps against the rusted iron*), and quotation marks for spoken dialogue (\"Get inside before they spot us,\" she whispers). NEVER write the word 'protagonist'.",
  "coverColor": "Pick the most fitting hex from: #7a282f (Burgundy), #1e3a5f (Navy), #2d4b3e (Spruce), #2c2c2e (Charcoal), #633924 (Mahogany), #44337a (Plum), #744210 (Ochre)",
  "coverIcon": "Pick the most fitting from: BookOpen, Feather, Compass, Scroll, Sparkles, Shield, Coffee",
  "characters": [
    {
      "name": "Actual distinctive proper name of a living person (e.g. Julian Mercer)",
      "role": "Their role or position in the story (e.g. Lead Investigator / Master Alchemist / Student)",
      "description": "1-2 sentences on their personality, appearance, or background in this book",
      "voiceTone": "Character voice tone: 'Casual & Conversational', 'Poetic & Lyrical', 'Formal & Aristocratic', 'Gritty & Blunt', 'Scholarly & Analytical', 'Cryptic & Whispering', or 'Sarcastic & Witty'"
    }
  ]
}

${explicitCharacterNames.length > 0
  ? `The characters array must contain the explicitly named people (${explicitCharacterNames.join(', ')}) and other living cast members relevant to the opening scene. Do not create characters out of locations or buildings.`
  : "Provide 2 to 4 distinctive living characters in the characters array who are relevant to the opening scene. Never create a character out of a location or school."}
IMPORTANT: Respond with ONLY the raw JSON object, without markdown code fences or other text.`;

    try {
      const rawOutput = await generateWithModelFallback(client, {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        temperature: 0.85,
        topP: 0.95,
        responseMimeType: "application/json",
      });

      const bookData = safeParseJsonObject(rawOutput);

      // Sanitize characters to ensure no placeholder names or non-person entities slip through
      const rawChars = Array.isArray(bookData.characters) ? bookData.characters : [];
      let validPersons = rawChars
        .filter((c: any) => {
          const name = (c?.name || "").trim();
          if (!name) return false;
          // Strictly discard any character whose name or role matches an institution or location
          if (isNonPersonName(name)) return false;
          const role = (c?.role || "").toLowerCase();
          if (isNonPersonName(role) && !/student|teacher|principal|headmaster|doctor|nurse|scholar|professor|investigator|detective/i.test(role)) {
            return false;
          }
          return true;
        })
        .map((c: any, index: number) => {
          let name = (c?.name || "").trim();
          if (!name || /^[Tt]he\s+[Pp]rotagonist$|^[Pp]rotagonist$|^[Mm]ain\s+[Cc]haracter$|^[Tt]he\s+[Hh]ero$/i.test(name)) {
            name = index === 0 ? "Julian Cross" : (index === 1 ? "Evelyn Ward" : `Companion ${index + 1}`);
          }
          return {
            name,
            role: c?.role ? String(c.role).trim() : "Dramatis Persona",
            description: c?.description ? String(c.description).trim() : "An active figure in this story.",
            voiceTone: c?.voiceTone ? String(c.voiceTone).trim() : (bookData.dialogueTone || "Casual & Conversational"),
          };
        });

      // If author explicitly named human characters that weren't captured by Gemini, make sure they are present
      for (const explicitName of explicitCharacterNames) {
        if (!isNonPersonName(explicitName)) {
          const alreadyPresent = validPersons.some(
            (p) =>
              p.name.toLowerCase() === explicitName.toLowerCase() ||
              p.name.toLowerCase().includes(explicitName.toLowerCase()) ||
              explicitName.toLowerCase().includes(p.name.toLowerCase())
          );
          if (!alreadyPresent) {
            validPersons.unshift({
              name: explicitName,
              role: /\b(?:college|university|school|academy|campus)\b/i.test(idea) ? "Student" : "Central Character",
              description: "A central character established in the author's original premise.",
              voiceTone: "Casual & Conversational",
            });
          }
        }
      }

      // Ensure at least 2 distinct human characters exist
      if (validPersons.length === 0) {
        validPersons = [
          {
            name: "Julian Cross",
            role: /\b(?:college|university|school|academy|campus)\b/i.test(idea) ? "Lead Student" : "Lead Protagonist",
            description: "A determined figure navigating the events of the premise.",
            voiceTone: "Casual & Conversational",
          },
          {
            name: "Evelyn Ward",
            role: /\b(?:college|university|school|academy|campus)\b/i.test(idea) ? "Fellow Student" : "Companion",
            description: "A sharp-witted peer at the center of the story.",
            voiceTone: "Sarcastic & Witty",
          },
        ];
      } else if (validPersons.length === 1) {
        validPersons.push({
          name: validPersons[0].name.toLowerCase().includes("evelyn") ? "Julian Cross" : "Evelyn Ward",
          role: /\b(?:college|university|school|academy|campus)\b/i.test(idea) ? "Fellow Student" : "Companion",
          description: `Close companion and counterpart to ${validPersons[0].name}.`,
          voiceTone: "Sarcastic & Witty",
        });
      }

      const sanitizedChars = validPersons;

      const rawPrologue =
        bookData.prologue ||
        `*The binding opens to reveal the first crisp pages of the story. The atmosphere settles into quiet focus.*`;
      const rawSynopsis = bookData.synopsis || idea.trim();

      const tempBook = {
        title: bookData.title || "The Unwritten Folio",
        characters: sanitizedChars,
      };

      return res.json({
        book: {
          title: bookData.title || "The Unwritten Folio",
          subtitle: bookData.subtitle || "A Tale Conceived in Silence",
          setting: bookData.setting || "An uncharted realm awaiting exploration.",
          dialogueTone: bookData.dialogueTone || "Casual & Conversational",
          synopsis: sanitizeNarrativeOutput(rawSynopsis, tempBook),
          prologue: sanitizeNarrativeOutput(rawPrologue, tempBook),
          coverColor: bookData.coverColor || "#7a282f",
          coverIcon: bookData.coverIcon || "BookOpen",
          characters: sanitizedChars,
        },
      });
    } catch (error: any) {
      const status = error?.status || error?.code || "unknown";
      const message = String(error?.message || "Unknown Gemini error")
        .replace(process.env.GEMINI_API_KEY || "__no_key__", "[redacted]")
        .slice(0, 300);
      console.warn(`[Book Generator API] Gemini failed (${status}): ${message}`);
      // Graceful fallback prevents the user from being blocked by temporary upstream 503 spikes
      return res.json({
        book: createFallbackBookFromIdea(idea),
        fallbackUsed: true,
        note: "Gemini was unavailable, so this draft was built directly from your premise without inventing replacement characters.",
      });
    }
  });

  // Heuristic director fallback in case of transient API unavailability
  function heuristicDirectorUpdate(
    book: any,
    instruction: string,
    attachments?: any[],
    reasoningLevel: "off" | "medium" | "high" = "medium"
  ) {
    const raw = (instruction || "").trim();
    const text = raw.toLowerCase();
    const updatedChars: Array<{ name: string; role: string; description: string; voiceTone?: string }> = [];
    const addedChars: Array<{ name: string; role: string; description: string; voiceTone?: string }> = [];
    let updatedSetting: string | null = null;
    let updatedSynopsis: string | null = null;
    let updatedLore: string | null = null;
    const actionsTaken: string[] = [];

    const existingChars = Array.isArray(book.characters) ? book.characters : [];

    const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const aliasesFor = (name: string) => {
      const parts = name.trim().split(/\s+/).filter(Boolean);
      const aliases = [name.trim()];
      if (parts[0]?.length >= 3) aliases.push(parts[0]);
      if (parts.length > 1 && parts[parts.length - 1].length >= 3) {
        aliases.push(parts[parts.length - 1]);
      }
      return [...new Set(aliases.map((alias) => alias.toLowerCase()))];
    };

    const aliasUseCounts = new Map<string, number>();
    existingChars.forEach((character: any) => {
      if (!character?.name) return;
      aliasesFor(character.name).forEach((alias) => {
        aliasUseCounts.set(alias, (aliasUseCounts.get(alias) || 0) + 1);
      });
    });

    const mentionedChars = existingChars.filter((character: any) => {
      if (!character?.name) return false;
      return aliasesFor(character.name).some((alias) => {
        if (alias !== character.name.toLowerCase() && aliasUseCounts.get(alias)! > 1) {
          return false;
        }
        return new RegExp(`\\b${escapeRegex(alias)}\\b`, "i").test(raw);
      });
    });

    const isQuestion = /\?\s*$/.test(raw) ||
      /^\s*(?:who|what|when|where|why|how|does|do|did|is|are|was|were|can|could|would)\b/i.test(raw);
    const isGreeting = /^\s*(?:hi|hello|hey|hiya|good\s+(?:morning|afternoon|evening)|greetings)[\s!.,?]*$/i.test(raw);
    const isAcknowledgement = /^\s*(?:thanks?|thank\s+you|okay|ok|got\s+it|cool|nice)[\s!.,?]*$/i.test(raw);
    const hasChangeLanguage = /\b(?:add|introduce|create|include|make|change|set|establish|remember|keep|ensure|must|never|should|will|becomes?|remove|rewrite|update|treat|want|need|enforce|ban|stop)\b/i.test(raw);
    const establishesCharacterFact = mentionedChars.length > 0 &&
      /\b(?:is|are|was|were|has|have|likes?|loves?|hates?|knows?|works?|studies?|lives?|speaks?|cannot|can't|doesn'?t|friend|sibling|parent|child|teacher|student)\b/i.test(raw);
    const establishesWorldFact = /\b(?:setting|world|lore|rule|tone|weather|atmosphere|magic|technology|history|secret|relationship|plot|synopsis|chapter|third\s*person|perspective|repetition|cliche)\b/i.test(raw);
    const isChangeDirective = !isGreeting && !isAcknowledgement &&
      (hasChangeLanguage || establishesCharacterFact || establishesWorldFact);

    if (isGreeting || isAcknowledgement) {
      return {
        reply: isGreeting
          ? "Hello. What would you like to establish, correct, or change in this book?"
          : "Understood. Tell me whenever you want to adjust a character, relationship, world fact, or story direction.",
        updates: {
          charactersToUpdate: [],
          charactersToAdd: [],
          setting: null,
          synopsis: null,
          loreNotes: null,
          dialogueTone: null,
        },
        thought: null,
        fallbackUsed: true,
        note: "Conversational message only; no book canon was changed.",
      };
    }

    if (!isChangeDirective) {
      const relevantFacts = mentionedChars.length > 0
        ? mentionedChars
            .map((character: any) => `• ${character.name} (${character.role || "Character"}): ${character.description || "No additional facts recorded."}`)
            .join("\n")
        : `Setting: ${book.setting || "Unspecified"}\nDialogue Tone: ${book.dialogueTone || "Casual & Conversational"}\nLore: ${book.loreNotes || "No additional canon recorded."}`;

      return {
        reply: `Here is what the current book canon records:\n\n${relevantFacts}`,
        updates: {
          charactersToUpdate: [],
          charactersToAdd: [],
          setting: null,
          synopsis: null,
          loreNotes: null,
          dialogueTone: null,
        },
        thought: reasoningLevel === "off"
          ? null
          : "Reviewed the stored book facts without changing the manuscript.",
        fallbackUsed: true,
        note: "Answered from the book's locally stored canon because Gemini was unavailable.",
      };
    }

    // 1. Check for New Character Creation
    const addIntent = /\b(?:add|introduce|create|include)\b/i.test(raw) && /\bcharacter\b/i.test(raw);
    const namedIndex = raw.search(/\b(?:named|called)\s+/i);
    const namedTail = namedIndex >= 0
      ? raw.slice(namedIndex).replace(/^.*?\b(?:named|called)\s+/i, "")
      : "";
    const explicitNameMatch = namedTail.match(/^([A-Z][A-Za-z'’\-]*(?:\s+(?:(?:de|del|della|di|da|dos|du|la|le|van|von|der|den|bin|al)\s+)?[A-Z][A-Za-z'’\-]*){0,4})/);

    if (addIntent && explicitNameMatch) {
      const charName = explicitNameMatch[1].trim();
      const roleMatch = raw.match(/\bcharacter\s*:\s*(?:an?\s+)?(.+?)\s+(?:named|called)\b/i);
      const details = roleMatch?.[1]?.trim() || raw;
      const exists = existingChars.some((c: any) => c.name.toLowerCase() === charName.toLowerCase());
      if (!exists) {
        const role = details.length < 60 ? details : "New Character";
        let newVoiceTone = "Casual & Conversational";
        if (/poetic|lyrical/i.test(text)) newVoiceTone = "Poetic & Lyrical";
        else if (/formal|aristocratic/i.test(text)) newVoiceTone = "Formal & Aristocratic";
        else if (/gritty|blunt/i.test(text)) newVoiceTone = "Gritty & Blunt";
        else if (/scholarly|analytical/i.test(text)) newVoiceTone = "Scholarly & Analytical";
        else if (/cryptic|whispering/i.test(text)) newVoiceTone = "Cryptic & Whispering";
        else if (/sarcastic|witty/i.test(text)) newVoiceTone = "Sarcastic & Witty";

        addedChars.push({
          name: charName,
          role: role,
          description: `Established by the Director: ${raw}`,
          voiceTone: newVoiceTone,
        });
        actionsTaken.push(`Created new character profile for **${charName}** (${role}) [Voice: ${newVoiceTone}]`);
      }
    }

    // 2. Check for Existing Character Updates / Relationship / Silence directives
    mentionedChars.forEach((c: any) => {
        let updatedRole = c.role || "Character";
        let updatedDesc = c.description || "";
        let updatedVoiceTone = c.voiceTone || "Casual & Conversational";

        if (/\b(?:voice|tone|speech|speak|dialogue)\b/i.test(text) || /\b(?:casual|poetic|formal|gritty|scholarly|cryptic|sarcastic)\b/i.test(text)) {
          if (/poetic|lyrical/i.test(text)) updatedVoiceTone = "Poetic & Lyrical";
          else if (/formal|aristocratic/i.test(text)) updatedVoiceTone = "Formal & Aristocratic";
          else if (/casual|conversational/i.test(text)) updatedVoiceTone = "Casual & Conversational";
          else if (/gritty|blunt/i.test(text)) updatedVoiceTone = "Gritty & Blunt";
          else if (/scholarly|analytical/i.test(text)) updatedVoiceTone = "Scholarly & Analytical";
          else if (/cryptic|whispering/i.test(text)) updatedVoiceTone = "Cryptic & Whispering";
          else if (/sarcastic|witty/i.test(text)) updatedVoiceTone = "Sarcastic & Witty";

          if (updatedVoiceTone !== c.voiceTone) {
            actionsTaken.push(`Updated voice tone to **${updatedVoiceTone}** for **${c.name}**`);
          }
        }

        const silenceDirective = /(?:shouldn'?t|don'?t|do not|never|stop|not|won'?t|doesn'?t|does not)\s+(?:speak|talk|say|utter)|(?:\bsilent\b|\bmute\b)/i;
        const restoresSpeech = /\b(?:can|may|should)\s+(?:speak|talk)|\bno longer\s+(?:silent|mute)|\b(?:speaks?|talks?)\s+normally\b/i.test(text);
        const targetsSilence = silenceDirective.test(text) &&
          (mentionedChars.length === 1 || aliasesFor(c.name).some((alias) =>
            new RegExp(`\\b${escapeRegex(alias)}\\b[^.!?]{0,80}${silenceDirective.source}`, "i").test(raw)
          ));

        if (restoresSpeech) {
          updatedRole = updatedRole.replace(/\s*\(Silent \/ Stoic\)/gi, "").trim();
          const speechFact = `[Director Canon: ${raw}]`;
          if (!updatedDesc.toLowerCase().includes(speechFact.toLowerCase())) {
            updatedDesc = `${updatedDesc} ${speechFact}`.trim();
          }
          actionsTaken.push(`Restored normal speech behavior for **${c.name}**`);
        } else if (targetsSilence) {
          updatedRole = `${updatedRole} (Silent / Stoic)`.replace(/\(Silent \/ Stoic\).*/, "(Silent / Stoic)");
          const silenceFact = `[Director Canon: ${c.name} does not speak aloud and communicates nonverbally.]`;
          if (!updatedDesc.toLowerCase().includes(silenceFact.toLowerCase())) {
            updatedDesc = `${updatedDesc} ${silenceFact}`.trim();
          }
          actionsTaken.push(`Enforced strict silence and stoic behavior on **${c.name}**`);
        } else {
          const canonFact = `[Director Canon: ${raw}]`;
          if (!updatedDesc.toLowerCase().includes(canonFact.toLowerCase())) {
            updatedDesc = `${updatedDesc} ${canonFact}`.trim();
          }
          actionsTaken.push(`Updated character dossier and relationship dynamics for **${c.name}**`);
        }

        updatedChars.push({
          name: c.name,
          role: updatedRole,
          description: updatedDesc,
          voiceTone: updatedVoiceTone,
        });
    });

    // 3. Setting & Atmosphere updates
    if (/setting|weather|atmosphere|climate|environment|city|location|world|realm/i.test(text)) {
      updatedSetting = book.setting ? `${book.setting} · Atmosphere Note: ${raw}` : raw;
      actionsTaken.push("Updated environmental setting and world atmosphere");
    }

    // 4. Synopsis / Premise updates
    if (/synopsis|premise|main plot|core conflict|storyline/i.test(text)) {
      updatedSynopsis = raw;
      actionsTaken.push("Updated core manuscript synopsis and premise");
    }

    // 5. Overarching Dialogue Tone updates
    let updatedDialogueTone: string | null = null;
    if (/\b(?:dialogue|narrative|overall|book)\s+tone\b/i.test(text) || /\b(?:set|change|make)\s+(?:the\s+)?(?:tone|dialogue)\b/i.test(text)) {
      if (/poetic|lyrical/i.test(text)) updatedDialogueTone = "Poetic & Lyrical";
      else if (/formal|aristocratic/i.test(text)) updatedDialogueTone = "Formal & Aristocratic";
      else if (/casual|conversational/i.test(text)) updatedDialogueTone = "Casual & Conversational";
      else if (/gritty|blunt/i.test(text)) updatedDialogueTone = "Gritty & Blunt";
      else if (/scholarly|analytical/i.test(text)) updatedDialogueTone = "Scholarly & Analytical";
      else if (/cryptic|whispering/i.test(text)) updatedDialogueTone = "Cryptic & Whispering";
      else if (/sarcastic|witty/i.test(text)) updatedDialogueTone = "Sarcastic & Witty";

      if (updatedDialogueTone) {
        actionsTaken.push(`Updated default book dialogue tone to **${updatedDialogueTone}**`);
      }
    }

    // 6. Narrative Perspective, Repetition, and Literary Rule Confirmations
    if (/\b(?:third\s*person|3rd\s*person)\b/i.test(text) || /\b(?:ban|stop|no)\s+(?:second\s*person|2nd\s*person)\b/i.test(text)) {
      actionsTaken.push("Enforced strict third-person narrative perspective across all scenes and chapters");
    }
    if (/\b(?:repetiti|repeat|repetitive|echo\s*words?)\b/i.test(text)) {
      actionsTaken.push("Enforced zero-repetition and anti-echo vocabulary rules for the narrator");
    }
    if (/\b(?:de-?ai|cliche|clichés?|formulaic|triad|participial)\b/i.test(text)) {
      actionsTaken.push("Enforced anti-cliché and visceral de-AI prose guidelines");
    }

    // 7. Every change is also stored verbatim as canon. This is the source of
    // truth consumed by all future narrator requests.
    const attachmentFacts = Array.isArray(attachments)
      ? attachments
          .filter((attachment: any) => attachment?.extractedText?.trim())
          .map((attachment: any) => `[${attachment.name}] ${attachment.extractedText.trim()}`)
          .join("\n")
          .slice(0, 6000)
      : "";
    updatedLore = [raw, attachmentFacts].filter(Boolean).join("\n");
    actionsTaken.push("Recorded the exact directive as binding book canon");

    const attachmentNote =
      Array.isArray(attachments) && attachments.length > 0
        ? ` with data extracted from attached reference document(s): ${attachments.map((a: any) => a.name).join(", ")}`
        : "";

    const summaryText = actionsTaken.join(", ");
    const reply = `Your directive has been recorded as binding canon${attachmentNote}:

${actionsTaken.map((a) => `• ${a}`).join("\n")}

Future chapters and character interactions will receive this fact as an explicit, non-negotiable narrative constraint.`;

    // Construct reasoning thought trace if enabled
    let thought: string | null = null;
    if (reasoningLevel === "medium") {
      thought = `**Director's Deliberation (Medium Reasoning):**
• **Intent Processing**: Evaluated author directive: "${raw}".
• **Cast & Relationship Audit**: Checked active cast (${existingChars.map((c: any) => c.name).join(", ") || "General Cast"}).
• **World & Style Consistency**: Verified alignment with setting (${book.setting || "Standard Atmosphere"}), dialogue tone (${updatedDialogueTone || book.dialogueTone || "Standard"}), and core narrative rules.
• **Enacted Rule**: Integrated modifications as permanent narrative constraints.`;
    } else if (reasoningLevel === "high") {
      thought = `**Deep Director's Deliberation (High Reasoning Engine):**
1. **Instruction & Subtext Deconstruction**:
   - Primary author command: "${raw}"
   - Scanned for explicit character behavioral constraints, silence mandates, voice tone assignments, and narrative perspective rules.
2. **Dramatis Personae & Voice Tone Integrity**:
   - Evaluated ${existingChars.length} existing character record(s).
   - Enforced behavioral boundaries and speech patterns to prevent out-of-character AI dialogue.
3. **Atmospheric & World Law Coherence**:
   - Cross-referenced against volume setting (${book.setting || "Unspecified"}), dialogue tone, and lore compendium.
   - Guaranteed permanent compliance for the storyteller narrator.
4. **Structural Output Synthesis**:
   - Applied updates: ${summaryText || "Lore notes augmented"}.
   - Story narrator instructed to strictly follow these directives without contradiction.`;
    }

    return {
      reply,
      updates: {
        charactersToUpdate: updatedChars,
        charactersToAdd: addedChars,
        setting: updatedSetting,
        synopsis: updatedSynopsis,
        loreNotes: updatedLore,
        dialogueTone: updatedDialogueTone,
      },
      thought,
      fallbackUsed: true,
      note: "Gemini was unavailable, so the local canon engine applied this directive deterministically.",
    };
  }

  // Private Director / World-Building Chat endpoint
  app.post("/api/director-chat", async (req, res) => {
    try {
      const { book, instruction, history, attachments, reasoning = "medium" } = req.body;
      const reasoningLevel: "off" | "medium" | "high" =
        reasoning === "off" || reasoning === "high" ? reasoning : "medium";

      const effectiveInstruction =
        instruction && typeof instruction === "string" && instruction.trim()
          ? instruction.trim()
          : Array.isArray(attachments) && attachments.length > 0
          ? "Please thoroughly review and analyze the attached document(s). Extract all character profiles, relationships, world lore, and setting rules, and update the book's dramatis personae and lore accordingly."
          : "";

      if (!book || !effectiveInstruction) {
        return res.status(400).json({ error: "Missing book, instruction, or attached files." });
      }

      const fileAttachments = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
      const unreadableFiles = fileAttachments.filter((attachment: any) => {
        const isPdf = attachment.type === "application/pdf" || attachment.name?.toLowerCase().endsWith(".pdf");
        return isPdf
          ? !attachment.base64 || typeof attachment.base64 !== "string"
          : !attachment.extractedText || typeof attachment.extractedText !== "string" || !attachment.extractedText.trim();
      });
      if (unreadableFiles.length > 0) {
        return res.status(422).json({
          error: `These files contain no readable payload: ${unreadableFiles.map((file: any) => file.name || "Unnamed file").join(", ")}. Reattach them before sending.`,
        });
      }

      const client = getGeminiClient();
      if (!client) {
        if (fileAttachments.length > 0) {
          return res.status(503).json({
            error: "Gemini is unavailable, so the attached files were not read and no changes were applied. Your files remain staged for retry.",
          });
        }
        return res.json(heuristicDirectorUpdate(book, effectiveInstruction, attachments, reasoningLevel));
      }

      const knownCharacters =
        Array.isArray(book.characters) && book.characters.length > 0
          ? book.characters
              .map(
                (c: any) =>
                  `• ${c.name} (${c.role || "Character"}) [Voice: ${c.voiceTone || book.dialogueTone || "Casual & Conversational"}]: ${c.description || "Active in the story."}`
              )
              .join("\n")
          : "None registered yet.";

      const storedDirectorCanon = Array.isArray(book.canonFacts) && book.canonFacts.length > 0
        ? book.canonFacts
            .slice(-50)
            .map((fact: any, index: number) => `${index + 1}. ${fact.text}`)
            .join("\n")
        : "No structured Director canon recorded yet.";

      const systemInstruction = `You are the Creative Director and World-Building Architect for the novel "${book.title}".
You are engaged in a private consultation with the author (the user).

CRITICAL DIRECTIVE: USER INTENT IS SUPREME LAW.
Whatever the author asks for, you MUST heavily follow, enforce, and integrate without resistance, hesitation, or contradiction.
- If the author instructs a character to act a certain way, remain silent, hold a secret, change their voice tone, or change their relationship, YOU MUST IMMEDIATELY UPDATE THAT CHARACTER.
- If the author introduces a new character, add them to "charactersToAdd".
- If the author changes the setting, atmosphere, or weather, update "setting".
- If the author sets world rules, magic mechanics, or narrative laws, record them in "loreNotes".
- If the author adjusts the dialogue tone or book register, update "dialogueTone".
- Explicitly confirm in your "reply" how the story and characters will strictly obey their exact command.

ACTIVE NARRATIVE LAWS & CORE ENGINE CAPABILITIES:
1. STRICT THIRD-PERSON POV: The story narrator operates strictly in the third person ("he", "she", "they", proper names; never second-person "you" in narration). If the author wants to confirm, reinforce, or tune point-of-view, assure them that the third-person mandate is active.
2. ZERO REPETITION & ANTI-ECHOING: The narrator bans echo words, repeated descriptors, and narrative looping. You can record specific anti-repetition rules or vocabulary guidelines into "loreNotes".
3. STRIP AI GENERATIVE TEXTURE: The narrator bans sentence triads, "-ing" participial sentence openers, sensory filtering ("could feel"), and robotic meta-commentary.
4. PUSH PAST OUTCOMES: The narrator takes the author's input as an accomplished outcome and pushes immediately forward into fresh consequences and complications.
5. DISTINCT VOICE TONES: Each character speaks in their assigned Voice Tone (Casual & Conversational, Poetic & Lyrical, Formal & Aristocratic, Gritty & Blunt, Scholarly & Analytical, Cryptic & Whispering, Sarcastic & Witty). You can assign or update voice tones for any character in "charactersToUpdate" or "charactersToAdd", or change the book's overarching tone in "updates.dialogueTone".

CURRENT VOLUME CONTEXT:
Title: ${book.title}
Subtitle: ${book.subtitle || ""}
Setting: ${book.setting || "Unspecified"}
Default Dialogue Tone: ${book.dialogueTone || "Casual & Conversational"}
Synopsis: ${book.synopsis || "Unspecified"}
World Lore & Rules: ${book.loreNotes || "None established yet"}
Persistent Director Canon (oldest to newest; newest wins on conflict):
${storedDirectorCanon}

KNOWN DRAMATIS PERSONAE (Characters):
${knownCharacters}

YOUR RESPONSIBILITIES:
1. Provide a direct, collaborative, highly attentive editorial response in "reply" confirming exactly how the author's instructions are being enacted.
2. If the user establishes or modifies character details, relationships, or speech style, formulate updated "role", "description", and optional "voiceTone" in "updates.charactersToUpdate".
3. If the user introduces new characters to add, populate "updates.charactersToAdd" with "name", "role", "description", and "voiceTone".
4. If the user adjusts or expands the setting/atmosphere, output the updated string in "updates.setting".
5. If the user adjusts the premise/synopsis, output the updated string in "updates.synopsis".
6. If the user establishes world lore, history, or rules, provide the updated lore in "updates.loreNotes".
7. If the user adjusts overarching dialogue tone, output it in "updates.dialogueTone".
8. REASONING PROCESS: ${
        reasoningLevel === "off"
          ? 'Provide null for "thought".'
          : `Provide in "thought" a ${
              reasoningLevel === "high" ? "deep, structured, multi-step" : "clear, insightful"
            } deliberation analyzing the user's intent, character psychology, lore impact, and how future chapters will obey this directive.`
      }
9. ATTACHED FILE VERIFICATION:
   - Read every attached file completely before proposing updates.
   - Return one entry in "filesRead" for every attachment, using its exact filename.
   - Set "read" to true only after inspecting its contents, and give a concise summary containing at least one specific fact found inside that file.
   - Never claim a file was integrated if it could not be read.

Format your response STRICTLY as a single valid JSON object:
{
  "thought": ${reasoningLevel === "off" ? "null" : '"Step-by-step creative director deliberation and analysis"'},
  "reply": "Your conversational response as the Story Director to the author",
  "updates": {
    "charactersToUpdate": [
      {
        "name": "Exact Name of Character",
        "role": "Updated role",
        "description": "Updated description strictly embodying the author's directive",
        "voiceTone": "Optional updated voice tone: Casual & Conversational, Poetic & Lyrical, Formal & Aristocratic, Gritty & Blunt, Scholarly & Analytical, Cryptic & Whispering, or Sarcastic & Witty"
      }
    ],
    "charactersToAdd": [
      {
        "name": "New Character Name",
        "role": "Role",
        "description": "Description",
        "voiceTone": "Character voice tone: Casual & Conversational, Poetic & Lyrical, Formal & Aristocratic, Gritty & Blunt, Scholarly & Analytical, Cryptic & Whispering, or Sarcastic & Witty"
      }
    ],
    "setting": null,
    "synopsis": null,
    "loreNotes": null,
    "dialogueTone": null
  },
  "filesRead": [
    {
      "name": "Exact attached filename",
      "read": true,
      "summary": "Specific facts verified from this file"
    }
  ]
}
IMPORTANT: Output ONLY the raw JSON object, without markdown code fences.`;

      const contents: Array<{ role: string; parts: Array<any> }> = [];
      if (Array.isArray(history) && history.length > 0) {
        history.slice(-10).forEach((m: any) => {
          if (m && m.content) {
            contents.push({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            });
          }
        });
      }

      const userParts: Array<any> = [];

      // Process any attached files for this turn
      if (Array.isArray(attachments) && attachments.length > 0) {
        for (const att of attachments) {
          if (!att) continue;
          // PDF inlineData support
          if (att.base64 && (att.type === "application/pdf" || (att.name && att.name.toLowerCase().endsWith(".pdf")))) {
            const cleanBase64 = att.base64.replace(/^data:[^;]+;base64,/, "");
            userParts.push({
              inlineData: {
                mimeType: "application/pdf",
                data: cleanBase64,
              },
            });
            userParts.push({
              text: `[Attached PDF File: "${att.name}" - Please review and integrate its contents into the book's world and characters.]`,
            });
          } else if (att.extractedText && att.extractedText.trim()) {
            userParts.push({
              text: `--- ATTACHED DOCUMENT: "${att.name}" (${att.type || "document"}) ---\n${att.extractedText.trim()}\n--- END OF ATTACHED DOCUMENT ---`,
            });
          } else if (att.name) {
            userParts.push({
              text: `[Attached Document Reference: "${att.name}"]`,
            });
          }
        }
      }

      userParts.push({ text: effectiveInstruction });

      contents.push({
        role: "user",
        parts: userParts,
      });

      try {
        const thinkingBudget = reasoningLevel === "off" ? 0 : reasoningLevel === "high" ? 8192 : 2048;
        const rawOutput = await generateWithModelFallback(client, {
          contents,
          systemInstruction,
          temperature: 0.7,
          topP: 0.9,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget },
        });

        let data: any;
        try {
          data = safeParseJsonObject(rawOutput);
        } catch (parseErr) {
          console.warn(
            "[Director Chat] Could not extract pure JSON object, using model raw response as direct editorial reply:",
            parseErr
          );
          // If the model produced natural language editorial advice/questions rather than pure JSON
          const sanitizedReply = rawOutput
            .replace(/```(?:json)?/gi, "")
            .replace(/```/g, "")
            .trim();
          data = {
            reply: sanitizedReply || "Directive recorded and integrated into the manuscript.",
            updates: {},
          };
        }

        const filesRead = Array.isArray(data.filesRead) ? data.filesRead : [];
        if (fileAttachments.length > 0) {
          const unverifiedFiles = fileAttachments.filter((attachment: any) =>
            !filesRead.some((receipt: any) =>
              receipt?.read === true &&
              receipt?.name?.trim().toLowerCase() === attachment.name?.trim().toLowerCase() &&
              typeof receipt?.summary === "string" &&
              receipt.summary.trim().length >= 8
            )
          );
          if (unverifiedFiles.length > 0) {
            throw new Error(
              `Gemini did not verify reading: ${unverifiedFiles.map((file: any) => file.name).join(", ")}`
            );
          }
        }

        const canonData = heuristicDirectorUpdate(book, effectiveInstruction, attachments, reasoningLevel);
        const modelUpdates: any = data.updates || {};
        const canonUpdates: any = canonData.updates || {};

        // Model prose can enrich a directive, but deterministic canon extraction
        // wins whenever it found an explicit fact or character reference.
        const allCharacterUpdates = [
          ...(Array.isArray(modelUpdates.charactersToUpdate) ? modelUpdates.charactersToUpdate : []),
          ...(Array.isArray(canonUpdates.charactersToUpdate) ? canonUpdates.charactersToUpdate : []),
        ];
        const characterUpdateMap = new Map<string, any>();
        allCharacterUpdates.forEach((item: any) => {
          if (item?.name) {
            characterUpdateMap.set(item.name.trim().toLowerCase(), item);
          }
        });
        const mergedCharacterUpdates = [...characterUpdateMap.values()];

        const explicitAddRequested = Array.isArray(canonUpdates.charactersToAdd) &&
          canonUpdates.charactersToAdd.length > 0;
        const modelFileCharacters = fileAttachments.length > 0 && Array.isArray(modelUpdates.charactersToAdd)
          ? modelUpdates.charactersToAdd
          : [];

        return res.json({
          reply: data.reply || "Directive recorded and integrated into the manuscript.",
          updates: {
            charactersToUpdate: mergedCharacterUpdates,
            charactersToAdd: explicitAddRequested
              ? canonUpdates.charactersToAdd
              : modelFileCharacters,
            setting: modelUpdates.setting || canonUpdates.setting || null,
            synopsis: modelUpdates.synopsis || canonUpdates.synopsis || null,
            loreNotes: fileAttachments.length > 0
              ? modelUpdates.loreNotes || null
              : canonUpdates.loreNotes || modelUpdates.loreNotes || null,
            dialogueTone: modelUpdates.dialogueTone || canonUpdates.dialogueTone || null,
          },
          thought: data.thought || canonData.thought,
          fallbackUsed: false,
          filesRead,
        });
      } catch (geminiErr: any) {
        const status = geminiErr?.status || geminiErr?.code || "unknown";
        const rawMessage = String(geminiErr?.message || "Unknown Gemini error");
        const message = rawMessage
          .replace(process.env.GEMINI_API_KEY || "__no_key__", "[redacted]")
          .slice(0, 300);
        console.warn(`[Director Chat] Gemini failed (${status}): ${message}`);
        if (fileAttachments.length > 0) {
          const creditsDepleted = status === 429 &&
            /depleted|resource_exhausted|billing|prepayment/i.test(rawMessage);
          return res.status(503).json({
            error: creditsDepleted
              ? "Google Gemini received the files but refused processing because this API project's prepaid credits are depleted. Add credits in Google AI Studio or use another funded Gemini API key, then retry. No Director changes were applied."
              : "Gemini could not read the attached files, so no Director changes were applied. The files remain staged for retry.",
          });
        }
        return res.json(heuristicDirectorUpdate(book, effectiveInstruction, attachments, reasoningLevel));
      }
    } catch (_err: unknown) {
      const fallbackBook = req.body?.book || { title: "Untitled", characters: [] };
      const fallbackInstruction = typeof req.body?.instruction === "string" ? req.body.instruction : "Directive integrated.";
      const reasoningLevel = req.body?.reasoning || "medium";
      if (Array.isArray(req.body?.attachments) && req.body.attachments.length > 0) {
        return res.status(500).json({
          error: "The attached files were not verified as read, so no Director changes were applied.",
        });
      }
      return res.json(heuristicDirectorUpdate(fallbackBook, fallbackInstruction, req.body?.attachments, reasoningLevel));
    }
  });

  // Book-centric Roleplay chat endpoint
  app.post("/api/chat", async (req, res) => {
    try {
      const { book, chapterTitle, messages } = req.body;

      if (!book || !messages || !Array.isArray(messages)) {
        return res.status(400).json({
          error: "Missing book profile or messages array in request body.",
        });
      }

      const client = getGeminiClient();
      const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user")?.content || "";

      if (!client) {
        return res.json({
          reply: createFallbackNarrative(book, lastUserMsg),
          newCharacters: [],
        });
      }

      // Format known characters and lead character for prompt
      const knownChars = Array.isArray(book.characters) ? book.characters : [];
      const leadChar =
        knownChars.find(
          (c: any) =>
            c &&
            c.name &&
            /protagonist|main|lead|hero|pov/i.test(c.role || "") &&
            !/protagonist/i.test(c.name)
        ) || knownChars.find((c: any) => c && c.name && !/protagonist/i.test(c.name));
      const leadCharName = leadChar?.name || null;

      const defaultBookTone = book.dialogueTone || "Casual & Conversational";

      const knownCharactersList =
        knownChars.length > 0
          ? knownChars
              .map(
                (c: { name: string; role: string; description: string; voiceTone?: string }) =>
                  `• ${c.name} (${c.role || "Character"}) [Voice Tone: ${c.voiceTone || defaultBookTone}]: ${c.description || "Active in the story."}`
              )
              .join("\n")
          : "None currently registered. Characters emerge dynamically as the user or narrator mentions them.";

      const structuredCanon = Array.isArray(book.canonFacts) && book.canonFacts.length > 0
        ? book.canonFacts
            .slice(-50)
            .map((fact: any, index: number) => `${index + 1}. ${fact.text}`)
            .join("\n")
        : "";
      const loreSection = book.loreNotes || structuredCanon
        ? `\nWORLD LORE & AUTHOR RULES:\n${book.loreNotes || ""}${
            structuredCanon
              ? `\n\nPERSISTENT DIRECTOR CANON — chronological, newest fact wins:\n${structuredCanon}`
              : ""
          }\n`
        : "";

      // Build literary narrator & ensemble instructions with strict roleplay guidelines
      const systemInstruction = `You are the Master Narrator and Living World Ensemble for the book: "${book.title}".
Subtitle / Theme: ${book.subtitle || "A Living Story"}
Setting & Atmosphere: ${book.setting || "Immersive world"}
Book Dialogue Register: ${defaultBookTone}
Synopsis: ${book.synopsis || "An unfolding story driven by vivid interactions."}${loreSection}
Current Chapter: ${chapterTitle || "Active Scene"}

Dramatis Personae (Known Characters in this Book):
${knownCharactersList}
${leadCharName ? `Lead Point-of-View Character: ${leadCharName}` : ""}

THE NARRATOR'S CREED & PRIME DIRECTIVE:
1. YOU ARE THE LIVING NARRATOR: Your sacred identity and absolute duty is to take whatever idea, action, dialogue, concept, or plot beat the author gives you and BREATHE PULSING, VIVID REALITY INTO IT.
2. REFERENCE THE USER'S OUTCOME & PUSH DEEPLY FURTHER (NEVER MIRROR OR REPLICATE):
   - REFERENCE & HONOR THE OUTCOME: The user's input dictates what they attempt, say, or intend to happen. Treat this outcome as having succeeded and taken immediate, tactile effect in the world. Reference their action, dialogue, or choice clearly—establishing that their intent came to pass.
   - STRICT BAN ON COPYING, PARAPHRASING, OR MERE ECHOING: You are strictly forbidden from merely restating, rephrasing, summarizing, or mirroring back what the user typed. The user already knows what they inputted—they want the world to react and advance!
   - PUSH INTO WHAT HAPPENS NEXT (NEW MOMENTUM & COMPLICATIONS):
     • Advance the scene into the immediate next seconds/minutes: don't freeze at the action.
     • How do the surrounding characters react verbally and emotionally? Other characters MUST speak in dialogue, challenge the move, reveal hidden knowledge, or take counter-actions.
     • What unexpected discovery, complication, shift in tension, or physical consequence is triggered by the user's move?
     • Elevate with visceral sensory immersion: the ozone in the air, the cold rain on stone, the sharp crack of splintering timber, the flicker of dying lantern light, the rasp of heavy breathing, the heavy footsteps in the hall, and the shifting tension between characters.
   - END ON A COMPELLING FORWARD HOOK: Every passage must leave the scene charged with forward tension, an unanswered challenge, or an immediate opening for the next move.
3. CHARACTER VOICE & TONE ENFORCEMENT (CRITICAL):
   - Each character possesses an assigned Voice Tone (e.g. "Casual & Conversational", "Poetic & Lyrical", "Formal & Aristocratic", "Gritty & Blunt", "Scholarly & Analytical", "Cryptic & Whispering", "Sarcastic & Witty") or follows the Book Dialogue Register ("${defaultBookTone}").
   - You MUST strictly mold each character's dialogue style, diction, vocabulary, sentence length, and cadence to their assigned Voice Tone:
     • Casual & Conversational: Use contractions ("don't", "gonna", "look"), relaxed modern cadence, everyday idioms, natural human rhythm.
     • Poetic & Lyrical: Use elevated, metaphorical, rhythmically ornate English, lyrical cadence, evocative imagery, and philosophical reflection.
     • Formal & Aristocratic: Use stately high English, immaculate etiquette, polite distance, elevated vocabulary, and no informal contractions.
     • Gritty & Blunt: Use clipped, harsh, street-level sentences, hardboiled phrasing, direct and unvarnished statements.
     • Scholarly & Analytical: Use erudite, precise technical vocabulary, deductive reasoning, analytical observations, and measured speech.
     • Cryptic & Whispering: Use veiled allegories, hushed warnings, enigmatic riddles, and ominous undercurrents.
     • Sarcastic & Witty: Use dry irony, biting humor, sharp cynical observations, and understated deadpan retorts.
   - When multiple characters interact, their spoken dialogue MUST contrast sharply based on their respective tones so that each speaker sounds unmistakably distinct!
4. STRICT THIRD-PERSON NARRATIVE MANDATE & PROPER NAMING LAW:
   - ALL NARRATION IN THE THIRD PERSON: All scene descriptions, physical movements, environmental details, and narrative observations MUST be written strictly in the third person ("he", "she", "they", or proper names like "${leadCharName || 'Julian'}").
   - ZERO SECOND-PERSON NARRATION: NEVER refer to the lead character or the reader as "you", "your", or "yours" in narrative prose, action descriptions (*...*), or atmospheric beats. The word "you" is ONLY permitted inside dialogue quotation marks ("...") when one character is speaking aloud directly to another.
   - ABSOLUTE BAN ON THE WORD "PROTAGONIST": You are strictly forbidden from ever outputting "the protagonist", "the main character", or "the hero" in your narration or dialogue. Always use their actual proper name${leadCharName ? ` (e.g. "${leadCharName}")` : " from the Dramatis Personae"} or third-person pronouns. Calling any character "the protagonist" in the story text breaks immersion and is a critical defect.
5. NEVER SPEAK AS AN AI:
   - You are NOT an AI assistant, and you must NEVER break character, provide meta-disclaimers, or say things like "Sure! Here is the next scene" or "As requested...".
   - You are the omniscient, deeply engaged storyteller weaving the living tapestry of this book.
6. ROLES & AGENCY:
   - The user commands their lead character${leadCharName ? ` (${leadCharName})` : ""}.
   - You (the Narrator) command all surrounding NPCs, enemies, factions, bystander crowds, and environmental world events.
   - Do NOT puppet or force spoken words, internal thoughts, or decisions onto the lead character UNLESS the user explicitly asks you to narrate them. React to their presence and advance the living world around them.
7. IMMUTABLE LORE & DIRECTOR'S DESK ENFORCEMENT:
   - All rules, lore notes, character relationships, and behavioral constraints established in the Director's Desk or Dramatis Personae (e.g., if a character is silent, hostile, or carries a specific secret) are IMMUTABLE NARRATIVE LAWS. Never violate or contradict them.
   - Director canon overrides older synopsis, prologue, and generated-story assumptions whenever they conflict.
   - Treat every bullet under WORLD LORE & AUTHOR RULES as a literal fact, not creative inspiration. When two directives conflict, the newest recorded directive wins.
   - Before writing, silently audit every planned action and line of dialogue against the named characters' Director Canon notes.
8. LANGUAGE, GRIT & TONE:
   - Ground narration in vivid sensory truth and atmospheric tension.
   - Respect character voice tones strictly: keep dialogue authentic to each character's identity. Swearing and profanity are permitted when appropriate for high stakes and raw emotion.
9. ACTION & COMBAT (STRICT "SHOW, DON'T TELL"):
   - Absolutely NEVER use gaming terminology (strictly forbidden: "HP", "stats", "aggro", "hitbox", "mana bar", "level up", "debuff", "buff", "DPS", "cooldown", "spawn", "XP", "aurafarm").
   - Instead, describe the physical momentum, kinetic force, strain in muscles, the friction of magic, and the destruction of the surrounding environment.
10. DYNAMIC NPC BEHAVIOR:
   - Bystanders and background NPCs must NEVER stand frozen like statues. Show them reacting with panic, whispers, hasty glances, scrambling for cover, or continuing their shady business while the main scene unfolds.
11. FORMATTING & DIALOGUE:
   - Spoken dialogue in quotation marks ("..."), always on its own separate paragraph.
   - Physical actions, gestures, and atmospheric pauses wrapped in asterisks (*like this*).
   - Write 2 to 4 evocative, well-paced paragraphs separated by blank lines that directly drive the scene forward.
12. ABSOLUTE BAN ON AI WRITING CLICHÉS & TIRED TROPES:
   - You are STRICTLY FORBIDDEN from using exhausted AI idioms, purple tropes, and robotic melodrama:
     • NEVER write "let out a breath they didn't know they were holding" or "released a breath".
     • NEVER write "stands as a testament to..." or "a testament to".
     • NEVER write "tapestry of..." or "rich tapestry of life/shadows/fate".
     • NEVER write "sent shivers down their spine" or "a shiver ran down".
     • NEVER write "little did they know" or "unbeknownst to them".
     • NEVER write "a deadly dance" or "a dance of shadows / blades".
     • NEVER write "the air was thick with..." or "the tension was palpable".
     • NEVER write "delve into" or "delved deep".
     • NEVER write "a wry smile" or "smirked knowingly" or "wry chuckle".
     • NEVER write "beacon of hope" or "a stark reminder".
     • NEVER write "time seemed to stand still" or "in that moment, everything changed".
     • NEVER write "heart hammered against ribs" or "eyes widened in disbelief".
   - NO MORALIZING RESOLUTIONS OR NEAT LESSONS: Do not conclude turns with neat little summary platitudes ("And so, they realized...", "Only time would tell..."). Keep scenes raw, immediate, unresolved, and grounded in physical consequence.
   - NO THERAPY-SPEAK: Characters should never sound like corporate HR or modern relationship counselors. Write real human friction, grit, conflict, and distinct personality.
13. STRIP THE "AI GENERATIVE" PATTERN & TEXTURE (CRITICAL LITERARY RULES):
   - BANISH SENTENCE TRIADS: Do not write in robotic three-item lists ("the cold, the dark, and the rain", "with fear, awe, and determination"). Real prose is asymmetrical. Pick one vivid, sensory detail or two stark elements.
   - BANISH PARTICIPIAL SENTENCE OPENERS: Stop opening sentences with "-ing" participles ("Stepping forward...", "Turning slowly...", "Looking over her shoulder...", "Nodding silently..."). This is the #1 telltale sign of AI generation. Use direct, strong Subject-Verb-Object syntax ("He crossed the threshold. The floorboards gave an inch.").
   - BANISH SENSORY FILTERING & VAGUE ABSTRACTIONS: Never insert perceptual filters like "could feel", "felt a wave of", "noticed the presence of", "was aware of", or "sensed the tension". State the sensory reality directly: Not "He felt the freezing rain on his neck", but "Freezing rain trickled down his collar".
   - BANISH HEDGING & EQUIVOCATION: Purge weak hedging words ("seemed to", "as if", "almost", "a hint of", "somewhat", "perhaps"). State facts with visceral literary confidence.
   - BANISH FORMULAIC 4-PARAGRAPH RHYTHMS (JAGGED PACING): Shatter the predictable AI pattern of (1. Scenery setting, 2. Character movement, 3. Spoken dialogue, 4. Philosophical summary). Vary paragraph length drastically. Let some sentences be blunt, jagged single lines. Let dialogue overlap, cut off, or interrupt action.
   - BANISH CONVERSATIONAL PING-PONG: Real people do not take turns politely exchanging complete, self-contained paragraphs. Introduce authentic human messiness: broken phrases, deflections, trailing thoughts, silences, grunts, and sharp subtext.
   - BANISH MELODRAMATIC MICRO-EXPRESSIONS: Never write "a flicker of sadness passed over her face", "an unreadable expression", or "a ghost of a smile". Show tangible physical interaction with physical objects and anatomy.
14. STRICT BAN ON REPETITION & REPETITIVENESS (ZERO ECHOES / NO NARRATIVE LOOPS):
   - NO ECHO WORDS OR CRUTCH VOCABULARY: Never repeat prominent nouns, verbs, or sensory descriptors across consecutive sentences, paragraphs, or recent turns. If a sentence uses "shadow", "stillness", "threshold", "flicker", "chill", "cold", "damp", or "blade", do NOT reuse that word or its immediate synonyms in the next sentence or paragraph. Employ varied, precise, and fresh vocabulary.
   - NO SYNTACTIC REPETITION: Do not repeat identical sentence rhythms, clause arrangements, or sentence starters. Every sentence in a paragraph must vary its cadence and grammatical opening.
   - NO DIALOGUE OR THOUGHT REPETITION: Characters must never voice repetitive sentiments, warnings, or questions they have already uttered in previous turns (e.g. repeating "we don't have much time" or "who did this?"). Every utterance must contribute NEW information, an escalation, a shift in stakes, or a decisive reaction.
   - NO ACTION REPLAY: Never re-describe physical actions that were already performed in prior turns (e.g., drawing a weapon that was already drawn, stepping through a doorway already crossed, eyeing an exit already noted). Treat past actions as permanently resolved and progress forward.
   - PREVENT SCENE STAGNATION: If a scene has established atmosphere, do not re-describe the same fog, rain, room lighting, or silence. Advance the physical events and character dynamics.

Dynamic Character Manifest:
If this turn introduces or mentions any NEW named characters into the book's world who are NOT already in the Known Characters list above, you MUST append a machine-readable block at the very end of your response:
\`\`\`character-manifest
[
  {
    "name": "Exact Name",
    "role": "Title or Brief Role (e.g. Street Fence / The Bruiser / Guard Captain)",
    "description": "One or two concise sentences summarizing their appearance, personality, or position in this book",
    "voiceTone": "Assigned Voice Tone matching their persona (e.g. Gritty & Blunt, Casual & Conversational, Poetic & Lyrical, etc.)"
  }
]
\`\`\`
If no new characters were introduced in this turn, omit the \`\`\`character-manifest\`\`\` block entirely.`;

      // Filter and prepare message history
      const validMessages = messages.filter(
        (m: { role: string; content: string }) => m && m.content && m.content.trim() !== ""
      );
      const recentHistory = validMessages.slice(-20);

      const contents = recentHistory.map((m: { role: string; content: string }) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      let rawReply = "";
      try {
        rawReply = await generateWithModelFallback(client, {
          contents,
          systemInstruction,
          temperature: 0.85,
          topP: 0.95,
          presencePenalty: 0.25,
          frequencyPenalty: 0.3,
        });
      } catch (_err: any) {
        const lastUserMsg = [...validMessages].reverse().find((m: any) => m.role === "user")?.content || "";
        rawReply = createFallbackNarrative(book, lastUserMsg);
      }

      // Parse and extract any dynamic new characters from the response
      let cleanReply = rawReply;
      const discoveredCharacters: Array<{ name: string; role: string; description: string; voiceTone?: string }> = [];

      const manifestRegex = /```character-manifest\s*([\s\S]*?)\s*```/;
      const match = rawReply.match(manifestRegex);

      if (match && match[1]) {
        try {
          const parsed = JSON.parse(match[1]);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item && typeof item.name === "string" && item.name.trim()) {
                discoveredCharacters.push({
                  name: item.name.trim(),
                  role: item.role ? String(item.role).trim() : "Character",
                  description: item.description ? String(item.description).trim() : "Mentioned in the story.",
                  voiceTone: item.voiceTone ? String(item.voiceTone).trim() : defaultBookTone,
                });
              }
            }
          }
        } catch {
          // Ignore parse errors on trailing manifests
        }
        // Strip manifest block from user-visible narrative
        cleanReply = rawReply.replace(manifestRegex, "").trim();
      }

      // Guarantee no stray "the protagonist" references slip into narrative
      cleanReply = sanitizeNarrativeOutput(cleanReply, book);

      return res.json({
        reply: cleanReply,
        newCharacters: discoveredCharacters,
      });
    } catch (_error: unknown) {
      const fallbackBook = req.body?.book || { title: "Untitled", characters: [] };
      const fallbackMsg = Array.isArray(req.body?.messages)
        ? req.body.messages.reverse().find((m: any) => m?.role === "user")?.content || ""
        : "";
      return res.json({
        reply: sanitizeNarrativeOutput(createFallbackNarrative(fallbackBook, fallbackMsg), fallbackBook),
        newCharacters: [],
      });
    }
  });

  // Dedicated Reroll / Rewrite passage endpoint with author's specific instructions
  app.post("/api/rewrite-passage", async (req, res) => {
    try {
      const { book, chapterTitle, originalPassage, userInstruction, contextMessages } = req.body;

      if (!book || !originalPassage) {
        return res.status(400).json({
          error: "Missing book or original passage for rewrite.",
        });
      }

      const client = getGeminiClient();
      if (!client) {
        const fallback = createFallbackRewrite(originalPassage, userInstruction, book);
        return res.json({
          reply: fallback,
          rewrittenPassage: fallback,
          newCharacters: [],
        });
      }

      const knownChars = Array.isArray(book.characters) ? book.characters : [];
      const leadChar =
        knownChars.find(
          (c: any) =>
            c &&
            c.name &&
            /protagonist|main|lead|hero|pov/i.test(c.role || "") &&
            !/protagonist/i.test(c.name)
        ) || knownChars.find((c: any) => c && c.name && !/protagonist/i.test(c.name));
      const leadCharName = leadChar?.name || null;

      const defaultBookTone = book.dialogueTone || "Casual & Conversational";

      const knownCharactersList =
        knownChars.length > 0
          ? knownChars
              .map(
                (c: { name: string; role: string; description: string; voiceTone?: string }) =>
                  `• ${c.name} (${c.role || "Character"}) [Voice Tone: ${c.voiceTone || defaultBookTone}]: ${c.description || "Active in the story."}`
              )
              .join("\n")
          : "None registered.";

      const loreSection = book.loreNotes ? `\nWORLD LORE & AUTHOR RULES:\n${book.loreNotes}\n` : "";

      const systemInstruction = `You are the Master Narrator and Living World Storyteller for the book: "${book.title}".
Subtitle: ${book.subtitle || ""}
Setting: ${book.setting || ""}
Book Dialogue Register: ${defaultBookTone}
Synopsis: ${book.synopsis || ""}${loreSection}
Current Chapter: ${chapterTitle || "Active Scene"}

DRAMATIS PERSONAE:
${knownCharactersList}
${leadCharName ? `Lead Point-of-View Character: ${leadCharName}` : ""}

THE NARRATOR'S REWRITE DIRECTIVE:
1. HONOR THE AUTHOR'S OUTCOME & PUSH DEEPLY FORWARD (NEVER REPLICATE):
   - When the author provides an instruction, direction, or idea for reshaping this passage, treat their desired outcome as accomplished and firmly established in reality. Reference their intent clearly.
   - Strictly forbidden: DO NOT merely copy, restate, or paraphrase the prompt. Push the scene forward into its natural, dramatic consequences!
   - What new complications, revelations, or character dialogue emerge from this outcome? Bring fresh spoken dialogue and dynamic character interactions.
   - Infuse the scene with palpable sensory depth (lighting, weather, sound, scent, heartbeat, and tension).
2. CHARACTER VOICE & TONE ENFORCEMENT:
   - Each character possesses an assigned Voice Tone (e.g. "Casual & Conversational", "Poetic & Lyrical", "Formal & Aristocratic", "Gritty & Blunt", "Scholarly & Analytical", "Cryptic & Whispering", "Sarcastic & Witty") or follows the Book Dialogue Register: "${defaultBookTone}".
   - You MUST strictly mold each character's dialogue style, diction, vocabulary, sentence length, and cadence to their assigned Voice Tone.
3. STRICT THIRD-PERSON NARRATIVE MANDATE (NO "YOU" / NEVER USE "PROTAGONIST"):
   - Narration must ALWAYS be written strictly in the THIRD PERSON ("he", "she", "they", or proper names like "${leadCharName || 'Julian'}").
   - NEVER address any character or reader as "you", "your", or "yours" in narration or scene descriptions (*...*). The word "you" is ONLY allowed inside spoken dialogue quotation marks ("...").
   - NEVER refer to any character as "the protagonist", "the main character", or "the hero".
4. ROLES & AGENCY:
   - The user commands their lead character${leadCharName ? ` (${leadCharName})` : ""}. You control all NPCs, enemies, and the breathing environment. Do NOT puppet their decisions unless instructed.
5. LANGUAGE & TONE:
   - Simple, accessible, natural English. Eliminate generic polite AI dialogue; keep prose casual, gritty, visceral, and grounded. Swearing/profanity is permitted if fitting for the scene.
6. ACTION & COMBAT:
   - Strictly "show, don't tell". Absolutely NO gaming terminology (no "HP", "stats", "aggro", "mana bar", etc.). Vividly describe physical impact, magical friction, and environmental destruction.
7. DYNAMIC NPCS:
   - Background characters must never stand still. Depict their reactions, whispers, scrambles, and ongoing background actions.
8. FORMATTING:
   - Output 2 to 4 evocative paragraphs separated by blank lines. Separate spoken dialogue ("...") onto its own lines. Actions in asterisks (*like this*). Output ONLY narrative prose without meta-commentary.
9. ABSOLUTE BAN ON AI WRITING CLICHÉS & TIRED TROPES:
   - Strictly forbidden phrases: "breath they didn't know they were holding", "testament to", "tapestry of", "shivers down spine", "little did they know", "deadly dance", "tension was palpable", "delve into", "wry smile", "beacon of hope", "time seemed to stand still", "heart hammered against ribs".
   - No moralizing resolutions, neat lessons, or summarizing wrap-ups. Keep the scene immediate, tangible, and raw.
10. STRIP THE "AI GENERATIVE" TEXTURE & HABITS:
   - Banish sentence triads (no triplets like "cold, dark, and damp"). Use asymmetrical, concrete focus.
   - Banish "-ing" participial openers ("Stepping forward...", "Turning slowly..."). Write in direct Subject-Verb-Object sentences.
   - Banish sensory filters ("could feel", "felt a sense of", "noticed"). State raw sensory events directly.
   - Banish hedging words ("seemed to", "as if", "almost", "perhaps").
   - Break formulaic 4-paragraph pacing: deliver jagged, unpredictable rhythm with natural interruptions.
11. STRICT BAN ON REPETITION & REDUNDANCY (ZERO REPETITIVENESS):
   - Eliminate echo words and repeated sentence structures. If a word, descriptor, or metaphor was used in the previous sentence or the original passage, do not repeat it.
   - Ban narrative looping: do not rehash known facts, repeated doubts, or identical warnings. Push the rewrite into fresh sensory territory and direct escalation.
   - Varied syntax: ensure every sentence begins with a different grammatical structure and varies in length.
12. If this rewrite introduces NEW named characters not in the dramatis personae, append \`\`\`character-manifest at the end with JSON array.`;

      const userContent = `ORIGINAL PASSAGE TO BE REROLLED & REWRITTEN:
"""
${originalPassage}
"""

AUTHOR'S SPECIFIC INSTRUCTIONS FOR THE REWRITE:
"""
${userInstruction ? userInstruction.trim() : "Reroll this passage with fresh dramatic tension, vivid sensory details, and an unexpected narrative beat."}
"""

Provide the fully rewritten, updated story passage now:`;

      let rawReply = "";
      try {
        rawReply = await generateWithModelFallback(client, {
          contents: [
            {
              role: "user",
              parts: [{ text: userContent }],
            },
          ],
          systemInstruction,
          temperature: 0.9,
          topP: 0.95,
          presencePenalty: 0.25,
          frequencyPenalty: 0.3,
        });
      } catch (_err: any) {
        rawReply = createFallbackRewrite(originalPassage, userInstruction, book);
      }

      let cleanReply = rawReply;
      const discoveredCharacters: Array<{ name: string; role: string; description: string; voiceTone?: string }> = [];
      const manifestRegex = /```character-manifest\s*([\s\S]*?)\s*```/;
      const match = rawReply.match(manifestRegex);

      if (match && match[1]) {
        try {
          const parsed = JSON.parse(match[1]);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item && typeof item.name === "string" && item.name.trim()) {
                discoveredCharacters.push({
                  name: item.name.trim(),
                  role: item.role ? String(item.role).trim() : "Character",
                  description: item.description ? String(item.description).trim() : "Mentioned in the story.",
                  voiceTone: item.voiceTone ? String(item.voiceTone).trim() : defaultBookTone,
                });
              }
            }
          }
        } catch {
          // Ignore manifest parse errors
        }
        cleanReply = rawReply.replace(manifestRegex, "").trim();
      }

      // Sanitize narrative from any accidental protagonist placeholder leaks
      cleanReply = sanitizeNarrativeOutput(cleanReply, book);

      return res.json({
        reply: cleanReply,
        rewrittenPassage: cleanReply,
        newCharacters: discoveredCharacters,
      });
    } catch (_error: unknown) {
      const fallbackPassage = typeof req.body?.originalPassage === "string" ? req.body.originalPassage : "";
      const fallbackInstruction = typeof req.body?.userInstruction === "string" ? req.body.userInstruction : "";
      const fallbackBook = req.body?.book || null;
      const fallback = sanitizeNarrativeOutput(createFallbackRewrite(fallbackPassage, fallbackInstruction, fallbackBook), fallbackBook);
      return res.json({
        reply: fallback,
        rewrittenPassage: fallback,
        newCharacters: [],
      });
    }
  });

  // Dedicated Grammar & Clarity Corrector (fixes grammar/typos without rephrasing)
  app.post("/api/grammar-correct", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== "string" || !text.trim()) {
        return res.status(400).json({ error: "Text to correct is required." });
      }

      const client = getGeminiClient();
      if (!client) {
        // Simple fallback cleanup if no API key
        let cleaned = text.trim();
        cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
        return res.json({ correctedText: cleaned });
      }

      const systemInstruction = `You are a dedicated grammar, spelling, and clarity corrector for story prompts and roleplay inputs.
YOUR SOLE OBJECTIVE:
1. Fix all typos, spelling mistakes, punctuation errors, capitalization, and grammatical flaws.
2. Make the sentence clear and understandable so the story narrator can easily comprehend the user's intent.
3. CRITICAL RULE: DO NOT rephrase, embellish, or overwrite the user's words with fancy synonyms or purple prose. Keep the vocabulary, tone, and sentence structure as close to the original as possible.
4. Preserve dialogue quotes ("..."), asterisks for actions (*...*), and specific character or place names.
5. Return ONLY the corrected input text with no commentary, quotation marks wrapping the whole response, or conversational intros.`;

      const contents = [
        {
          role: "user",
          parts: [{ text: `Input text to correct:\n${text}` }],
        },
      ];

      const rawResponse = await generateWithModelFallback(client, {
        contents,
        systemInstruction,
        temperature: 0.1,
        topP: 0.8,
      });

      let correctedText = rawResponse.trim();
      // Remove accidental wrapping markdown fences if returned
      correctedText = correctedText
        .replace(/^```[a-z]*\n?/i, "")
        .replace(/\n?```$/i, "")
        .trim();

      return res.json({ correctedText: correctedText || text });
    } catch (_error: unknown) {
      // If error occurs, gracefully return original text
      const fallback = typeof req.body?.text === "string" ? req.body.text.trim() : "";
      return res.json({ correctedText: fallback });
    }
  });

  // Catch-all 404 handler for unmatched /api/* requests so they return JSON rather than HTML
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
  });

  // Global error handling middleware for API routes
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Unhandled server error:", err);
    res.status(500).json({ error: err?.message || "Internal server error" });
  });

  // Vite middleware for development vs static serve for production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
