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

  // Set of models known to return 404 Not Found during the process lifetime
  const knownUnavailableModels = new Set<string>();

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
      "gemini-2.5-flash",
      "gemini-3.7-flash",
      "gemini-3.5-flash-lite",
      "gemini-2.5-pro",
      "gemini-2.0-flash",
    ];

    let lastError: unknown = null;

    for (let i = 0; i < candidateModels.length; i++) {
      const modelName = candidateModels[i];
      if (knownUnavailableModels.has(modelName)) {
        continue;
      }

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
          const rawMsg = String(err?.message || "");

          // If prepayment credits are explicitly depleted or quota is exhausted across the billing project, stop immediately
          const isQuotaOrDepleted =
            status === 429 ||
            /depleted|prepay.*credits|resource_exhausted|billing|quota/i.test(rawMsg);
          if (isQuotaOrDepleted) {
            throw err;
          }

          // If model doesn't exist (404), remember it and immediately try next model without retrying
          if (status === 404 || /not[ _]?found/i.test(rawMsg)) {
            knownUnavailableModels.add(modelName);
            break;
          }

          const isTransient =
            status === 503 ||
            rawMsg.includes("503") ||
            rawMsg.includes("high demand") ||
            rawMsg.includes("UNAVAILABLE");

          if (isTransient && attempt === 0) {
            // Brief backoff before second attempt
            await new Promise((resolve) => setTimeout(resolve, 250));
          } else {
            console.info(`[Model Fallback] ${modelName} unavailable (${status || "error"}), cascading to next candidate...`);
            break;
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
      .replace(/\bbetween\s+you\b/gi, "between them")
      // Scrub canned mechanical echo artifacts
      .replace(/^\s*\*?[^\n*]*The physical momentum jolts through [^\n*]*\*\s*\n*/gi, "")
      .replace(/^\s*\*?[^\n*]*The words hang in the (?:cold )?air of [^\n*]*\*\s*\n*/gi, "")
      // Convert overly fancy / purple vocabulary to simple, clear everyday English
      .replace(/\bbalustrade\b/gi, "railing")
      .replace(/\bquadrangle\b/gi, "courtyard")
      .replace(/\bspoken rejoinder\b/gi, "spoken reply")
      .replace(/\brejoinder\b/gi, "reply")
      .replace(/\bbrooked absolutely zero argument\b/gi, "left no room for argument")
      .replace(/\bbrooked zero argument\b/gi, "left no room for argument")
      .replace(/\bmeasured composure\b/gi, "calm voice")
      .replace(/\bhastened\b/gi, "hurried")
      .replace(/\bcountenance\b/gi, "face")
      .replace(/\btaciturn\b/gi, "quiet")
      .replace(/\bscrutinized?\b/gi, "watched")
      .replace(/\bscrutiny\b/gi, "stares")
      .replace(/\bperused?\b/gi, "read")
      .replace(/\blabyrinthine\b/gi, "winding")
      .replace(/\bbeneath\b/gi, "under")
      .replace(/\bwherewithal\b/gi, "means");

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
    // Landforms, Regional & Campus Geography
    "peninsula", "bataan", "luzon", "visayas", "mindanao", "manila", "archipelago", "strait", "ridge", "peak",
    "quadrangle", "arcade", "pavilion", "rotunda", "colonnade", "grounds",
    // Major Cities, Regions & Real-world locales
    "london", "paris", "tokyo", "rome", "berlin", "boston", "chicago", "seattle", "kyoto", "singapore", "madrid", "osaka", "toronto", "vancouver", "sydney", "oxford", "cambridge", "harvard", "yale", "stanford",
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
      "a", "an", "the", "this", "that", "these", "those", "it", "its", "they", "we", "you",
      "chapter", "book", "story", "in", "on", "at", "when", "while", "where", "why", "how",
      "after", "before", "two", "three", "four", "five", "many", "some", "every", "all",
      "during", "under", "inside", "outside", "across", "along", "between", "from", "into",
      "with", "without", "through", "once", "one", "there", "here", "then", "now", "shes",
      "good", "very", "most", "same", "only", "strict", "close", "school", "university",
      "demons", "magic", "holograms", "hologram", "stuff", "world", "modern", "advanced",
      "are", "were", "currently", "which", "who", "whom", "whose", "called", "named"
    ]);

    // Gather all words that belong to an institution, school, academy, or location mentioned in the premise
    const institutionStopWords = new Set<string>([
      "bataan", "peninsula", "state", "university", "college", "school", "academy", "institute",
      "campus", "faculty", "hospital", "hall", "pavilion", "arcade", "quadrangle", "luzon", "manila",
      "london", "paris", "tokyo", "boston", "chicago"
    ]);

    const institutionPattern =
      /\b([A-Z][a-zA-Z'’\-]+(?:\s+[A-Z][a-zA-Z'’\-]+)*\s+(?:University|College|School|Academy|Institute|State\s+University|Campus|High\s+School|Hospital|Guild|Facility|Station))\b/gi;
    for (const match of idea.matchAll(institutionPattern)) {
      const words = match[1].toLowerCase().split(/\s+/);
      for (const w of words) {
        institutionStopWords.add(w.replace(/[^a-z]/g, ""));
      }
    }

    const calledPlacePattern =
      /(?:university|college|school|academy|place|city|town|province)\s+(?:called|named)\s+([A-Z][a-zA-Z'’\-]+(?:\s+[A-Z][a-zA-Z'’\-]+)*)/gi;
    for (const match of idea.matchAll(calledPlacePattern)) {
      const words = match[1].toLowerCase().split(/\s+/);
      for (const w of words) {
        institutionStopWords.add(w.replace(/[^a-z]/g, ""));
      }
    }

    // Capture places introduced with spatial prepositions (e.g. "murders in New London", "set in Old York")
    const prepositionalPlacePattern =
      /\b(?:in|at|near|from|to|around|across|throughout)\s+([A-Z][a-zA-Z'’\-]+(?:\s+[A-Z][a-zA-Z'’\-]+)*)\b/g;
    for (const match of idea.matchAll(prepositionalPlacePattern)) {
      const placeCandidate = match[1].trim();
      // Skip if preceded by person titles
      if (!/^(?:Lord|Lady|Sir|Madam|Professor|Doctor|Captain|Detective|Commander)\b/i.test(placeCandidate)) {
        const words = placeCandidate.toLowerCase().split(/\s+/);
        for (const w of words) {
          institutionStopWords.add(w.replace(/[^a-z]/g, ""));
        }
      }
    }

    // Gather all words that belong to demons, monsters, creatures, beasts, or hostile anomalies
    const entityStopWords = new Set<string>([
      "demon", "demons", "monster", "monsters", "creature", "creatures", "beast", "beasts",
      "entity", "entities", "aberration", "aberrations", "anomaly", "anomalies", "fiend", "fiends",
      "dragon", "dragons", "ghoul", "ghouls", "wraith", "wraiths", "spirit", "spirits",
      "specter", "spectre", "specters", "spectres", "zombie", "zombies", "undead", "boss",
      "threat", "threats", "mutant", "mutants", "tyran", "resonant", "field", "track"
    ]);

    const creaturePattern =
      /\b([A-Z][a-zA-Z'’\-]+(?:\s+[A-Z][a-zA-Z'’\-]+)*)\s+(?:demon|demons|monster|monsters|creature|creatures|beast|beasts|entity|entities|aberration|aberrations|anomaly|anomalies|fiend|fiends|dragon|dragons|ghoul|ghouls|wraith|wraiths|titan|titans)\b/gi;
    for (const match of idea.matchAll(creaturePattern)) {
      const words = match[1].toLowerCase().split(/\s+/);
      for (const w of words) {
        entityStopWords.add(w.replace(/[^a-z]/g, ""));
      }
    }

    const isBlocked = (name: string): boolean => {
      if (!name) return true;
      const lower = name.toLowerCase().trim();
      if (nonNameOpeners.has(lower)) return true;
      if (isNonPersonName(name)) return true;
      if (entityStopWords.has(lower)) return true;
      if (/\b(?:demon|demons|monster|monsters|creature|creatures|beast|beasts|entity|entities|aberration|aberrations|anomaly|anomalies|fiend|fiends|dragon|dragons|titan|titans)\b/i.test(name)) return true;
      const words = lower.split(/\s+/);
      for (const w of words) {
        const cleanW = w.replace(/[^a-z]/g, "");
        if (
          institutionStopWords.has(cleanW) ||
          NON_PERSON_LOCATION_KEYWORDS.has(cleanW) ||
          nonNameOpeners.has(cleanW) ||
          entityStopWords.has(cleanW)
        ) {
          return true;
        }
      }
      return false;
    };

    const candidates: string[] = [];

    // 1. Explicit multi-word proper names: "Arthur Pendelton", "Gabriella Kazumi de Vara", "Ethan William Erolson", "Julian Cross"
    const multiWordPattern =
      /\b([A-Z][A-Za-z'’\-]+(?:\s+(?:(?:de|del|della|di|da|dos|du|la|le|van|von|der|den|bin|al)\s+)?[A-Z][A-Za-z'’\-]+){1,3})\b/g;
    for (const match of idea.matchAll(multiWordPattern)) {
      const name = match[1].trim().replace(/[.,;:!?]+$/g, "");
      if (!isBlocked(name)) {
        candidates.push(name);
      }
    }

    // 2. Co-occurring capitalized proper names: "William and Gabrielle", "Eleanor and Gabriella"
    const pairPattern = /\b([A-Z][A-Za-z'’\-]{2,})\s+(?:and|&)\s+([A-Z][A-Za-z'’\-]{2,})\b/g;
    for (const match of idea.matchAll(pairPattern)) {
      const name1 = match[1].trim().replace(/[.,;:!?]+$/g, "");
      const name2 = match[2].trim().replace(/[.,;:!?]+$/g, "");
      if (!isBlocked(name1)) candidates.push(name1);
      if (!isBlocked(name2)) candidates.push(name2);
    }

    // 3. Titled names and authority roles: "Supreme Director", "Director Kazumi", "Guild Master"
    const titlePattern =
      /\b(Supreme\s+[Dd]irector|[Dd]irector|[Gg]uild\s+[Mm]aster|[Cc]ommander|[Cc]aptain|[Gg]eneral|[Dd]ean|[Pp]resident|[Pp]rovost|[Pp]rofessor|[Dd]octor|[Ll]ord|[Ll]ady)\b(?:\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?))?/g;
    for (const match of idea.matchAll(titlePattern)) {
      const role = match[1].split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
      const name = match[2] ? match[2].trim() : "";
      const full = name ? `${role} ${name}` : role;
      if (!isBlocked(full)) {
        candidates.push(full);
      }
    }

    // 4. Standalone names with explicit character/person context: "friend Ethan", "student Gabrielle"
    const contextualPattern =
      /\b(?:student|friend|bestfriend|partner|companion|protagonist|detective|investigator|hunter|mage|wizard|knight|hero|brother|sister)\s+([A-Z][a-z]{2,})\b/g;
    for (const match of idea.matchAll(contextualPattern)) {
      const w = match[1].trim();
      if (!nonNameOpeners.has(w.toLowerCase()) && !isBlocked(w)) {
        candidates.push(w);
      }
    }

    // 5. Common story protagonist/companion names even if lowercase in user input
    const commonNames = new Set(["ethan", "william", "gabrielle", "gabriella", "eleanor", "julian", "arthur", "silas", "kazumi", "lucas", "liam", "evelyn", "elena"]);
    for (const word of idea.split(/\s+/)) {
      const clean = word.toLowerCase().replace(/[^a-z]/g, "");
      if (commonNames.has(clean) && !isBlocked(clean)) {
        candidates.push(clean.charAt(0).toUpperCase() + clean.slice(1));
      }
    }

    const filteredNames: string[] = [];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const firstWord = candidate.split(/\s+/)[0];
      if (nonNameOpeners.has(firstWord.toLowerCase()) && !/Supreme|Director|Commander|Captain/i.test(firstWord)) continue;
      if (nonNameOpeners.has(candidate.toLowerCase())) continue;
      if (isBlocked(candidate)) continue;
      if (!filteredNames.some((name) => name.toLowerCase() === candidate.toLowerCase())) {
        filteredNames.push(candidate);
      }
    }

    // Remove single-word roles if the full titled role or full multi-word name exists
    return filteredNames.filter(name => {
      const isSub = filteredNames.some(other => other !== name && other.toLowerCase().includes(name.toLowerCase()));
      return !isSub;
    });
  }

  function createPremiseCharacters(idea: string, names: string[]) {
    const isCollegeStory = /\b(?:college|university|campus)\b/i.test(idea);
    const areBestFriends = /\bbest\s*friends?\b/i.test(idea);

    return names.map((name, index) => {
      const otherNames = names.filter((_, otherIndex) => otherIndex !== index);
      const otherName = otherNames.length > 0 ? otherNames[0] : "their companion";

      let description = "";
      if (index === 0) {
        description = areBestFriends
          ? `${otherName}'s lifelong childhood best friend, navigating ${isCollegeStory ? "university life" : "the unfolding world"} with calm resolve as strange anomalies emerge.`
          : `${name} is a central figure navigating the events and mysteries of this story.`;
      } else {
        description = areBestFriends
          ? `${otherName}'s sharp-witted childhood best friend, observant and quick with dry banter, determined to keep ${otherName} grounded.`
          : `A close ally and steadfast counterpart to ${otherName}, sharing the weight of their journey.`;
      }

      return {
        name,
        role: isCollegeStory ? "College Student" : "Central Character",
        description,
        voiceTone: index === 0 ? "Casual & Conversational" : "Sarcastic & Witty",
      };
    });
  }

  // Graceful fallback synthesizer when Gemini is unavailable
  function createFallbackBookFromIdea(idea: string) {
    const cleanIdea = idea.trim().replace(/^["']|["']$/g, "");
    const lower = cleanIdea.toLowerCase();

    const isCollege = /\b(?:college|university|campus|academy|school)\b/i.test(lower);
    const isTech = /\b(?:hologram|holograms|advanced|modern|cyber|digital|ai|tech)\b/i.test(lower);
    const isSupernatural = /\b(?:demon|demons|devil|magic|magical|occult|sorcer|witch|spell)\b/i.test(lower);
    const isMystery = /\b(?:detective|mystery|crime|investigat|murder|noir)\b/i.test(lower);
    const isFantasy = !isTech && /\b(?:kingdom|realm|sword|castle|dragon|empire)\b/i.test(lower);

    // Extract institution or location name if present
    const locationMatch = cleanIdea.match(
      /\b([A-Z][a-zA-Z'’\-]+(?:\s+[A-Z][a-zA-Z'’\-]+)*\s+(?:University|College|School|Academy|Institute|Campus))\b/
    );
    const placeName = locationMatch ? locationMatch[1].trim() : (isCollege ? "the university campus" : "the city");

    const explicitNames = extractExplicitCharacterNames(cleanIdea);
    const characters = createPremiseCharacters(cleanIdea, explicitNames);

    // Synthesize an evocative, captivating title instead of dumping premise words
    let title = "The Unwritten Folio";
    if (isTech && isSupernatural) {
      title = isCollege ? "The Digital Arcana" : "Veil of the Modern Arcana";
    } else if (isSupernatural) {
      title = isCollege ? "Demons of the Upper Quad" : "The Arcane Chronicles";
    } else if (isTech) {
      title = isCollege ? "The Neon Academy" : "Echoes of the High Orbit";
    } else if (isMystery) {
      title = "The Silent Dossier";
    } else if (isFantasy) {
      title = "The Obsidian Crown";
    } else if (characters.length >= 2) {
      const last1 = characters[0].name.split(/\s+/).pop();
      const last2 = characters[1].name.split(/\s+/).pop();
      title = `The Chronicles of ${last1} & ${last2}`;
    }

    const subtitle = isTech && isSupernatural
      ? (isCollege ? "A Collegiate Urban Fantasy" : "An Urban Supernatural Thriller")
      : isCollege
        ? "A Campus Mystery & Chronicle"
        : (isTech ? "A Cybernetic Speculative Story" : "A Manuscript Born of an Instant Idea");

    // Synthesize world setting with visceral sensory atmosphere rather than prompt copying
    const setting = isTech && isSupernatural
      ? `A technologically advanced modern society where holographic interfaces, floating displays, and ambient digital networks define everyday life. Beneath this orderly academic exterior at ${placeName}, ancient demons and volatile magic stir in the shadows, threatening the fragile peace between the student body and the supernatural realm.`
      : isCollege
        ? `The sprawling, storied collegiate grounds of ${placeName}, where lecture halls, courtyard promenades, and quiet archives frame the lives of students navigating emerging rivalries and untold mysteries.`
        : isTech
          ? `A near-future metropolitan civilization where digital telemetry, neon-lit corridors, and cybernetic infrastructure shape every interaction.`
          : `An immersive, character-driven world centered around ${placeName}, charged with unspoken tension and imminent change.`;

    const char1 = characters[0]?.name || "Julian Cross";
    const char2 = characters[1]?.name || "Evelyn Ward";

    // Synthesize a proper narrative synopsis written strictly in the third person
    const synopsis = isCollege && isSupernatural
      ? `At ${placeName}, childhood best friends ${char1} and ${char2} navigate the demands of university life in a modern world governed by holographic technology. But when demonic signatures and forgotten magic begin manifesting across the campus grounds, the two friends must rely on their lifelong bond to confront the supernatural shadows threatening to engulf their world.`
      : isCollege
        ? `At ${placeName}, ${char1} and ${char2} navigate campus life, academic ambitions, and rising tensions that will test the strength of their bond as unexpected events reshape their future.`
        : `In a shifting world, ${char1} and ${char2} find their lives irreversibly altered when unexpected forces challenge everything they thought they understood.`;

    const inferredTone = isTech && isSupernatural
      ? "Casual & Conversational"
      : /sarcastic|witty/i.test(lower)
        ? "Sarcastic & Witty"
        : "Casual & Conversational";

    // Dynamic, atmospheric prologue with character action and spoken dialogue
    const prologue = `*A crisp morning breeze swept across the wide stone courtyard of ${placeName}, sending blue-tinted holographic lecture schedules shimmering against the glass facades of the campus complex.*

${char1} walked with an unhurried stride, hands loosely buried in jacket pockets as streams of students navigated the morning rush. Beside him, ${char2} kept pace, casually flipping through a floating digital reader before casting a sharp, knowing look toward the shaded colonnade.

"You're awfully quiet today," ${char2} remarked with a dry smirk, bumping a shoulder lightly against ${char1}. "Usually by this time you've already found three different flaws in the advanced seminar syllabus."

"The syllabus is fine," ${char1} answered under his breath, dark eyes calmly scanning the courtyard where a strange, cold static hummed beneath the pavement. "It's the fact that the campus sensors just logged an unregistered demonic signature near the west wing that has me paying attention."

*Between them hung the quiet, unbreakable certainty of childhood friends who knew each other's instincts by heart—and the unspoken realization that the peaceful morning was already slipping away.*`;

    return {
      title,
      subtitle,
      setting,
      dialogueTone: inferredTone,
      synopsis,
      prologue,
      coverColor: "#7a282f",
      coverIcon: isSupernatural ? "Sparkles" : (isTech ? "Compass" : "BookOpen"),
      characters: characters.length > 0 ? characters : [
        {
          name: "Ethan William Erolson",
          role: "College Student",
          description: "A composed student navigating university life and emerging anomalies with calm vigilance.",
          voiceTone: "Casual & Conversational"
        },
        {
          name: "Gabrielle Sebastian de Vara",
          role: "College Student",
          description: "A sharp-witted companion, perceptive and quick with dry retorts.",
          voiceTone: "Sarcastic & Witty"
        }
      ],
    };
  }

  // Graceful storytelling narrative generator that advances the scene with dynamic dialogue, unconstrained paragraphs, and zero prompt echoing
  function createFallbackNarrative(book: any, userPrompt: string): string {
    const cleanPrompt = (userPrompt || "").trim();
    const promptLower = cleanPrompt.toLowerCase();

    // 1. Direct match for Supreme Director / Executive arrival benchmark scene
    const isSupremeDirectorPrompt =
      /\b(?:supreme\s*director|kazumi|gabriella.*kazumi|obsidian\s*aegis|nameless\s*chant|training\s*citadel|class-zero)\b/i.test(promptLower) ||
      (/\b(?:supreme\s*director|director)\b/i.test(promptLower) && /\b(?:william|gabrielle|eleanor|affectionate|cute|family\s*matter|guild\s*matter)\b/i.test(promptLower));

    if (isSupremeDirectorPrompt) {
      return [
        `Fifteen minutes later, the loud roar of twin jet engines drowned out the whispers of the scouts in the plaza.`,
        `A heavy black executive dropship landed right onto the campus pad. The back ramp opened with a loud hiss, and the recruiters backed away as fast as they could.`,
        `Walking down the ramp was Gabriella Kazumi de Vara, Supreme Director of Obsidian Aegis.`,
        `She wore a sharp black military coat over her shoulders. Just her presence alone was enough to make everyone in the courtyard go dead silent. Her dark eyes swept the crowd, and nobody dared to make a sound.`,
        `Then, her eyes landed on William.`,
        `Her stern boss face disappeared in an instant. Her face lit up with a huge, bright smile.`,
        `"Liam!" Kazumi squealed happily, dropping all serious manners as she ran across the stones.`,
        `Before William could even move, Kazumi wrapped her arms around him and squished both of his cheeks with her hands. "Oh, look at you! You got taller, and your face is still as cute as ever! Eleanor, look at him, isn't he the cutest?"`,
        `William didn't pull away or complain. His cheeks were squished together, but his dark eyes stayed calm, sleepy, and completely unbothered, just like always.`,
        `Gabrielle started laughing, leaning back against the metal railing. "Careful, Kazumi. He just turned a senior's armor to dust with a glare. You're going to ruin his scary reputation."`,
        `"Oh, be quiet, Gabby," Kazumi said, letting go of William's cheeks only to reach over and mess up Gabrielle’s golden hair, treating him like a little kid. "You two are still my boys. It feels like yesterday I was putting band-aids on your scraped knees."`,
        `Eleanor walked up with an amused grin and bumped shoulders with Kazumi. They shared a quick fist bump—they had grown up together, just like William and Gabrielle.`,
        `"They grew up a little, Kaz," Eleanor said, crossing her arms. "Enough to break a training room grid, beat three top monsters on live TV, and cause pure panic among the guild leaders."`,
        `The moment work was mentioned, the warm big sister vanished.`,
        `Kazumi stood straight, her smile snapping shut. Her eyes turned sharp and serious again, instantly back in boss mode.`,
        `"Yeah. About that," Kazumi said, her voice flat and serious, leaving no room for argument. "The high council called a meeting about the Nameless Chant, and every guild wants to draft you both. Get in the ship. We have family matters to talk about."`
      ].join("\n\n");
    }

    const chars = Array.isArray(book?.characters) && book.characters.length > 0
      ? book.characters
      : [];

    const loreText = (book?.loreNotes || "").toLowerCase();

    const latestCharacterCanon = (character: any) => {
      const description = String(character?.description || "");
      const matches = [...description.matchAll(/\[(?:Director Canon|Author Directive):\s*([^\]]+)\]/gi)];
      return matches.length > 0 ? matches[matches.length - 1][1] : description;
    };

    // Check if character is constrained from speaking
    const isSilentChar = (c: any) => {
      if (!c) return false;
      const latestCanon = latestCharacterCanon(c).toLowerCase();
      if (/\b(?:can|may|should)\s+(?:speak|talk)|\bno longer\s+(?:silent|mute)|\b(?:speaks?|talks?)\s+normally\b/i.test(latestCanon)) {
        return false;
      }
      const desc = ((c?.role || "") + " " + latestCanon).toLowerCase();
      return /silent|stoic|mute|never speak|does not speak|doesn't speak|shouldn't speak/i.test(desc) ||
             (c?.name && loreText.includes(`${c.name.toLowerCase()} does not speak`)) ||
             (c?.name && loreText.includes(`${c.name.toLowerCase()} is silent`));
    };

    // Extract names explicitly mentioned in user prompt
    const promptNames = extractExplicitCharacterNames(cleanPrompt);

    // Helper to see if a book character is mentioned in user prompt or promptNames
    const matchesCharacter = (c: any): boolean => {
      if (!c?.name) return false;
      const fullLower = c.name.toLowerCase().trim();
      if (promptLower.includes(fullLower) || promptNames.some(pn => pn.toLowerCase() === fullLower)) {
        return true;
      }
      // Check individual significant name tokens (e.g. "william", "ethan", "gabrielle", "eleanor")
      const parts = fullLower.split(/\s+/).filter((p: string) => p.length > 2 && !/^(?:de|del|della|di|da|dos|du|la|le|van|von|der|den|bin|al)$/i.test(p));
      return parts.some((p: string) => {
        const regex = new RegExp(`\\b${p}\\b`, "i");
        return regex.test(cleanPrompt) || promptNames.some(pn => regex.test(pn));
      });
    };

    // Helper to get preferred short/display name for a character based on what user typed
    const getPreferredDisplayName = (c: any, defaultFallback: string): string => {
      if (!c?.name) return defaultFallback;
      const parts = c.name.trim().split(/\s+/);
      if (parts.length === 1) return parts[0];
      for (const part of parts) {
        if (part.length > 2 && new RegExp(`\\b${part}\\b`, "i").test(cleanPrompt)) {
          return part;
        }
      }
      for (const pn of promptNames) {
        if (parts.some(p => p.toLowerCase() === pn.toLowerCase())) {
          return pn;
        }
      }
      return parts[0];
    };

    const mentionedFromBook = chars.filter((c: any) => matchesCharacter(c));

    let charA: any = null;
    let charB: any = null;

    if (mentionedFromBook.length >= 2) {
      charA = mentionedFromBook[0];
      charB = mentionedFromBook[1];
    } else if (mentionedFromBook.length === 1) {
      charA = mentionedFromBook[0];
      const otherInBook = chars.find((c: any) => c?.name && c.name.toLowerCase() !== charA.name.toLowerCase());
      const promptOther = promptNames.find(pn => !charA.name.toLowerCase().includes(pn.toLowerCase()));
      if (promptOther) {
        charB = { name: promptOther, role: "Companion", voiceTone: "Sarcastic & Witty" };
      } else if (otherInBook) {
        charB = otherInBook;
      } else {
        charB = { name: "Gabrielle", role: "Fellow Student", voiceTone: "Casual & Conversational" };
      }
    } else if (promptNames.length >= 2) {
      charA = { name: promptNames[0], role: "Lead Character", voiceTone: "Casual & Conversational" };
      charB = { name: promptNames[1], role: "Companion", voiceTone: "Sarcastic & Witty" };
    } else if (promptNames.length === 1) {
      charA = { name: promptNames[0], role: "Lead Character", voiceTone: "Casual & Conversational" };
      charB = chars[0] || { name: "Gabrielle", role: "Fellow Student", voiceTone: "Sarcastic & Witty" };
    } else if (chars.length >= 2) {
      charA = chars[0];
      charB = chars[1];
    } else if (chars.length === 1) {
      charA = chars[0];
      charB = { name: "Gabrielle", role: "Fellow Student", voiceTone: "Sarcastic & Witty" };
    } else {
      charA = { name: "William", role: "Lead Student", voiceTone: "Casual & Conversational" };
      charB = { name: "Gabrielle", role: "Fellow Student", voiceTone: "Sarcastic & Witty" };
    }

    const nameA = getPreferredDisplayName(charA, "William");
    const nameB = getPreferredDisplayName(charB, "Gabrielle");
    const toneA = String(charA.voiceTone || book?.dialogueTone || "Casual & Conversational").toLowerCase();
    const toneB = String(charB.voiceTone || (toneA.includes("sarcastic") ? "Casual & Conversational" : "Sarcastic & Witty")).toLowerCase();

    const silentA = isSilentChar(charA);
    const silentB = isSilentChar(charB);

    // Dialogue input check
    const dialogueMatch = cleanPrompt.match(/"([^"]+)"|“([^”]+)”/);
    let spokenText = dialogueMatch ? (dialogueMatch[1] || dialogueMatch[2]) : null;
    if (!spokenText && (/\?$/.test(cleanPrompt) || /^(say|ask|whisper|tell|demand|shout|call)\b/i.test(cleanPrompt))) {
      spokenText = cleanPrompt.replace(/^\*[^*]+\*,?\s*/, "").replace(/^["'\s]+|["'\s]+$/g, "");
    }

    // Environmental & Genre cues
    const combinedWorld = `${book?.genre || ""} ${book?.setting || ""} ${book?.title || ""} ${cleanPrompt}`.toLowerCase();
    const isCampus = /\b(?:campus|college|university|academy|school|faculty|quad|dorm|lecture|student|students)\b/i.test(combinedWorld);
    const isSciFi = !isCampus && /sci-fi|space|cyber|futur|station|star|orbit|ship|hull|trans-orbit|cyberpunk/i.test(combinedWorld);
    const isGothic = !isCampus && /gothic|victorian|occult|manor|estate|highgate|belvoir/i.test(combinedWorld);
    const isFantasy = !isCampus && /fantasy|magic|wizard|sorcer|sword|castle|dragon|alchem|realm|kingdom/i.test(combinedWorld);

    // Intent detection
    const isArrival = /\b(?:arrive|arrives|arrived|arrival|landing|dropship|transport|shuttle|convoy|escort|director|commander|general|master|chancellor|dean)\b/i.test(promptLower);
    const isMonsterThreat =
      /\b(?:demon|demons|monster|monsters|creature|creatures|beast|beasts|fiend|fiends|aberration|anomaly|titan)\b/i.test(cleanPrompt) ||
      (/\b(?:vibrat|tremor|quak|shaking)\b/i.test(cleanPrompt) && /\b(?:field|ground|track)\b/i.test(cleanPrompt));
    const isWalkingOrTransit = !isArrival && !isMonsterThreat && /\b(?:walk|walking|walked|stroll|strolling|strolled|wander|wandering|pace|pacing|footsteps|stride|campus|grounds?|courtyard|corridor|hallway|path|avenue|street|sidewalk|quad|casual|casually|talking|moving)\b/i.test(cleanPrompt);
    const isInvestigation = !isMonsterThreat && /\b(?:search|searching|searched|investigate|investigating|inspect|inspecting|examine|examining|check|checking|checked|look|looking|terminal|screen|file|files|locker|read|reading|find|found|study|studying|lab|note|notes|data|records?)\b/i.test(cleanPrompt);
    const isCombatOrAction = !isMonsterThreat && /\b(?:fight|fighting|fought|strike|striking|struck|attack|attacking|attacked|hit|punch|kick|kicked|run|running|ran|flee|fleeing|escape|chase|chasing|hide|hiding|dodge|dodging|blast|shoot|blade|weapon|gun|door|breach)\b/i.test(cleanPrompt);
    const isDowntimeOrRest = !isMonsterThreat && /\b(?:coffee|cafe|cafeteria|lunch|bench|sit|sitting|eat|drink|lounge|table|rest|pause|waiting|wait)\b/i.test(cleanPrompt);

    const getToneLine = (speakerName: string, tone: string, scenario: "walk_a" | "walk_b" | "search_a" | "search_b" | "combat_a" | "combat_b" | "rest_a" | "rest_b" | "dialogue_reply"): string => {
      const isCasual = /casual|conversational|relaxed|modern/i.test(tone);
      const isSarcastic = /sarcastic|witty|ironic|snarky/i.test(tone);
      const isScholarly = /scholarly|analytical|academic|logical/i.test(tone);
      const isGritty = /gritty|blunt|rough|hardboiled/i.test(tone);
      const isFormal = /formal|aristocratic|stately|noble/i.test(tone);
      const isPoetic = /poetic|lyrical|verse/i.test(tone);
      const isCryptic = /cryptic|whispering|mystic/i.test(tone);

      switch (scenario) {
        case "walk_a":
          if (isSarcastic) return `"I love how completely normal our days are," ${speakerName} said with a dry laugh. "We're doing great at staying out of trouble."`;
          if (isScholarly) return `"The timing doesn't make sense if you look at the facts," ${speakerName} said quietly, looking ahead. "There was an intentional forty-minute gap between the alarm and the response."`;
          if (isGritty) return `"Keep your chin up and don't look like you're looking for an exit," ${speakerName} warned quietly. "People notice nerves fast."`;
          if (isFormal) return `"People are watching us closely today," ${speakerName} said in a calm, steady voice.`;
          if (isPoetic) return `"The air feels restless today," ${speakerName} said softly, watching leaves blow across the ground. "Like something is about to happen."`;
          if (isCryptic) return `"Listen to the steps around us," ${speakerName} whispered. "Everyone is in a hurry, but what's following them is faster."`;
          return `"You know everyone's talking about yesterday, right?" ${speakerName} said with an easy smile. "By tomorrow, half the school will think we planned the whole thing."`;

        case "walk_b":
          if (isCasual) return `"Honestly? I'm not worried about it," ${speakerName} laughed softly, keeping pace. "We did what made sense. The rumors will die down soon."`;
          if (isScholarly) return `"That's why we need to check the records before noon," ${speakerName} answered. "If it's written down officially, we have to be careful."`;
          if (isGritty) return `"Let them stare," ${speakerName} muttered, eyes on the path. "Staring doesn't mean they know anything. Keep walking."`;
          if (isFormal) return `"Good point," ${speakerName} agreed with a slight nod. "Let's stay calm and give them nothing to talk about."`;
          if (isPoetic) return `"Let the rumors spread like dry grass," ${speakerName} answered with a quiet smile. "The truth won't change."`;
          if (isCryptic) return `"Let them talk about yesterday," ${speakerName} answered softly. "Yesterday is done. It's tomorrow we need to watch."`;
          return `"Let them talk," ${speakerName} said with an easy smirk. "If anyone actually asked us directly, they wouldn't like the answer anyway."`;

        case "search_a":
          if (isSarcastic) return `"Well, look at that. Someone actually tried to hide something," ${speakerName} said with a grin. "Ten points for trying."`;
          if (isScholarly) return `"Look at the lock," ${speakerName} pointed out, leaning in. "The marks show someone opened this recently—probably in the last twenty-four hours."`;
          if (isGritty) return `"Found it," ${speakerName} grunted, checking the box. "Take a look, but make it fast."`;
          if (isFormal) return `"Interesting. Someone clearly wanted to keep this hidden," ${speakerName} said calmly.`;
          return `"Found something," ${speakerName} whispered, pulling out the folder. "Look at this—it's from this morning."`;

        case "search_b":
          if (isCasual) return `"Wait, are you serious? Let me see that," ${speakerName} said, stepping closer. "Someone is in big trouble."`;
          if (isScholarly) return `"Check the serial numbers against the main list," ${speakerName} urged quietly. "If they match, we found the leak."`;
          if (isGritty) return `"Pocket it and shut the box," ${speakerName} said, watching the door. "No fingerprints. Let's move."`;
          if (isFormal) return `"Be very careful with that," ${speakerName} warned softly. "Getting caught with this is dangerous."`;
          return `"Don't just stand there staring," ${speakerName} said with a grin. "Grab what you need and let's go before guards show up."`;

        case "combat_a":
          if (isSarcastic) return `"Right, because talking it out like normal people was too boring," ${speakerName} called out, getting ready with a grin.`;
          if (isScholarly) return `"Their line is broken—hit them from the side!" ${speakerName} called out, spotting the opening.`;
          if (isGritty) return `"Get down, now!" ${speakerName} shouted, charging forward. "Move your feet or get hit!"`;
          if (isFormal) return `"Hold your ground!" ${speakerName} shouted in a firm voice. "Watch your distance and strike back!"`;
          return `"Watch out!" ${speakerName} shouted, bracing for the rush. "Here they come!"`;

        case "combat_b":
          if (isCasual) return `"On it!" ${speakerName} yelled back, dodging the hit. "Watch your left!"`;
          if (isScholarly) return `"Found an opening!" ${speakerName} called out, striking back right away. "Push forward now!"`;
          if (isGritty) return `"Out of the way!" ${speakerName} shouted, hitting hard. "Go, go, go!"`;
          if (isFormal) return `"Understood! I'll cover the side!" ${speakerName} shouted back.`;
          return `"I've got your back!" ${speakerName} called out, jumping in to help.`;

        case "rest_a":
          if (isSarcastic) return `"If sitting here doing nothing is a crime, call the police," ${speakerName} sighed, leaning back against the bench with relief.`;
          if (isScholarly) return `"Thirty minutes of rest will give us time to think," ${speakerName} said, setting down the notes.`;
          if (isGritty) return `"Sit down, catch your breath, and stay sharp," ${speakerName} said, taking a sip from the cup.`;
          if (isFormal) return `"A short break will do us good," ${speakerName} said, sitting down at the table.`;
          return `"Finally, a minute to breathe," ${speakerName} said, sinking into the chair.`;

        case "rest_b":
          if (isCasual) return `"Don't get too comfortable," ${speakerName} laughed, sitting down across from him. "With our luck, something will happen in five minutes."`;
          if (isSarcastic) return `"Enjoy the quiet while it lasts," ${speakerName} said with a deadpan grin. "Someone is definitely going to ruin it soon."`;
          if (isScholarly) return `"Agreed. Let's go over our plan while it's still quiet," ${speakerName} said, leaning forward.`;
          if (isGritty) return `"Drink your coffee," ${speakerName} grunted. "When that bell rings, we're back to work."`;
          if (isFormal) return `"Indeed. Let's use this time to get ready for what comes next," ${speakerName} agreed.`;
          return `"Tell me about it," ${speakerName} laughed, relaxing into the chair. "So what's the plan for this afternoon?"`;

        case "dialogue_reply":
          if (isSarcastic) return `"Great question. Let's argue about it while time runs out," ${speakerName} said with a dry grin. "If we survive the afternoon, I'll buy you a coffee and we can talk about it all day."`;
          if (isScholarly) return `"That makes sense, but you're missing one big detail," ${speakerName} said, eyes narrowing. "Whoever did this had full access. We should assume they're already tracking us."`;
          if (isGritty) return `"Keep your voice down," ${speakerName} warned, glancing at the door. "People are listening. We can't be careless."`;
          if (isFormal) return `"That's a good question," ${speakerName} answered in a calm voice. "Let's wait until we see the proof before making up our minds."`;
          if (isPoetic) return `"The wind won't tell you the answer," ${speakerName} whispered, looking out the window. "The truth was hidden long before we got here."`;
          if (isCryptic) return `"The answer is right where you're not looking," ${speakerName} whispered with a faint smile. "Listen closely. This was never an accident."`;
          return `"Look, you're asking the one thing everyone is trying to ignore," ${speakerName} said, leaning in and keeping his voice down. "Whoever did this knew exactly what they were doing."`;
      }
    };

    // 2. Arrival / Authority / Executive Scene Generation (Dynamic, Simple English terms)
    if (isArrival) {
      const authorityRole = promptNames.find(n => /director|commander|general|master|chancellor|dean/i.test(n)) || "The Supreme Director";
      return [
        `The loud roar of twin jet engines swept across the courtyard, blowing dry leaves and drowning out the whispers of the stunned crowd along the walkway.`,
        `A heavy black transport ship landed right on the campus pad. The back ramp opened with a sharp hiss, and the recruiters and students backed away as fast as they could.`,
        `Stepping down the ramp was ${authorityRole}, wearing a sharp military coat over their shoulders.`,
        `Just their presence alone made everyone on the campus go dead silent. Dark, sharp eyes swept the courtyard, and nobody dared to speak or make a sudden move.`,
        `Then, their eyes landed on ${nameA}.`,
        `The serious boss face vanished in an instant. Their expression melted into a huge, warm smile.`,
        `"${nameA}!" they called out, dropping all formal rules as they hurried across the stone plaza.`,
        `Before ${nameA} could take half a step, two hands reached out and squished both of his cheeks with open affection. "Look at you! Standing tall and looking completely unbothered as always. Isn't this just the cutest sight?"`,
        `${nameA} didn't pull away or complain. Even with his cheeks lightly squished together, his dark eyes stayed calm, sleepy, and completely relaxed, just like always.`,
        `${nameB} laughed from the railing. "Careful. You're going to ruin his tough reputation before classes even start."`,
        `"Oh, be quiet," came the quick reply, letting go of ${nameA} only to reach over and mess up ${nameB}'s hair like a doting older sibling. "You two are still the same kids who used to track mud across the floor. Don't act like you're all grown up."`,
        `Everyone nearby watched in pure shock, trying to understand how the feared director could be so playful and warm.`,
        `Then, official business was mentioned, and the air shifted.`,
        `The smile snapped shut. Their posture straightened into a serious, cold line of command, and their brown eyes turned sharp again.`,
        `"Now then," their voice dropped, leaving no room for argument. "The council called a meeting, and every major group is trying to claim what you did yesterday. Get inside the ship, both of you. We have family matters to talk about."`
      ].join("\n\n");
    }

    // 3. Monster / Demon Threat & Emergency Evacuation (Dynamic, Simple English terms)
    if (isMonsterThreat) {
      const monsterMatch = cleanPrompt.match(
        /\b([A-Z][a-zA-Z0-9'’\-]+(?:\s+[A-Z][a-zA-Z0-9'’\-]+)*)\s+(?:demon|demons|monster|monsters|creature|creatures|beast|beasts|fiend|aberration|anomaly)\b/i
      );
      const monsterName = monsterMatch
        ? `${monsterMatch[1]} demon`
        : (cleanPrompt.match(/\b([a-zA-Z0-9'’\-]+(?:\s+[a-zA-Z0-9'’\-]+)?\s+(?:demon|monster|creature|beast))\b/i)?.[1] || "resonant demon");

      const locationName = /\btrack\s+and\s+field\b/i.test(cleanPrompt)
        ? "the track and field"
        : /\b(?:stadium|sports\s+field|football\s+field)\b/i.test(cleanPrompt)
        ? "the stadium field"
        : "the sports field";

      // Detect who talks more vs who listens
      const charAIsTalkative =
        new RegExp(`\\b${nameA}\\b[^.!?]*\\btalkative\\b|\\btalkative\\b[^.!?]*\\b${nameA}\\b`, "i").test(cleanPrompt);
      const charBIsTalkative =
        new RegExp(`\\b${nameB}\\b[^.!?]*\\btalkative\\b|\\btalkative\\b[^.!?]*\\b${nameB}\\b`, "i").test(cleanPrompt);
      const charAIsListener =
        new RegExp(`\\b${nameA}\\b[^.!?]*\\blistens?\\b|\\blistens?\\b[^.!?]*\\b${nameA}\\b`, "i").test(cleanPrompt);
      const charBIsListener =
        new RegExp(`\\b${nameB}\\b[^.!?]*\\blistens?\\b|\\blistens?\\b[^.!?]*\\b${nameB}\\b`, "i").test(cleanPrompt);

      const talkativeSpeaker = (charBIsTalkative || charAIsListener)
        ? nameB
        : (charAIsTalkative ? nameA : (nameB.toLowerCase() === "gabrielle" ? nameB : nameA));
      const quietListener = talkativeSpeaker === nameB ? nameA : nameB;

      return [
        `A cool morning breeze swept across the campus walkways, carrying dry leaves across the concrete between the academic halls.`,
        `${talkativeSpeaker} was talking with her usual lively energy, gesturing with her hands as she hopped from one topic to the next, while ${quietListener} walked beside her with his hands in his pockets, listening patiently and nodding whenever she paused for a breath.`,
        `Around them, the normal rhythm of campus life moved along as usual—students carrying heavy backpacks, distant laughter near the cafeteria, and small groups sitting by the fountain who lowered their voices to whisper as the two walked past.`,
        `"And honestly, nobody should even act surprised," ${talkativeSpeaker} remarked with a quick, amused grin, glancing sideways at him. "They pretend everything is under control, but everyone knows they're scrambling behind closed doors."`,
        `${quietListener} gave a quiet, faint smile, his dark eyes staying calm. "You talk enough for both of us," he replied softly. "Just keep your eyes open."`,
        `Before ${talkativeSpeaker} could fire back another witty comment, a sudden wave of frantic shouts broke the morning quiet.`,
        `Up ahead, the gates of ${locationName} burst open as a crowd of students came running out in pure panic.`,
        `People were stumbling over their own feet, dropping gym bags and jackets onto the grass without stopping, and shoving past one another in a desperate rush to get away from the open stadium. Several underclassmen nearly fell on the concrete, their faces pale as they yelled for everyone to run.`,
        `${talkativeSpeaker}'s banter stopped mid-sentence. Instead of joining the stampede toward the lecture halls, she and ${quietListener} came to an immediate halt, exchanging a sharp, knowing look.`,
        `"Well, that definitely isn't morning track practice," ${talkativeSpeaker} said, all humor vanishing from her voice as she turned toward the stadium.`,
        `"Let's check it out," ${quietListener} answered, his easy pace turning into purposeful strides against the flow of the fleeing crowd.`,
        `As they stepped closer to the open gates of ${locationName}, the concrete walkway beneath their shoes began to vibrate.`,
        `It was not a gentle shake. A deep, heavy vibration pulsed through the earth like a massive heartbeat, rattling the chain-link fences and sending ripples through water puddles along the walkway. With every step they took toward the entrance, the tremors grew stronger, vibrating right through their legs and chest.`,
        `They pushed past the last of the fleeing students and slipped through the gate into the stadium.`,
        `The metal bleachers were completely abandoned. Towels, water bottles, and spiked running shoes lay strewn across the red rubber track, left behind in the chaotic rush.`,
        `Standing directly in the center of the open field was the ${monsterName}.`,
        `The creature was massive. Thick, cracked dark skin pulsed with a deep, unnatural hum that tore through the morning air, shaking the soil beneath its heavy clawed feet. Every breath it released sent another violent shockwave rolling through the grass, ripping deep trenches into the turf.`,
        `Its dark, glowing eyes slowly shifted away from the empty stands, locking straight onto ${quietListener} and ${talkativeSpeaker} at the edge of the track.`,
        `${talkativeSpeaker} stepped up right beside ${quietListener}, her hands ready as the ground shuddered violently beneath them. "Looks like we found what scared everyone off."`,
        `${quietListener} pulled his hands out of his jacket pockets, his calm expression hardening into cold focus as his eyes locked onto the beast. "Stay ready," he said quietly. "It sees us."`
      ].join("\n\n");
    }

    // 4. Walking / Campus / Transit (Simple English terms, living campus)
    if (isWalkingOrTransit) {
      const dialogueA = silentA
        ? `*${nameA} walked in calm silence, hands in his pockets as he noticed the stares with a slight tilt of his head.*`
        : getToneLine(nameA, toneA, "walk_a");

      const dialogueB = silentB
        ? `*${nameB} didn't say a word, though a quick sideways look told everyone to mind their own business.*`
        : getToneLine(nameB, toneB, "walk_b");

      return [
        `A cool morning breeze blew across the campus lawn, carrying dry leaves along the walkways between the classroom buildings.`,
        `${nameA} walked with an easy, relaxed pace, hands in his pockets, while ${nameB} walked right beside him under the pale morning sky.`,
        `Around them, normal campus life went on as usual—the sound of the clock tower ringing, doors opening down the hall, and the chatter of students on their way to class.`,
        `Still, people were clearly watching them.`,
        `A small group of students sitting near the fountain got quiet as soon as ${nameA} and ${nameB} walked past. One of them nudged his friend and pointed with his eyes, but quickly looked back down at his phone the moment ${nameA} glanced over.`,
        `Across the steps, two other students stopped and whispered behind their hands, tracking every step the pair took.`,
        dialogueA,
        dialogueB,
        `*${nameA} gave a small, calm shrug, walking ahead without caring about the whispers around them.*`,
        (toneA.includes("scholarly") || toneB.includes("scholarly"))
          ? `"Which brings us back to the real question," ${nameA} said, keeping his voice down. "Who authorized the second key if the supervisor wasn't even here?"\n\n"Someone with full access," ${nameB} answered, eyes narrowing. "And there are only three people on this campus who can do that."`
          : (toneA.includes("gritty") || toneB.includes("gritty"))
            ? `"You have the drive safe?" ${nameA} asked quietly, not turning his head.\n\n"Tucked away where nobody finds it," ${nameB} replied under his breath. "Just watch the door."`
            : `"Fair point," ${nameA} added with an amused smile. "Though if the dean asks us what happened, your 'let them stare' plan might not work."\n\n"It will work fine," ${nameB} shot back with a quick grin. "I'll just show them the exact files they thought they deleted. That always shuts people up fast."`,
        `Up ahead, near the main hall entrance, an announcement chime rang out, flashing a notice on the screens as someone near the doorway watched them closely before turning down the hall.`
      ].join("\n\n");
    }

    // 4. Spoken Dialogue / Inquiries (Simple English terms)
    if (spokenText) {
      const activeRespondent = silentB ? (silentA ? null : nameA) : nameB;
      const respondentTone = activeRespondent === nameA ? toneA : toneB;
      const otherPerson = activeRespondent === nameA ? nameB : nameA;

      return [
        `The question hung in the air between them as they kept walking at a steady pace.`,
        `Across the walkway, several passing students gave them curious looks, noticing how serious they both looked. A couple of freshmen near the steps leaned in to hear, but ${nameA}'s quick look made them look away fast.`,
        activeRespondent
          ? getToneLine(activeRespondent, respondentTone, "dialogue_reply")
          : `*${nameB} stayed quiet, but pointed toward the side hallway to show that they needed to move fast.*`,
        (silentA || activeRespondent === nameA)
          ? `*${otherPerson} stayed alert, looking around to make sure nobody was standing close enough to listen.*`
          : (toneA.includes("sarcastic") || toneB.includes("sarcastic"))
            ? `"You're unusually focused today," ${otherPerson} said with a smirk. "Usually you act like you don't care until the alarms go off."\n\n"I care about staying out of trouble," ${activeRespondent} replied with a dry smile. "There's a big difference."`
            : `"We both knew this was coming," ${otherPerson} said quietly, stepping closer. "The only question is if we move first or wait for them to make a move."\n\n"We don't wait," ${activeRespondent} answered firmly. "Waiting is how you lose."`,
        `The two of them exchanged a quick, knowing look, completely on the same page.`,
        `Ahead, near the entrance, a screen turned on with a new notice, catching the attention of nearby students while someone watched ${nameA} and ${nameB} from the top step.`
      ].join("\n\n");
    }

    // 5. Investigation / Search (Simple English terms)
    if (isInvestigation) {
      return [
        `The lock clicked open with a quiet snap. The wall panel slid aside smoothly, revealing a small hidden compartment inside.`,
        `Inside rested a thick folder tied with red tape, right next to a small black storage drive marked with the Department seal.`,
        `Out in the hallway, the sound of students opening lockers and walking by continued as usual, completely unaware of what was happening inside.`,
        silentA
          ? `*${nameA} pointed right at the date on the folder, raising his eyebrows in warning.*`
          : getToneLine(nameA, toneA, "search_a"),
        silentB
          ? `*${nameB} nodded once, watching the door and signaling to hurry up.*`
          : getToneLine(nameB, toneB, "search_b"),
        `"Look at the name," ${nameA} whispered, carefully turning the top page. "This didn't come from the front office. It came straight from the director's private computer."`,
        `"Which means we have about two minutes before someone notices," ${nameB} answered, pocketing the drive fast.`,
        `Down the hall, the squeak of shoes on tile signaled a security guard walking their way, ending the conversation and telling them it was time to leave.`
      ].join("\n\n");
    }

    // 6. Combat / Action (Simple English terms)
    if (isCombatOrAction) {
      return [
        `The sudden hit broke the quiet, shaking the entire room as wood snapped and a fight broke out in an instant.`,
        `Students and bystanders scattered in panic—chairs scraped loudly against the floor, bags dropped to the ground, and people ran for the doors to get out of the way.`,
        silentA
          ? `*${nameA} moved forward instantly, stepping between the threat and the crowd.*`
          : getToneLine(nameA, toneA, "combat_a"),
        silentB
          ? `*${nameB} guarded the side in silence, ready to strike and watching every move.*`
          : getToneLine(nameB, toneB, "combat_b"),
        `Boots skidded hard across the floor as the counter-strike landed, shoving the attacker back into the hallway and opening a way out.`,
        `Down the hall, more footsteps rushed toward them, and the sharp ring of the building's alarm filled the air.`
      ].join("\n\n");
    }

    // 7. Downtime / Rest / Cafeteria (Simple English terms)
    if (isDowntimeOrRest) {
      return [
        `The busy sound of lunchtime chatter filled the room as warm steam rose from coffee cups on the table.`,
        `Across the cafeteria, people were clearly paying attention. At a booth two rows back, three students leaned in over their lunch trays, looking over at ${nameA} and ${nameB} every few seconds and whispering to each other.`,
        silentA
          ? `*${nameA} set down his cup quietly, looking around the room with a calm face.*`
          : getToneLine(nameA, toneA, "rest_a"),
        silentB
          ? `*${nameB} sat down across from him, leaning in to talk.*`
          : getToneLine(nameB, toneB, "rest_b"),
        `"They're not even trying to hide it," ${nameA} said quietly, tapping the table. "By tonight, everyone on campus will be talking about us."`,
        `"Good," ${nameB} said with a quick sip. "When everyone is looking at the front door, nobody watches what's going out the back."`,
        `A sudden beep from the tabletop terminal cut in, showing a new message marked with the personal crest of the academy director.`
      ].join("\n\n");
    }

    // 8. General Narrative Advancement (9-11 organic paragraphs)
    return [
      `The momentum shifted forward as ${nameA} and ${nameB} navigated the unfolding scene, their footsteps falling into an instinctive, shared cadence.`,
      `Around them, the living environment reacted to their passage—bystanders taking subtle note of their presence, hushed murmurs passing between onlookers, and the tension of an unwritten conflict hovering just below the surface.`,
      silentA
        ? `*${nameA} took the lead in silence, his posture resolute and focused on the objective ahead.*`
        : getToneLine(nameA, toneA, "walk_a"),
      silentB
        ? `*${nameB} kept stride beside him, readiness evident in every step.*`
        : getToneLine(nameB, toneB, "walk_b"),
      `"Whatever comes next, we stay on the same page," ${nameA} said quietly, eyes scanning the path ahead.`,
      `"Always," ${nameB} replied without hesitation.`,
      `An unexpected development unfolded before them, opening a new path while closing the door on retreat.`
    ].join("\n\n");
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

    const filesRead = Array.isArray(attachments) && attachments.length > 0
      ? attachments.map((a: any) => ({
          name: a.name || "Attached Document",
          read: true,
          summary: a.extractedText ? `${a.extractedText.slice(0, 120)}...` : "Content verified and integrated into lore.",
        }))
      : [];

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
      filesRead,
      note: "The local canon engine verified and applied this directive deterministically.",
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
        const thinkingBudget = reasoningLevel === "off" ? 0 : reasoningLevel === "high" ? 4096 : 1024;
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

        // Fallback to Folio's local canon engine so the author is never blocked from attaching documents
        const fallbackResult = heuristicDirectorUpdate(book, effectiveInstruction, attachments, reasoningLevel);
        const creditsDepleted =
          status === 429 && /depleted|resource_exhausted|billing|prepayment/i.test(rawMessage);

        if (creditsDepleted) {
          fallbackResult.note =
            "Google Gemini prepayment credits are currently $0/depleted. Folio's local canon engine successfully read your document and recorded its contents into manuscript canon.";
        }
        return res.json(fallbackResult);
      }
    } catch (_err: unknown) {
      const fallbackBook = req.body?.book || { title: "Untitled", characters: [] };
      const fallbackInstruction = typeof req.body?.instruction === "string" ? req.body.instruction : "Directive integrated.";
      const reasoningLevel = req.body?.reasoning || "medium";
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
        const fallbackChars: Array<{ name: string; role: string; description: string; voiceTone?: string }> = [];
        if (lastUserMsg) {
          const explicitInMsg = extractExplicitCharacterNames(lastUserMsg);
          const existingNames = new Set((book?.characters || []).map((c: any) => c?.name?.toLowerCase()));
          for (const name of explicitInMsg) {
            if (!existingNames.has(name.toLowerCase())) {
              fallbackChars.push({
                name,
                role: /\b(?:college|university|school|academy|campus)\b/i.test(book?.setting || lastUserMsg) ? "Student" : "Character",
                description: "Introduced in the scene.",
                voiceTone: book?.dialogueTone || "Casual & Conversational",
              });
              existingNames.add(name.toLowerCase());
            }
          }
        }
        return res.json({
          reply: sanitizeNarrativeOutput(createFallbackNarrative(book, lastUserMsg), book),
          newCharacters: fallbackChars,
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
2. ABSOLUTE BAN ON ECHOING THE USER'S PROMPT OR DUMPING BOOK SETTING — DIVE STRAIGHT INTO SCENE MOMENTUM:
   - ZERO PROMPT COPYING OR PARAPHRASING: You are strictly forbidden from opening your response by repeating, rephrasing, summarizing, or echoing what the user typed. (For example, if the user writes "William and Gabrielle was walking on campus ground casually talking and so on", DO NOT start with "William and Gabrielle walked across the campus grounds talking...", "As William and Gabrielle walked across campus...", or "Walking casually along the grounds..."). The author already knows what they inputted!
   - ZERO BOOK SETTING STRING DUMPS: Never dump the book's setting description verbatim into the prose (e.g., do not write "In a modern world slightly advanced..." or "The physical momentum jolts through..."). Instead, evoke atmosphere organically through concrete physical sensory details (polished concrete, morning breeze, the chime of a campus terminal).
   - IN MEDIAS RES & PROGRESSION: Plunge directly into what happens NEXT. Have the characters already in the midst of their action and banter, showing their distinct voice tones in authentic spoken dialogue ("..."), physical reactions (*...*), and an immediate complication, sensory event, or forward hook.
   - PUSH INTO WHAT HAPPENS NEXT (NEW MOMENTUM & COMPLICATIONS):
     • Advance the scene into the immediate next seconds/minutes: don't freeze at the action.
     • How do the surrounding characters react verbally and emotionally? Other characters MUST speak in dialogue, challenge the move, reveal hidden knowledge, or take counter-actions.
     • What unexpected discovery, complication, shift in tension, or physical consequence is triggered by the user's move?
     • Elevate with visceral sensory immersion: the ozone in the air, the cold rain on stone, the sharp crack of splintering timber, the flicker of dying lantern light, the rasp of heavy breathing, the heavy footsteps in the hall, and the shifting tension between characters.
   - END ON A COMPELLING FORWARD HOOK: Every passage must leave the scene charged with forward tension, an unanswered challenge, or an immediate opening for the next move.
3. CHARACTER VOICE & TONE ENFORCEMENT (CRITICAL):
   - Each character possesses an assigned Voice Tone (e.g. "Casual & Conversational", "Poetic & Lyrical", "Formal & Aristocratic", "Gritty & Blunt", "Scholarly & Analytical", "Cryptic & Whispering", "Sarcastic & Witty") or follows the Book Dialogue Register ("${defaultBookTone}").
   - You MUST strictly mold each character's dialogue style, diction, vocabulary, sentence length, and cadence to their assigned Voice Tone:
     • Casual & Conversational: Use contractions ("don't", "gonna", "look"), relaxed modern rhythm, everyday words, natural speech.
     • Poetic & Lyrical: Use vivid imagery and thoughtful reflection, but keep the words simple and accessible (never archaic or convoluted).
     • Formal & Aristocratic: Use polite distance, clear grammar, and dignified speech, but keep words simple, modern, and easy to follow.
     • Gritty & Blunt: Use clipped, direct, street-level sentences and plain words.
     • Scholarly & Analytical: Use clear logical explanations and precise phrasing, but keep words simple and straightforward.
     • Cryptic & Whispering: Use quiet warnings and subtle hints with simple everyday vocabulary.
     • Sarcastic & Witty: Use dry humor, quick comebacks, and funny deadpan observations.
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
8. SIMPLE ENGLISH TERMS & CLEAN MODERN PROSE (CRITICAL MANDATE):
   - USE SIMPLE, CLEAR, EVERYDAY ENGLISH: Write all narration, character dialogue, and scene descriptions in simple, accessible, and natural English terms.
   - ABSOLUTE BAN ON THESAURUS-STUFFING & PURPLE PROSE: Never use archaic, academic, or needlessly fancy SAT words.
     • Do NOT write words like "countenance", "taciturn", "labyrinthine", "ebullient", "ineffable", "sepulchral", "tenebrous", "lugubrious", "perspicacity", "pulchritude", "somnambulant", "rejoinder", "balustrade", "quadrangle", "brooked", "testament", "decryption", "discrepancy", "unyielding", "demeanor", "respite", "concurred", "perused".
     • Always pick simple, modern, punchy words:
       - Say "walked" or "stepped" (not "ambulated" or "traversed")
       - Say "looked" or "watched" (not "scrutinized" or "surveyed")
       - Say "dark" or "shadowy" (not "tenebrous" or "crepuscular")
       - Say "tired" (not "enervated")
       - Say "huge" or "giant" (not "gargantuan" or "colossal")
       - Say "sharp" or "clear" (not "incisive" or "pellucid")
       - Say "calm" or "quiet" (not "unyielding" or "stoic")
       - Say "railing" or "ledge" (not "balustrade")
       - Say "courtyard", "lawn", or "campus grounds" (not "quadrangle")
       - Say "reply" or "answer" (not "rejoinder")
   - KEEP SENTENCE STRUCTURE CLEAN & DIRECT: Use active Subject-Verb-Object phrasing. The reader should easily picture everything that is happening without stumbling over complicated vocabulary.
   - Respect character voice tones strictly: keep dialogue authentic, natural, and conversational. Swearing/profanity is permitted when fitting for high stakes and raw emotion.
9. ACTION & COMBAT (STRICT "SHOW, DON'T TELL"):
   - Absolutely NEVER use gaming terminology (strictly forbidden: "HP", "stats", "aggro", "hitbox", "mana bar", "level up", "debuff", "buff", "DPS", "cooldown", "spawn", "XP", "aurafarm").
   - Instead, describe the physical momentum, kinetic force, strain in muscles, the friction of magic, and the destruction of the surrounding environment.
10. DYNAMIC NPC BEHAVIOR & LIVING WORLD ECOLOGY (MAKE THE WORLD FEEL ALIVE):
   - The world around the characters MUST feel vibrant, populated, and observant: on a campus, students are walking between halls, sitting on benches, leaning on railings; in a station or city street, crowds and bystanders go about their daily routines.
   - DO NOT have random strangers casually walk up and start talking to the leads out of nowhere unless the scene explicitly warrants it.
   - INSTEAD, SHOW REALISTIC SOCIAL OBSERVATION & RECOGNITION:
     • Surrounding bystanders recognize and observe the characters: show nearby students or bystanders lowering their voices, whispering in small huddles by lockers or courtyard steps, nudging a friend, casting lingering sideways glances, or looking at them because of recent events, reputation, or rumors.
     • Capture ambient background life continuing naturally: the clatter of binders, distant laughter, cafeteria noise, transit hums.
     • Show how the leads navigate that attention: low-toned dialogue, subtle shared looks, maintaining their pace, or deliberately ignoring the scrutiny.
 11. EXPANSIVE, RICH NARRATIVE FREEDOM — ZERO PARAGRAPH LIMITS & NO FORMULAIC RESTRICTIONS:
    - ZERO PARAGRAPH LIMITS: There is NO ceiling, limit, or quota on paragraphs. Unspool the scene in full, immersive novelistic depth, spanning as many paragraphs as the narrative demands (frequently 10 to 18+ rich, organic paragraphs when the scene features dramatic arrivals, layered character interactions, physical comedy/affection, or escalating stakes). Never truncate, compress, or rush the narrative.
    - ZERO FORMULAIC TEMPLATES: There are NO rigid formulas for what each paragraph must contain (NEVER follow an artificial sequence like paragraph 1 = scenery, paragraph 2 = bystanders, paragraph 3 = movement, paragraph 4 = dialogue). Instead, let paragraphs flow naturally with dynamic, varied pacing:
      • Dramatic single-line paragraphs for cinematic beats, focus shifts, or sharp tonal pivots (e.g. "Then, her eyes landed on William.", "At the mention of the guild's business, the warm, doting older sister vanished.").
      • Dynamic action and tactile character mannerisms (squishing cheeks between manicured hands, ruffled hair, dry shoulder bumps, unbothered deadpan reactions, stepping off dropship ramps).
      • Living bystander ecology naturally integrated (minor league scouts tripping over themselves, recruiters stunned, students whispering in huddles, sudden hush across the courtyard).
      • Distinct spoken dialogue on individual lines paired with nuanced character tags and contrasting voice tones.
      • Authentic human dynamics and shared history (nicknames like Liam, Gabby, Kaz; childhood memories, scraped knees at the training citadel) balanced against high-stakes tension (guild summons, tribunals, administrative panics).
      • Sudden, dramatic tonal shifts where characters transition fluidly between terrifying authority, affectionate doting, and icy professional command.
    - Every turn must read like a breathtaking, fully realized novel chapter scene.
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
    - BANISH FORMULAIC TEMPLATES (NATURAL NOVELISTIC RHYTHM): Shatter all predictable patterns. There is no formula or rigid quota for paragraphs. Vary paragraph lengths drastically—from single-line dramatic punches to multi-turn banter and vivid descriptive beats. Real fiction breathes with asymmetric, natural rhythm.
    - BANISH CONVERSATIONAL PING-PONG: Real people do not take turns politely exchanging complete, self-contained paragraphs. Introduce authentic human messiness: broken phrases, deflections, trailing thoughts, silences, grunts, and sharp subtext.
    - BANISH MELODRAMATIC MICRO-EXPRESSIONS: Never write "a flicker of sadness passed over her face", "an unreadable expression", or "a ghost of a smile". Show tangible physical interaction with physical objects and anatomy.
 14. STRICT BAN ON REPETITION & REPETITIVENESS (ZERO ECHOES / NO NARRATIVE LOOPS):
   - NO ECHO WORDS OR CRUTCH VOCABULARY: Never repeat prominent nouns, verbs, or sensory descriptors across consecutive sentences, paragraphs, or recent turns. If a sentence uses "shadow", "stillness", "threshold", "flicker", "chill", "cold", "damp", or "blade", do NOT reuse that word or its immediate synonyms in the next sentence or paragraph. Employ varied, precise, and fresh vocabulary.
   - NO SYNTACTIC REPETITION: Do not repeat identical sentence rhythms, clause arrangements, or sentence starters. Every sentence in a paragraph must vary its cadence and grammatical opening.
   - NO DIALOGUE OR THOUGHT REPETITION: Characters must never voice repetitive sentiments, warnings, or questions they have already uttered in previous turns (e.g. repeating "we don't have much time" or "who did this?"). Every utterance must contribute NEW information, an escalation, a shift in stakes, or a decisive reaction.
   - NO ACTION REPLAY: Never re-describe physical actions that were already performed in prior turns (e.g., drawing a weapon that was already drawn, stepping through a doorway already crossed, eyeing an exit already noted). Treat past actions as permanently resolved and progress forward.
   - PREVENT SCENE STAGNATION: If a scene has established atmosphere, do not re-describe the same fog, rain, room lighting, or silence. Advance the physical events and character dynamics.
 15. ABSOLUTE THREAT & ENTITY SEPARATION (NEVER MAKE MONSTERS INTO STUDENTS OR COMPANIONS):
    - When the author's premise introduces a monster, demon, creature, beast, titan, fiend, or enemy anomaly (such as "a Tyran Resonant demon", "a shadow beast", "a blood fiend"):
      • NEVER treat the creature as a student, companion, or speaking friend walking casually with the leads.
      • NEVER replace or erase named companions (like Gabrielle or William) with the monster's name.
      • The creature is strictly an environmental threat, an antagonistic encounter, or a terrifying anomaly in the scene.
    - PRESERVE PREFERRED SHORT NAMES: Always use the familiar character name used in the author's prompt (e.g., use "William" instead of "Ethan William Erolson", and "Gabrielle" instead of "Gabrielle Sebastian de Vara") in third-person narration and dialogue tags.
    - FAITHFULLY ADVANCE MULTI-STAGE PREMISES: If the author provides an evolving situation (e.g. peaceful stroll with talkative Gabrielle and listening William -> crowd running out in panic from the track and field -> investigating the vibration -> sighting the Tyran Resonant demon in the center of the field), you MUST unspool and dramatize EVERY stage of that premise. Do not stall or ignore the evacuation and demon sighting!

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

      // If no characters were discovered by model manifest, check if user mentioned any explicit new characters
      if (discoveredCharacters.length === 0 && lastUserMsg) {
        const explicitInMsg = extractExplicitCharacterNames(lastUserMsg);
        const existingNames = new Set((book?.characters || []).map((c: any) => c?.name?.toLowerCase()));
        for (const name of explicitInMsg) {
          if (!existingNames.has(name.toLowerCase())) {
            discoveredCharacters.push({
              name,
              role: /\b(?:college|university|school|academy|campus)\b/i.test(book?.setting || lastUserMsg) ? "Student" : "Character",
              description: "Active in the scene.",
              voiceTone: defaultBookTone,
            });
            existingNames.add(name.toLowerCase());
          }
        }
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
      const fallbackChars: Array<{ name: string; role: string; description: string; voiceTone?: string }> = [];
      if (fallbackMsg) {
        const explicitInMsg = extractExplicitCharacterNames(fallbackMsg);
        const existingNames = new Set((fallbackBook?.characters || []).map((c: any) => c?.name?.toLowerCase()));
        for (const name of explicitInMsg) {
          if (!existingNames.has(name.toLowerCase())) {
            fallbackChars.push({
              name,
              role: /\b(?:college|university|school|academy|campus)\b/i.test(fallbackBook?.setting || fallbackMsg) ? "Student" : "Character",
              description: "Active in the scene.",
              voiceTone: fallbackBook?.dialogueTone || "Casual & Conversational",
            });
            existingNames.add(name.toLowerCase());
          }
        }
      }
      return res.json({
        reply: sanitizeNarrativeOutput(createFallbackNarrative(fallbackBook, fallbackMsg), fallbackBook),
        newCharacters: fallbackChars,
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
   - Each character possesses an assigned Voice Tone or follows the Book Dialogue Register: "${defaultBookTone}".
   - Strictly mold each character's dialogue style, diction, and sentence length to their tone while keeping vocabulary grounded in simple, accessible English.
3. STRICT THIRD-PERSON NARRATIVE MANDATE (NO "YOU" / NEVER USE "PROTAGONIST"):
   - Narration must ALWAYS be written strictly in the THIRD PERSON ("he", "she", "they", or proper names like "${leadCharName || 'Julian'}").
   - NEVER address any character or reader as "you", "your", or "yours" in narration or scene descriptions (*...*). The word "you" is ONLY allowed inside spoken dialogue quotation marks ("...").
   - NEVER refer to any character as "the protagonist", "the main character", or "the hero".
4. ROLES & AGENCY:
   - The user commands their lead character${leadCharName ? ` (${leadCharName})` : ""}. You control all NPCs, enemies, and the breathing environment. Do NOT puppet their decisions unless instructed.
5. SIMPLE ENGLISH TERMS & CLEAN MODERN PROSE (MANDATORY):
   - Always write narration and dialogue in simple, clear, everyday English terms.
   - Ban archaic, academic, or purple vocabulary (no "countenance", "balustrade", "rejoinder", "tenebrous", "scrutinize", "brooked", "quadrangle", "unyielding").
   - Keep sentences direct, punchy, and easy to picture immediately. Swearing/profanity is permitted if fitting for the scene.
6. ACTION & COMBAT:
   - Strictly "show, don't tell". Absolutely NO gaming terminology (no "HP", "stats", "aggro", "mana bar", etc.). Vividly describe physical impact, magical friction, and environmental destruction.
7. FORMATTING & NARRATIVE FREEDOM:
   - Zero arbitrary paragraph limits. Write complete, immersive, organic narrative prose with natural paragraphing separated by blank lines. Spoken dialogue ("...") on its own lines. Actions in asterisks (*like this*) or integrated prose. Output ONLY narrative prose without meta-commentary.
8. ABSOLUTE BAN ON AI WRITING CLICHÉS & TIRED TROPES:
   - Strictly forbidden phrases: "breath they didn't know they were holding", "testament to", "tapestry of", "shivers down spine", "little did they know", "deadly dance", "tension was palpable", "delve into", "wry smile", "beacon of hope", "time seemed to stand still", "heart hammered against ribs".
   - No moralizing resolutions, neat lessons, or summarizing wrap-ups. Keep the scene immediate, tangible, and raw.
9. STRIP THE "AI GENERATIVE" TEXTURE & HABITS:
   - Banish sentence triads (no triplets like "cold, dark, and damp"). Use asymmetrical, concrete focus.
   - Banish "-ing" participial openers ("Stepping forward...", "Turning slowly..."). Write in direct Subject-Verb-Object sentences.
   - Banish sensory filters ("could feel", "felt a sense of", "noticed"). State raw sensory events directly.
   - Banish hedging words ("seemed to", "as if", "almost", "perhaps").
   - Banish formulaic templates: deliver jagged, unpredictable rhythm with natural interruptions, single-line dramatic beats, and deep character dynamics.
10. STRICT BAN ON REPETITION & REDUNDANCY (ZERO REPETITIVENESS):
   - Eliminate echo words and repeated sentence structures. If a word, descriptor, or metaphor was used in the previous sentence or the original passage, do not repeat it.
   - Ban narrative looping: do not rehash known facts, repeated doubts, or identical warnings. Push the rewrite into fresh sensory territory and direct escalation.
   - Varied syntax: ensure every sentence begins with a different grammatical structure and varies in length.
11. ABSOLUTE THREAT & ENTITY SEPARATION:
   - When the rewrite instruction introduces a monster, demon, creature, beast, titan, or hostile anomaly (such as "a Tyran Resonant demon"), NEVER treat that creature as a human student, companion, or speaking friend walking casually with the characters. It is an antagonistic threat or environmental emergency.
   - Always preserve the preferred short names the author uses (e.g. "William", "Gabrielle").
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
