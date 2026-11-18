export type QuestionType =
  | "multiple_choice"
  | "true_false"
  | "fill_blank"
  | "short_answer";

/** flexible = any order (lists); ordered = sequence/verse wording matters */
export type MatchMode = "flexible" | "ordered";

export type BaseQuestion = {
  id: string;
  type: QuestionType;
  prompt: string;
  explanation: string;
  tags?: string[];
};

export type MultipleChoiceQuestion = BaseQuestion & {
  type: "multiple_choice";
  choices: string[];
  answer: number;
};

export type TrueFalseQuestion = BaseQuestion & {
  type: "true_false";
  answer: boolean;
};

export type FillBlankQuestion = BaseQuestion & {
  type: "fill_blank";
  answers: string[];
  matchMode?: MatchMode;
};

export type ShortAnswerQuestion = BaseQuestion & {
  type: "short_answer";
  modelAnswer: string;
  keywords?: string[];
  matchMode?: MatchMode;
};

export type Question =
  | MultipleChoiceQuestion
  | TrueFalseQuestion
  | FillBlankQuestion
  | ShortAnswerQuestion;

export type Course = {
  id: string;
  title: string;
  shortTitle?: string;
  questions: Question[];
};

export type QuestionsData = {
  courses: Course[];
};
