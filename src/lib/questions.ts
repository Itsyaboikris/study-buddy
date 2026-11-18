import * as fuzz from "fuzzball";
import questionsData from "@/data/questions.json";
import type { Course, MatchMode, Question, QuestionsData } from "@/lib/types";

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

function isVerseQuestion(question: Question): boolean {
  return question.tags?.includes(MEMORY_VERSE_TAG) ?? false;
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
    id: "memory-verses",
    title: "Memory Verses",
    shortTitle: "Verses",
    questions,
  };
}

export function getCourses(): Course[] {
  const courses = data.courses.filter((course) => course.questions.length > 0);
  const verses = buildMemoryVersesCourse(courses);
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

/** Keywords may use alternatives with | e.g. "oath|pledge|vow". */
export function keywordsMatch(userAnswer: string, keywords: string[]): boolean {
  const normalized = normalizeAnswer(userAnswer);
  if (!normalized || keywords.length === 0) return false;

  const userTokens = normalized.split(" ").filter(Boolean);

  const hits = keywords.filter((keyword) => {
    const alternatives = keyword
      .split("|")
      .map((part) => normalizeAnswer(part))
      .filter(Boolean);

    return alternatives.some((alt) =>
      keywordAlternativeMatches(normalized, userTokens, alt),
    );
  });

  return hits.length >= Math.ceil(keywords.length * 0.6);
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
