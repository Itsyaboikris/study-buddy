import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  MultipleChoiceQuestion,
  QuestionsData,
  TrueFalseQuestion,
} from "../src/lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(
  readFileSync(join(root, "src/data/questions.json"), "utf8"),
) as QuestionsData;

const LONGEST_MARGIN = 0.3;

type McAudit = {
  id: string;
  courseId: string;
  margin: number;
};

function isMultipleChoice(
  question: QuestionsData["courses"][number]["questions"][number],
): question is MultipleChoiceQuestion {
  return question.type === "multiple_choice";
}

function isTrueFalse(
  question: QuestionsData["courses"][number]["questions"][number],
): question is TrueFalseQuestion {
  return question.type === "true_false";
}

function main() {
  const questions = data.courses.flatMap((course) =>
    course.questions.map((question) => ({ courseId: course.id, question })),
  );
  const multipleChoice = questions.filter(({ question }) =>
    isMultipleChoice(question),
  );
  const trueFalse = questions.filter(({ question }) => isTrueFalse(question));

  const longestIsCorrect: McAudit[] = [];
  const longestByMargin: McAudit[] = [];

  for (const { courseId, question } of multipleChoice) {
    if (!isMultipleChoice(question)) continue;
    const lengths = question.choices.map((choice) => choice.length);
    const correctLength = lengths[question.answer] ?? 0;
    const longestLength = Math.max(...lengths);
    if (correctLength !== longestLength) continue;

    const secondLongest = [...lengths]
      .sort((a, b) => b - a)
      .find((length) => length < longestLength);
    const margin =
      secondLongest && secondLongest > 0
        ? (longestLength - secondLongest) / secondLongest
        : longestLength > 0
          ? 1
          : 0;

    const entry = { id: question.id, courseId, margin };
    longestIsCorrect.push(entry);
    if (margin > LONGEST_MARGIN) longestByMargin.push(entry);
  }

  const falseCount = trueFalse.filter(
    ({ question }) => isTrueFalse(question) && question.answer === false,
  ).length;

  console.log("Question audit");
  console.log("==============");
  console.log(`Multiple-choice total: ${multipleChoice.length}`);
  console.log(
    `Correct answer is the longest choice: ${longestIsCorrect.length} / ${multipleChoice.length}`,
  );
  console.log(
    `Longest choice wins by more than ${Math.round(LONGEST_MARGIN * 100)}%: ${longestByMargin.length}`,
  );
  console.log(`True/false total: ${trueFalse.length}`);
  console.log(`True/false marked false: ${falseCount} / ${trueFalse.length}`);
  console.log("");
  console.log("Flagged MC IDs (longest correct by >30%):");
  for (const entry of longestByMargin) {
    console.log(
      `- ${entry.id} (${entry.courseId}, margin ${Math.round(entry.margin * 100)}%)`,
    );
  }
}

main();
