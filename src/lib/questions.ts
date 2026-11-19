import * as fuzz from "fuzzball";
import questionsData from "@/data/questions.json";
import type {
  AnswerPair,
  Course,
  MatchMode,
  Question,
  QuestionsData,
} from "@/lib/types";

const data = questionsData as QuestionsData;

const FLEXIBLE_THRESHOLD = 90;
const FLEXIBLE_PARAPHRASE_THRESHOLD = 75;
const ORDERED_THRESHOLD = 88;
const KEYWORD_THRESHOLD = 78;
/** Flexible answers must cover at least this share of the target's content words. */
const FLEXIBLE_COVERAGE = 0.75;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

const MEMORY_VERSE_TAG = "memory-verse";
export const VERSE_WRITE_TAG = "verse-write";
export const MEMORY_VERSES_COURSE_ID = "memory-verses";

/** Primary “write the whole verse” prompts — one per scripture in the Verses tab. */
export const PRIMARY_VERSE_WRITE_IDS = [
  "ptr-james-516-recall-01",
  "ptr-isaiah-586-recall-01",
  "ptr-joshua-2415-full-01",
  "ptr-return-scripture-v51-01",
  "ptr-return-scripture-v52-01",
  "ptr-return-scripture-v53-01",
  "ptr-return-scripture-v54-01",
  "ptr-return-scripture-v55-01",
  "ptr-return-scripture-passage-01",
  "fl-lam-322-recall-01",
  "fl-prov-151-recall-01",
  "fl-psalm-139-recall-01",
] as const;

function isVerseQuestion(question: Question): boolean {
  return question.tags?.includes(MEMORY_VERSE_TAG) ?? false;
}

export function isVerseWriteQuestion(question: Question): boolean {
  return question.tags?.includes(VERSE_WRITE_TAG) ?? false;
}

function buildMemoryVersesCourse(courses: Course[]): Course | null {
  const seen = new Set<string>();
  const questions: Question[] = [];

  for (const course of courses) {
    for (const question of course.questions) {
      if (!isVerseQuestion(question) || seen.has(question.id)) continue;
      seen.add(question.id);
      questions.push(question);
    }
  }

  if (questions.length === 0) return null;

  return {
    id: MEMORY_VERSES_COURSE_ID,
    title: "Memory Verses",
    shortTitle: "Verses",
    questions,
  };
}

function withoutVerseOnly(course: Course): Course {
  return {
    ...course,
    questions: course.questions.filter((question) => !question.verseOnly),
  };
}

export function getCourses(): Course[] {
  const source = data.courses.filter((course) => course.questions.length > 0);
  // Build Verses from the full source (including verseOnly), then strip those
  // from home courses so writing drills don't also appear in Path/Family/etc.
  const verses = buildMemoryVersesCourse(source);
  const courses = source
    .map(withoutVerseOnly)
    .filter((course) => course.questions.length > 0);
  return verses ? [...courses, verses] : courses;
}

export function getCourseById(id: string): Course | undefined {
  return getCourses().find((course) => course.id === id);
}

export function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export function normalizeAnswer(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['']/g, "'")
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensClose(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) {
    return Math.abs(a.length - b.length) <= 2;
  }
  return fuzz.ratio(a, b) >= KEYWORD_THRESHOLD;
}

function significantTokens(normalized: string): string[] {
  return normalized.split(" ").filter((token) => token && !STOPWORDS.has(token));
}

/**
 * Flexible match: user must cover most of the target's content words (any order),
 * with per-token typo tolerance. Avoids token_set_ratio false positives when the
 * user answer is only a subset of the target (e.g. "praying" ⊂ full phrase).
 */
function flexibleCoversTarget(
  normalizedUser: string,
  target: string,
  fuzzyFloor: number,
): boolean {
  const userTokens = significantTokens(normalizedUser);
  const targetTokens = significantTokens(target);

  if (targetTokens.length === 0) {
    return fuzz.ratio(normalizedUser, target) >= fuzzyFloor;
  }

  if (userTokens.length === 0) return false;

  const covered = targetTokens.filter((targetToken) =>
    userTokens.some((userToken) => tokensClose(userToken, targetToken)),
  ).length;

  return covered / targetTokens.length >= FLEXIBLE_COVERAGE;
}

function keywordAlternativeMatches(
  normalized: string,
  userTokens: string[],
  target: string,
): boolean {
  if (!target) return false;
  if (normalized.includes(target)) return true;
  if (fuzz.partial_ratio(target, normalized) >= KEYWORD_THRESHOLD) return true;

  // Multi-word keyword: all parts present in any order (kill paul ≈ paul was killed).
  const parts = target.split(" ").filter(Boolean);
  return parts.every((part) =>
    userTokens.some((token) => tokensClose(token, part)),
  );
}

/**
 * Grade typed answers with fuzzball.
 * - flexible (default): order-independent token_set_ratio for lists
 * - ordered: ratio scoring so verse/step sequence still matters, typos OK
 * - paraphrase: looser flexible threshold for short-answer meaning matches
 */
