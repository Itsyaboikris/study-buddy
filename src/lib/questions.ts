import * as fuzz from "fuzzball";
import questionsData from "@/data/questions.json";
import type { Course, MatchMode, QuestionsData } from "@/lib/types";

const data = questionsData as QuestionsData;

const FLEXIBLE_THRESHOLD = 90;
const ORDERED_THRESHOLD = 88;
const KEYWORD_THRESHOLD = 85;

export function getCourses(): Course[] {
  return data.courses.filter((course) => course.questions.length > 0);
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

/**
 * Grade typed answers with fuzzball.
 * - flexible (default): order-independent token_set_ratio for lists
 * - ordered: ratio scoring so verse/step sequence still matters, typos OK
 */
export function answersMatch(
  userAnswer: string,
  accepted: string[],
  matchMode: MatchMode = "flexible",
): boolean {
  const normalized = normalizeAnswer(userAnswer);
  if (!normalized) return false;

  return accepted.some((option) => {
    const target = normalizeAnswer(option);
    if (!target) return false;
    if (normalized === target) return true;

    if (matchMode === "ordered") {
      return fuzz.ratio(normalized, target) >= ORDERED_THRESHOLD;
    }

    return fuzz.token_set_ratio(normalized, target) >= FLEXIBLE_THRESHOLD;
  });
}

export function keywordsMatch(userAnswer: string, keywords: string[]): boolean {
  const normalized = normalizeAnswer(userAnswer);
  if (!normalized || keywords.length === 0) return false;

  const userTokens = normalized.split(" ").filter(Boolean);

  const hits = keywords.filter((keyword) => {
    const target = normalizeAnswer(keyword);
    if (!target) return false;
    if (normalized.includes(target)) return true;

    // Allow small typos in multi-word or single keywords.
    if (fuzz.partial_ratio(target, normalized) >= KEYWORD_THRESHOLD) {
      return true;
    }

    return target.split(" ").every((part) => {
      if (!part) return true;
      if (userTokens.includes(part)) return true;
      return userTokens.some(
        (token) => fuzz.ratio(token, part) >= KEYWORD_THRESHOLD,
      );
    });
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
