import { describe, expect, it } from "vitest";
import {
  MEMORY_VERSES_COURSE_ID,
  PRIMARY_VERSE_WRITE_IDS,
  VERSE_WRITE_TAG,
  answersMatch,
  getCourseById,
  getCourses,
  isVerseWriteQuestion,
  keywordsMatch,
} from "@/lib/questions";
import { spacePairedQuestions } from "@/lib/progress";
import type { Question, QuestionsData } from "@/lib/types";
import questionsJson from "@/data/questions.json";

const questionsData = questionsJson as QuestionsData;

const ANTIOCH_CALL = [
  "ministering to the lord, fasting, and praying",
  "ministering to the lord, fasting, praying",
  "ministering fasting praying",
  "praying, fasting, and ministering to the lord",
  "ministering to the lord, praying and fasting",
  "ministering to the lord praying and fasting",
];

const ANTIOCH_START = ["antioch", "the church at antioch"];

describe("answersMatch flexible mode", () => {
  it("accepts listed alternatives and reordered phrases", () => {
    expect(answersMatch("antioch", ANTIOCH_START)).toBe(true);
    expect(
      answersMatch("praying, fasting and ministering to the lord", ANTIOCH_CALL),
    ).toBe(true);
    expect(answersMatch("ministering fasting praying", ANTIOCH_CALL)).toBe(
      true,
    );
  });

  it("allows minor typos on single-token answers", () => {
    expect(answersMatch("selucia", ["seleucia"])).toBe(true);
  });

  it("rejects partial subset answers", () => {
    expect(answersMatch("praying", ANTIOCH_CALL)).toBe(false);
    expect(answersMatch("fasting", ANTIOCH_CALL)).toBe(false);
    expect(answersMatch("lord", ANTIOCH_CALL)).toBe(false);
    expect(answersMatch("the church", ANTIOCH_START)).toBe(false);
  });

  it("rejects near-miss place names that only share a prefix", () => {
    expect(answersMatch("pergamum", ["perga"])).toBe(false);
  });
});

describe("memory verses course", () => {
  it("includes a primary write-the-verse question for each scripture", () => {
    const versesCourse = getCourses().find(
      (course) => course.id === MEMORY_VERSES_COURSE_ID,
    );
    expect(versesCourse).toBeDefined();

    const byId = new Map(
      versesCourse!.questions.map((question) => [question.id, question]),
    );

    for (const id of PRIMARY_VERSE_WRITE_IDS) {
      const question = byId.get(id);
      expect(question, `missing primary verse write: ${id}`).toBeDefined();
      expect(isVerseWriteQuestion(question!)).toBe(true);
      expect(question!.tags).toContain(VERSE_WRITE_TAG);
    }

    const primaryCount = versesCourse!.questions.filter(isVerseWriteQuestion)
      .length;
    expect(primaryCount).toBeGreaterThanOrEqual(PRIMARY_VERSE_WRITE_IDS.length);
  });

  it("contains only fill_blank verse-writing questions", () => {
    const verses = getCourseById(MEMORY_VERSES_COURSE_ID);
    expect(verses).toBeDefined();
    expect(verses!.questions.length).toBeGreaterThan(0);
    for (const question of verses!.questions) {
      expect(question.type).toBe("fill_blank");
      expect(question.tags).toContain("memory-verse");
    }
  });
});

describe("verseOnly questions", () => {
  it("are excluded from their home course and included in Memory Verses", () => {
    const rawPath = questionsData.courses.find(
      (course) => course.id === "path-to-righteousness",
    );
    expect(rawPath).toBeDefined();

    const verseOnlyIds = rawPath!.questions
      .filter((question) => question.verseOnly)
      .map((question) => question.id);
    expect(verseOnlyIds.length).toBeGreaterThan(0);

    const path = getCourseById("path-to-righteousness");
    const verses = getCourseById(MEMORY_VERSES_COURSE_ID);
    expect(path).toBeDefined();
    expect(verses).toBeDefined();

    const pathIds = new Set(path!.questions.map((question) => question.id));
    const verseIds = new Set(verses!.questions.map((question) => question.id));

    for (const id of verseOnlyIds) {
      expect(pathIds.has(id), `${id} should leave Path`).toBe(false);
      expect(verseIds.has(id), `${id} should stay in Verses`).toBe(true);
    }
  });
});

describe("spacePairedQuestions", () => {
  it("keeps paired questions at least 10 apart when the deck allows", () => {
    const deck: Question[] = Array.from({ length: 20 }, (_, index) => ({
      id: `q-${index}`,
      type: "true_false",
      prompt: `Q${index}`,
      explanation: "x",
      answer: true,
    }));
    deck[0] = { ...deck[0]!, id: "a", pairId: "twin" };
    deck[1] = {
      id: "b",
      type: "true_false",
      prompt: "Qb",
      explanation: "x",
      answer: false,
      pairId: "twin",
    };

    const spaced = spacePairedQuestions(deck, 10);
    const indexA = spaced.findIndex((question) => question.id === "a");
    const indexB = spaced.findIndex((question) => question.id === "b");
    expect(Math.abs(indexA - indexB)).toBeGreaterThanOrEqual(10);
  });

  it("spaces pairs as far as the deck allows when shorter than the gap", () => {
    const deck: Question[] = [
      {
        id: "a",
        type: "true_false",
        prompt: "A",
        explanation: "x",
        answer: true,
        pairId: "twin",
      },
      {
        id: "b",
        type: "true_false",
        prompt: "B",
        explanation: "x",
        answer: false,
        pairId: "twin",
      },
      {
        id: "c",
        type: "true_false",
        prompt: "C",
        explanation: "x",
        answer: true,
      },
    ];

    const spaced = spacePairedQuestions(deck, 10);
    const indexA = spaced.findIndex((question) => question.id === "a");
    const indexB = spaced.findIndex((question) => question.id === "b");
    expect(Math.abs(indexA - indexB)).toBe(2);
  });
});

describe("keywordsMatch", () => {
  it("passes short keyword answers for the Acts plot question", () => {
    expect(
      keywordsMatch("forty oath kill paul", [
        "forty",
        "oath|pledge|vow|sworn",
        "not eat|eat anything",
        "kill paul|killed paul|paul killed",
      ]),
    ).toBe(true);
  });
});