export function answersMatch(
  userAnswer: string,
  accepted: string[],
  matchMode: MatchMode = "flexible",
  options?: { paraphrase?: boolean },
): boolean {
  const normalized = normalizeAnswer(userAnswer);
  if (!normalized) return false;

  const flexibleThreshold = options?.paraphrase
    ? FLEXIBLE_PARAPHRASE_THRESHOLD
    : FLEXIBLE_THRESHOLD;

  return accepted.some((option) => {
    const target = normalizeAnswer(option);
    if (!target) return false;
    if (normalized === target) return true;

    if (matchMode === "ordered") {
      return fuzz.ratio(normalized, target) >= ORDERED_THRESHOLD;
    }

    return flexibleCoversTarget(normalized, target, flexibleThreshold);
  });
}

function alternativeHits(
  normalized: string,
  userTokens: string[],
  pattern: string,
): boolean {
  const alternatives = pattern
    .split("|")
    .map((part) => normalizeAnswer(part))
    .filter(Boolean);

  return alternatives.some((alt) =>
    keywordAlternativeMatches(normalized, userTokens, alt),
  );
}

export type KeywordsMatchOptions = {
  /** Require every keyword (full-list recall). Default is ~60% coverage. */
  requireAll?: boolean;
};

/** Keywords may use alternatives with | e.g. "oath|pledge|vow". */
export function keywordsMatch(
  userAnswer: string,
  keywords: string[],
  options?: KeywordsMatchOptions,
): boolean {
  const normalized = normalizeAnswer(userAnswer);
  if (!normalized || keywords.length === 0) return false;

  const userTokens = normalized.split(" ").filter(Boolean);

  const hits = keywords.filter((keyword) =>
    alternativeHits(normalized, userTokens, keyword),
  );

  if (options?.requireAll) {
    return hits.length === keywords.length;
  }

  return hits.length >= Math.ceil(keywords.length * 0.6);
}

/**
 * Labels for keywords the user missed — prefer the matching modelAnswer
 * segment, otherwise the keyword's first alternative.
 */
export function missedKeywordLabels(
  userAnswer: string,
  keywords: string[],
  modelAnswer?: string,
): string[] {
  const normalized = normalizeAnswer(userAnswer);
  const userTokens = normalized.split(" ").filter(Boolean);
  const modelItems =
    modelAnswer
      ?.split(";")
      .map((part) => part.trim())
      .filter(Boolean) ?? [];

  return keywords
    .filter(
      (keyword) => !alternativeHits(normalized, userTokens, keyword),
    )
    .map((keyword) => {
      const firstAlt = keyword.split("|")[0]?.trim() || keyword;
      const fromModel = modelItems.find((item) => {
        const itemNorm = normalizeAnswer(item);
        const itemTokens = itemNorm.split(" ").filter(Boolean);
        return (
          alternativeHits(itemNorm, itemTokens, keyword) ||
          itemNorm.includes(normalizeAnswer(firstAlt))
        );
      });
      return fromModel ?? firstAlt;
    });
}

const PAIR_WINDOW = 70;

function findPatternIndexes(normalized: string, pattern: string): number[] {
  const alternatives = pattern
    .split("|")
    .map((part) => normalizeAnswer(part))
    .filter(Boolean);
  const indexes: number[] = [];

  for (const alt of alternatives) {
    let from = 0;
    while (from < normalized.length) {
      const at = normalized.indexOf(alt, from);
      if (at === -1) break;
      indexes.push(at);
      from = at + Math.max(alt.length, 1);
    }
  }

  return indexes;
}

/**
 * Require each term to appear near its correct meaning so swapped
 * definitions (Stoics ↔ Areopagus) do not pass.
 */
export function pairsMatch(userAnswer: string, pairs: AnswerPair[]): boolean {
  const normalized = normalizeAnswer(userAnswer);
  if (!normalized || pairs.length === 0) return false;

  const clauses = normalized
    .split(/\n|;|\.|:| - | – | — |,/g)
    .map((part) => part.trim())
    .filter(Boolean);

  return pairs.every((pair) => {
    // Prefer clause-level linking when the user writes labeled lines.
    for (const clause of clauses) {
      const tokens = clause.split(" ").filter(Boolean);
      if (
        alternativeHits(clause, tokens, pair.term) &&
        alternativeHits(clause, tokens, pair.meaning)
      ) {
        return true;
      }
    }

    // Fallback: term and meaning must sit in the same local window.
    const termIndexes = findPatternIndexes(normalized, pair.term);
    const meaningIndexes = findPatternIndexes(normalized, pair.meaning);
    if (termIndexes.length === 0 || meaningIndexes.length === 0) {
      return false;
    }

    return termIndexes.some((termAt) =>
      meaningIndexes.some(
        (meaningAt) => Math.abs(termAt - meaningAt) <= PAIR_WINDOW,
      ),
    );
  });
}

export type ShuffledChoice = {
  text: string;
  originalIndex: number;
};

export function shuffleChoices(choices: string[]): ShuffledChoice[] {
  return shuffle(
    choices.map((text, originalIndex) => ({ text, originalIndex })),
  );
}
