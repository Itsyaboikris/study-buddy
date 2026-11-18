import { shuffle } from "@/lib/questions";
import type { Question } from "@/lib/types";

export type QuestionRecord = {
  timesSeen: number;
  timesMissed: number;
  lastResult: "correct" | "missed" | null;
};

export type CourseProgress = {
  version: 1;
  deckIds: string[];
  index: number;
  pass: number;
  stats: { seen: number; correct: number };
  records: Record<string, QuestionRecord>;
};

const STORAGE_PREFIX = "study-buddy:progress:";

function storageKey(courseId: string): string {
  return `${STORAGE_PREFIX}${courseId}`;
}

export function emptyRecord(): QuestionRecord {
  return { timesSeen: 0, timesMissed: 0, lastResult: null };
}

export function loadCourseProgress(courseId: string): CourseProgress | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(storageKey(courseId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CourseProgress;
    if (!parsed || parsed.version !== 1) return null;
    if (!Array.isArray(parsed.deckIds)) return null;
    if (typeof parsed.index !== "number" || typeof parsed.pass !== "number") {
      return null;
    }
    if (
      !parsed.stats ||
      typeof parsed.stats.seen !== "number" ||
      typeof parsed.stats.correct !== "number"
    ) {
      return null;
    }
    if (!parsed.records || typeof parsed.records !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCourseProgress(
  courseId: string,
  progress: CourseProgress,
): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey(courseId), JSON.stringify(progress));
  } catch {
    // Storage may be unavailable (private mode, quota, etc.).
  }
}

export function clearCourseProgress(courseId: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(storageKey(courseId));
  } catch {
    // Ignore storage failures.
  }
}

export type DeckWeightOptions = {
  /** Multiply base weight when a question has this tag (highest multiplier wins). */
  tagWeightMultipliers?: Record<string, number>;
};

/** Prefer questions missed more often when starting a new pass. */
export function buildWeightedDeck(
  questions: Question[],
  records: Record<string, QuestionRecord>,
  options?: DeckWeightOptions,
): Question[] {
  if (questions.length <= 1) return [...questions];

  const scored = questions.map((question) => {
    const missed = records[question.id]?.timesMissed ?? 0;
    let tagBoost = 1;
    const multipliers = options?.tagWeightMultipliers;
    if (multipliers && question.tags) {
      for (const tag of question.tags) {
        const mult = multipliers[tag];
        if (mult && mult > tagBoost) tagBoost = mult;
      }
    }
    const weight = (1 + missed) * tagBoost;
    return { question, sortKey: Math.random() * weight };
  });

  scored.sort((a, b) => b.sortKey - a.sortKey);
  return scored.map((entry) => entry.question);
}

export function restoreDeck(
  questions: Question[],
  saved: CourseProgress | null,
  deckOptions?: DeckWeightOptions,
): { deck: Question[]; index: number; pass: number; stats: CourseProgress["stats"]; records: Record<string, QuestionRecord> } {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const records: Record<string, QuestionRecord> = {};

  for (const question of questions) {
    const existing = saved?.records?.[question.id];
    records[question.id] = existing
      ? {
          timesSeen: existing.timesSeen ?? 0,
          timesMissed: existing.timesMissed ?? 0,
          lastResult: existing.lastResult ?? null,
        }
      : emptyRecord();
  }

  if (!saved) {
    return {
      deck: buildWeightedDeck(questions, records, deckOptions),
      index: 0,
      pass: 1,
      stats: { seen: 0, correct: 0 },
      records,
    };
  }

  const deck = saved.deckIds
    .map((id) => byId.get(id))
    .filter((question): question is Question => Boolean(question));

  // Dropped/renamed IDs — rebuild rather than resume a broken deck.
  if (deck.length === 0) {
    return {
      deck: buildWeightedDeck(questions, records, deckOptions),
      index: 0,
      pass: Math.max(1, saved.pass || 1),
      stats: {
        seen: Math.max(0, saved.stats.seen || 0),
        correct: Math.max(0, saved.stats.correct || 0),
      },
      records,
    };
  }

  // Append any new questions that weren't in the saved deck.
  const inDeck = new Set(deck.map((question) => question.id));
  for (const question of shuffle(questions)) {
    if (!inDeck.has(question.id)) deck.push(question);
  }

  return {
    deck,
    index: Math.min(Math.max(0, saved.index), deck.length - 1),
    pass: Math.max(1, saved.pass || 1),
    stats: {
      seen: Math.max(0, saved.stats.seen || 0),
      correct: Math.max(0, saved.stats.correct || 0),
    },
    records,
  };
}

export function recordAnswer(
  records: Record<string, QuestionRecord>,
  questionId: string,
  correct: boolean,
): Record<string, QuestionRecord> {
  const prev = records[questionId] ?? emptyRecord();
  return {
    ...records,
    [questionId]: {
      timesSeen: prev.timesSeen + 1,
      timesMissed: prev.timesMissed + (correct ? 0 : 1),
      lastResult: correct ? "correct" : "missed",
    },
  };
}
