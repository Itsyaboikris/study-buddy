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
  matchOrderedAnswer,
  missedKeywordLabels,
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

describe("ordered verse matching", () => {
  const james516 = questionsData.courses
    .flatMap((course) => course.questions)
    .find((question) => question.id === "ptr-james-516-01");
  const joshuaFull = questionsData.courses
    .flatMap((course) => course.questions)
    .find((question) => question.id === "ptr-joshua-2415-full-01");
  const cor51 = questionsData.courses
    .flatMap((course) => course.questions)
    .find((question) => question.id === "ptr-return-scripture-v51-01");
  const corPassage = questionsData.courses
    .flatMap((course) => course.questions)
    .find((question) => question.id === "ptr-return-scripture-passage-01");

  const jamesAnswers =
    james516 && james516.type === "fill_blank" ? james516.answers : [];
  const joshuaAnswers =
    joshuaFull && joshuaFull.type === "fill_blank" ? joshuaFull.answers : [];
  const cor51Answers =
    cor51 && cor51.type === "fill_blank" ? cor51.answers : [];
  const passageAnswers =
    corPassage && corPassage.type === "fill_blank" ? corPassage.answers : [];

  it("accepts an exact verse", () => {
    expect(answersMatch(jamesAnswers[0]!, jamesAnswers, "ordered")).toBe(true);
  });

  it("ignores verse numbers and punctuation", () => {
    expect(
      answersMatch(
        "51 Behold, I shew you a mystery; We shall not all sleep, but we shall all be changed,",
        cor51Answers,
        "ordered",
      ),
    ).toBe(true);
    expect(
      answersMatch(
        "Psalm 139:14 I will praise thee; for I am fearfully and wonderfully made: marvellous are thy works; and that my soul knoweth right well",
        [
          "i will praise thee; for i am fearfully and wonderfully made: marvellous are thy works; and that my soul knoweth right well",
        ],
        "ordered",
      ),
    ).toBe(true);
  });

  it("allows a one-letter slip on a long word (availith → availeth)", () => {
    const withSlip = jamesAnswers[0]!.replace("availeth", "availith");
    const result = matchOrderedAnswer(withSlip, jamesAnswers);
    expect(result.correct).toBe(true);
    expect(result.hadSlips).toBe(true);
    expect(
      result.ops.some(
        (op) =>
          op.kind === "match" &&
          op.slip &&
          op.actual === "availith" &&
          op.expected === "availeth",
      ),
    ).toBe(true);
  });

  it("rejects short-word spelling changes (show ≠ shew, you ≠ ye, the ≠ thy)", () => {
    expect(
      answersMatch(
        cor51Answers[0]!.replace("shew", "show"),
        cor51Answers,
        "ordered",
      ),
    ).toBe(false);
    expect(
      answersMatch(
        "choose you this day whom you will serve",
        ["choose you this day whom ye will serve"],
        "ordered",
      ),
    ).toBe(false);
    expect(
      answersMatch(
        "o death, where is the sting? o grave, where is thy victory?",
        [
          "o death, where is thy sting? o grave, where is thy victory?",
        ],
        "ordered",
      ),
    ).toBe(false);
  });

  it("fails when one word is missing", () => {
    const words = jamesAnswers[0]!.split(/\s+/);
    words.splice(3, 1);
    expect(answersMatch(words.join(" "), jamesAnswers, "ordered")).toBe(false);
  });

  it("fails when one word is added", () => {
    const withExtra = jamesAnswers[0]!.replace(
      "confess your faults",
      "confess your many faults",
    );
    expect(answersMatch(withExtra, jamesAnswers, "ordered")).toBe(false);
  });

  it("fails the 1 Cor 15:51-55 passage when any one verse is missing", () => {
    const full = passageAnswers[0]!;
    const without52 = full.replace(
      /in a moment, in the twinkling of an eye, at the last trump: for the trumpet shall sound, and the dead shall be raised incorruptible, and we shall be changed\.\s*/i,
      "",
    );
    expect(without52).not.toBe(full);
    expect(answersMatch(without52, passageAnswers, "ordered")).toBe(false);
  });

  it("rejects the shortened Joshua 24:15 form", () => {
    expect(
      answersMatch(
        "choose you this day whom ye will serve but as for me and my house we will serve the lord",
        joshuaAnswers,
        "ordered",
      ),
    ).toBe(false);
    expect(joshuaAnswers).toHaveLength(1);
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

describe("requireAll keyword lists", () => {
  const prayerBlockers = [
    "unconfessed sin",
    "insincerity",
    "carnal motives",
    "unbelief",
    "satanic",
    "domestic",
    "pride",
    "robbing god",
    "biblical teaching",
    "forgive",
    "needy",
  ];
  const modelAnswer =
    "Unconfessed sin; Insincerity; Carnal motives; Unbelief; Satanic Activity; Domestic Problems; Pride; Robbing God; Refusing to submit to biblical teaching; Refusing to forgive or be forgiven; Refusing to help the needy";

  it("fails when only 7 of 11 prayer blockers are present and names the 4 missing", () => {
    const seven =
      "unconfessed sin, insincerity, carnal motives, unbelief, satanic activity, domestic problems, pride";
    expect(
      keywordsMatch(seven, prayerBlockers, { requireAll: true }),
    ).toBe(false);
    expect(keywordsMatch(seven, prayerBlockers)).toBe(true);

    const missed = missedKeywordLabels(seven, prayerBlockers, modelAnswer);
    expect(missed).toHaveLength(4);
    expect(missed.map((label) => label.toLowerCase()).join(" ")).toMatch(
      /robbing/,
    );
    expect(missed.map((label) => label.toLowerCase()).join(" ")).toMatch(
      /biblical teaching/,
    );
    expect(missed.map((label) => label.toLowerCase()).join(" ")).toMatch(
      /forgive/,
    );
    expect(missed.map((label) => label.toLowerCase()).join(" ")).toMatch(
      /needy/,
    );
  });

  it("passes all 11 prayer blockers in any order with a couple of typos", () => {
    const answer =
      "needy help, forgive or be forgiven, biblical teaching, robbing god, pride, domestic problems, satanic activity, unbelif, carnal motives, insincerity, unconfessed sin";
    expect(
      keywordsMatch(answer, prayerBlockers, { requireAll: true }),
    ).toBe(true);
    expect(missedKeywordLabels(answer, prayerBlockers, modelAnswer)).toEqual(
      [],
    );
  });
});
