export type QuestionType =
  | "multiple_choice"
  | "true_false"
  | "fill_blank"
  | "short_answer";

/** flexible = any order (lists); ordered = strict word-by-word verse/sequence */
export type MatchMode = "flexible" | "ordered";

export type BaseQuestion = {
  id: string;
  type: QuestionType;
  prompt: string;
  explanation: string;
  tags?: string[];
  /**
   * When true, the question appears in the Memory Verses course but is
   * excluded from its home course deck.
   */
  verseOnly?: boolean;
  /** Shared id for fill/MC twins that should stay spaced apart in a deck. */
  pairId?: string;
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

/** Term must be linked to its meaning (not just both present anywhere). */
export type AnswerPair = {
  term: string;
  meaning: string;
};

export type ShortAnswerQuestion = BaseQuestion & {
  type: "short_answer";
  modelAnswer: string;
  keywords?: string[];
  /**
   * When true with keywords, every keyword must match (full-list recall).
   * Default keywordsMatch only requires ~60%.
   */
  requireAll?: boolean;
  /** When set, each term must appear near its correct meaning. */
  pairs?: AnswerPair[];
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
