import { describe, expect, it } from "vitest";
import {
  MEMORY_VERSES_COURSE_ID,
  PRIMARY_VERSE_WRITE_IDS,
  VERSE_WRITE_TAG,
  answersMatch,
  getCourses,
  isVerseWriteQuestion,
  keywordsMatch,
} from "@/lib/questions";

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
