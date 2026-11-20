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
const KEYWORD_THRESHOLD = 78;
/** Flexible answers must cover at least this share of the target's content words. */
const FLEXIBLE_COVERAGE = 0.75;
/** Typing-slip tolerance applies only to words at least this long. */
const ORDERED_SLIP_MIN_LEN = 5;

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

/** Word-level diff ops for ordered (verse) grading feedback. */
export type VerseDiffOp =
  | { kind: "match"; expected: string; actual: string; slip: boolean }
  | { kind: "missing"; expected: string }
  | { kind: "extra"; actual: string }
  | { kind: "substitute"; expected: string; actual: string };

export type OrderedMatchResult = {
  correct: boolean;
  /** True when the answer passed only with 1-letter slips on long words. */
  hadSlips: boolean;
  /** Alignment against the best-matching accepted answer. */
  ops: VerseDiffOp[];
  /** Accepted answer text used for the alignment (display form). */
  acceptedAnswer: string;
};

const LEADING_VERSE_REF =
  /^(?:(?:[123]|i{1,3})\s+)?(?:psalms?|proverbs?|james|isaiah|joshua|lamentations?|corinthians?|cor)\s+\d+\s*:\s*\d+(?:\s*-\s*\d+)?\s+/i;

/** Lowercase, strip punctuation/refs/verse numbers, return ordered words. */
export function tokenizeVerse(text: string): string[] {
  let value = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  value = value.replace(LEADING_VERSE_REF, "");
  value = value.replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();

  return value.split(" ").filter((word) => word.length > 0 && !/^\d+$/.test(word));
}

function letterEditDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const prev = new Array<number>(cols);
  const curr = new Array<number>(cols);
  for (let j = 0; j < cols; j += 1) prev[j] = j;

  for (let i = 1; i < rows; i += 1) {
    curr[0] = i;
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j < cols; j += 1) prev[j] = curr[j]!;
  }

  return prev[b.length]!;
}

function orderedWordsEqual(
  expected: string,
  actual: string,
): "exact" | "slip" | false {
  if (expected === actual) return "exact";
  if (
    expected.length >= ORDERED_SLIP_MIN_LEN &&
    actual.length >= ORDERED_SLIP_MIN_LEN &&
    letterEditDistance(expected, actual) <= 1
  ) {
    return "slip";
  }
  return false;
}

/** Align user words to expected words (word-level edit script). */
export function alignVerseWords(
  expected: string[],
  actual: string[],
): VerseDiffOp[] {
  const m = expected.length;
  const n = actual.length;
  const dist: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0),
  );

  for (let i = 0; i <= m; i += 1) dist[i]![0] = i;
  for (let j = 0; j <= n; j += 1) dist[0]![j] = j;

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const match = orderedWordsEqual(expected[i - 1]!, actual[j - 1]!);
      const subCost = match ? 0 : 1;
      dist[i]![j] = Math.min(
        dist[i - 1]![j]! + 1,
        dist[i]![j - 1]! + 1,
        dist[i - 1]![j - 1]! + subCost,
      );
    }
  }

  const ops: VerseDiffOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const match = orderedWordsEqual(expected[i - 1]!, actual[j - 1]!);
      const subCost = match ? 0 : 1;
      if (dist[i]![j] === dist[i - 1]![j - 1]! + subCost) {
        if (match) {
          ops.push({
            kind: "match",
            expected: expected[i - 1]!,
            actual: actual[j - 1]!,
            slip: match === "slip",
          });
        } else {
          ops.push({
            kind: "substitute",
            expected: expected[i - 1]!,
            actual: actual[j - 1]!,
          });
        }
        i -= 1;
        j -= 1;
        continue;
      }
    }
    if (i > 0 && dist[i]![j] === dist[i - 1]![j]! + 1) {
      ops.push({ kind: "missing", expected: expected[i - 1]! });
      i -= 1;
      continue;
    }
    ops.push({ kind: "extra", actual: actual[j - 1]! });
    j -= 1;
  }

  ops.reverse();
  return ops;
}

function orderedCost(ops: VerseDiffOp[]): number {
  return ops.reduce((sum, op) => {
    if (op.kind === "match") return sum;
    return sum + 1;
  }, 0);
}

