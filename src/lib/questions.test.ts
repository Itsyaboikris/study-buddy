import { describe, expect, it } from "vitest";
import { answersMatch, keywordsMatch } from "@/lib/questions";

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
