import questionsData from "@/data/questions.json";
import type { Course, QuestionsData } from "@/lib/types";

const data = questionsData as QuestionsData;

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

export function answersMatch(userAnswer: string, accepted: string[]): boolean {
  const normalized = normalizeAnswer(userAnswer);
  if (!normalized) return false;

  return accepted.some((option) => {
    const target = normalizeAnswer(option);
    return (
      normalized === target ||
      normalized.includes(target) ||
      target.includes(normalized)
    );
  });
}

export function keywordsMatch(userAnswer: string, keywords: string[]): boolean {
  const normalized = normalizeAnswer(userAnswer);
  if (!normalized || keywords.length === 0) return false;

  const hits = keywords.filter((keyword) =>
    normalized.includes(normalizeAnswer(keyword)),
  );

  return hits.length >= Math.ceil(keywords.length * 0.6);
}