function orderedHadSlips(ops: VerseDiffOp[]): boolean {
  return ops.some((op) => op.kind === "match" && op.slip);
}

/**
 * Strict ordered (verse) match: every word must align with zero missing,
 * extra, or substituted words. Long words may differ by one letter (slip).
 */
export function matchOrderedAnswer(
  userAnswer: string,
  accepted: string[],
): OrderedMatchResult {
  const actual = tokenizeVerse(userAnswer);
  const options = accepted.filter((option) => tokenizeVerse(option).length > 0);

  if (actual.length === 0 || options.length === 0) {
    const fallback = accepted[0] ?? "";
    return {
      correct: false,
      hadSlips: false,
      ops: actual.map((word) => ({ kind: "extra" as const, actual: word })),
      acceptedAnswer: fallback,
    };
  }

  let best: OrderedMatchResult | null = null;

  for (const option of options) {
    const expected = tokenizeVerse(option);
    const ops = alignVerseWords(expected, actual);
    const cost = orderedCost(ops);
    const candidate: OrderedMatchResult = {
      correct: cost === 0,
      hadSlips: cost === 0 && orderedHadSlips(ops),
      ops,
      acceptedAnswer: option,
    };

    if (
      !best ||
      cost < orderedCost(best.ops) ||
      (cost === orderedCost(best.ops) && candidate.correct && !best.correct)
    ) {
      best = candidate;
    }

    if (candidate.correct) return candidate;
  }

  return best!;
}

/**
 * Grade typed answers with fuzzball (flexible) or strict word alignment (ordered).
 * - flexible (default): order-independent coverage for lists
 * - ordered: word-level verse/sequence match; no missing/extra/substituted words
 * - paraphrase: looser flexible threshold for short-answer meaning matches
 */
export function answersMatch(
  userAnswer: string,
  accepted: string[],
  matchMode: MatchMode = "flexible",
  options?: { paraphrase?: boolean },
): boolean {
  if (matchMode === "ordered") {
    return matchOrderedAnswer(userAnswer, accepted).correct;
  }

  const normalized = normalizeAnswer(userAnswer);
  if (!normalized) return false;

  const flexibleThreshold = options?.paraphrase
    ? FLEXIBLE_PARAPHRASE_THRESHOLD
    : FLEXIBLE_THRESHOLD;

  return accepted.some((option) => {
    const target = normalizeAnswer(option);
    if (!target) return false;
    if (normalized === target) return true;
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

/** One term linked to its meaning in the user's answer. */
export function pairMatches(userAnswer: string, pair: AnswerPair): boolean {
  const normalized = normalizeAnswer(userAnswer);
  if (!normalized) return false;

  const clauses = normalized
    .split(/\n|;|\.|:| - | – | — |,/g)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    const tokens = clause.split(" ").filter(Boolean);
    if (
      alternativeHits(clause, tokens, pair.term) &&
      alternativeHits(clause, tokens, pair.meaning)
    ) {
      return true;
    }
  }

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
}

/**
 * Require each term to appear near its correct meaning so swapped
 * definitions (Stoics ↔ Areopagus) do not pass.
 */
export function pairsMatch(userAnswer: string, pairs: AnswerPair[]): boolean {
  if (pairs.length === 0) return false;
  const normalized = normalizeAnswer(userAnswer);
  if (!normalized) return false;
  return pairs.every((pair) => pairMatches(userAnswer, pair));
}

/** Human-readable term labels for pairs the user did not link correctly. */
export function missedPairLabels(
  userAnswer: string,
  pairs: AnswerPair[],
  modelAnswer?: string,
): string[] {
  const modelItems =
    modelAnswer
      ?.split(";")
      .map((part) => part.trim())
      .filter(Boolean) ?? [];

  return pairs
    .filter((pair) => !pairMatches(userAnswer, pair))
    .map((pair) => {
      const termAlt = pair.term.split("|")[0]?.trim() || pair.term;
      const termNorm = normalizeAnswer(termAlt);
      const fromModel = modelItems.find((item) =>
        normalizeAnswer(item).includes(termNorm),
      );
      return fromModel ?? termAlt;
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
