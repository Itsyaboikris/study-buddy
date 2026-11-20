"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CourseTabs } from "@/components/CourseTabs";
import {
  MEMORY_VERSES_COURSE_ID,
  VERSE_WRITE_TAG,
  answersMatch,
  keywordsMatch,
  matchOrderedAnswer,
  missedKeywordLabels,
  missedPairLabels,
  pairsMatch,
  shuffleChoices,
  type ShuffledChoice,
  type VerseDiffOp,
} from "@/lib/questions";
import {
  buildWeightedDeck,
  clearCourseProgress,
  emptyRecord,
  loadCourseProgress,
  recordAnswer,
  restoreDeck,
  saveCourseProgress,
  type DeckWeightOptions,
  type QuestionRecord,
} from "@/lib/progress";
import type { Course, Question } from "@/lib/types";

type StudyBuddyProps = {
  courses: Course[];
};

type Feedback = {
  correct: boolean;
  message: ReactNode;
};

function VerseDiffView({ ops }: { ops: VerseDiffOp[] }) {
  return (
    <span className="verse-diff">
      {ops.map((op, index) => {
        const gap = index > 0 ? " " : "";
        if (op.kind === "match" && !op.slip) {
          return (
            <span key={index}>
              {gap}
              {op.expected}
            </span>
          );
        }
        if (op.kind === "match" && op.slip) {
          return (
            <span key={index} className="verse-diff-slip">
              {gap}
              <span className="verse-diff-from">{op.actual}</span>
              <span className="verse-diff-arrow" aria-hidden="true">
                →
              </span>
              <span className="verse-diff-to">{op.expected}</span>
            </span>
          );
        }
        if (op.kind === "missing") {
          return (
            <span key={index} className="verse-diff-miss">
              {gap}
              {op.expected}
            </span>
          );
        }
        if (op.kind === "extra") {
          return (
            <span key={index} className="verse-diff-extra">
              {gap}
              {op.actual}
            </span>
          );
        }
        return (
          <span key={index} className="verse-diff-sub">
            {gap}
            <span className="verse-diff-from">{op.actual}</span>
            <span className="verse-diff-arrow" aria-hidden="true">
              →
            </span>
            <span className="verse-diff-to">{op.expected}</span>
          </span>
        );
      })}
    </span>
  );
}

function listRecallFeedback(
  found: number,
  total: number,
  missed: string[],
  modelAnswer: string,
  explanation: string,
): ReactNode {
  if (missed.length === 0) {
    return (
      <>
        <p>Model answer: {modelAnswer}</p>
        <p className="verse-feedback-note">{explanation}</p>
      </>
    );
  }

  return (
    <div className="verse-feedback list-recall-feedback">
      <p className="verse-feedback-lead">
        You got {found} of {total}. Still missing:
      </p>
      <ul className="list-recall-missed">
        {missed.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="verse-feedback-label">Full list:</p>
      <p className="verse-feedback-correct">{modelAnswer}</p>
      <p className="verse-feedback-note">{explanation}</p>
    </div>
  );
}

function orderedVerseFeedback(
  correct: boolean,
  hadSlips: boolean,
  ops: VerseDiffOp[],
  acceptedAnswer: string,
  explanation: string,
): ReactNode {
  if (correct && !hadSlips) {
    return `Correct! ${explanation}`;
  }

  return (
    <div className="verse-feedback">
      <p className="verse-feedback-lead">
        {correct
          ? "Correct — check spellings:"
          : "Not quite — compare:"}
      </p>
      <div className="verse-feedback-diff">
        <VerseDiffView ops={ops} />
      </div>
      <p className="verse-feedback-label">Correct verse:</p>
      <p className="verse-feedback-correct">{acceptedAnswer}</p>
      <p className="verse-feedback-note">{explanation}</p>
    </div>
  );
}

export function StudyBuddy({ courses }: StudyBuddyProps) {
  const [activeCourseId, setActiveCourseId] = useState(courses[0]?.id ?? "");
  const [mounted, setMounted] = useState(false);
  const activeCourse = useMemo(
    () => courses.find((course) => course.id === activeCourseId) ?? courses[0],
    [courses, activeCourseId],
  );

  useEffect(() => {
    // Client-only gate so localStorage restore + shuffle never run during SSR/hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional mount gate
    setMounted(true);
  }, []);

  if (!activeCourse || activeCourse.questions.length === 0) {
    return (
      <div className="study-shell">
        <div className="empty-state">
          <p>No questions available yet.</p>
        </div>
        {courses.length > 0 ? (
          <CourseTabs
            courses={courses}
            activeCourseId={activeCourse?.id ?? activeCourseId}
            onSelect={setActiveCourseId}
          />
        ) : null}
      </div>
    );
  }

  if (!mounted) {
    return (
      <CourseShell
        course={activeCourse}
        courses={courses}
        activeCourseId={activeCourse.id}
        onSelectCourse={setActiveCourseId}
        stats={{ seen: 0, correct: 0 }}
        pass={1}
        progress={0}
      >
        <QuestionCardSkeleton />
      </CourseShell>
    );
  }

  return (
    <CourseSession
      key={activeCourse.id}
      course={activeCourse}
      courses={courses}
      onSelectCourse={setActiveCourseId}
    />
  );
}

type CourseSessionProps = {
  course: Course;
  courses: Course[];
  onSelectCourse: (courseId: string) => void;
};

function CourseSession({
  course,
  courses,
  onSelectCourse,
}: CourseSessionProps) {
  const deckWeightOptions = useMemo((): DeckWeightOptions | undefined => {
    if (course.id !== MEMORY_VERSES_COURSE_ID) return undefined;
    return { tagWeightMultipliers: { [VERSE_WRITE_TAG]: 2.5 } };
  }, [course.id]);

  const initial = useMemo(
    () =>
      restoreDeck(
        course.questions,
        loadCourseProgress(course.id),
        deckWeightOptions,
      ),
    // Mount-only: course identity is fixed via key={course.id} on the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [deck, setDeck] = useState(() => initial.deck);
  const [index, setIndex] = useState(() => initial.index);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [trueFalseValue, setTrueFalseValue] = useState<boolean | null>(null);
  const [textAnswer, setTextAnswer] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [stats, setStats] = useState(() => initial.stats);
  const [pass, setPass] = useState(() => initial.pass);
  const [records, setRecords] = useState<Record<string, QuestionRecord>>(
    () => initial.records,
  );
  const [passStats, setPassStats] = useState({ seen: 0, correct: 0 });
  const [passMissed, setPassMissed] = useState<Question[]>([]);
  const [showSummary, setShowSummary] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const actionRef = useRef<HTMLDivElement>(null);
  const blurTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current !== null) {
        window.clearTimeout(blurTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    saveCourseProgress(course.id, {
      version: 1,
      deckIds: deck.map((question) => question.id),
      index,
      pass,
      stats,
      records,
    });
  }, [course.id, deck, index, pass, stats, records]);

  function handleAnswerFocus() {
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setIsTyping(true);
    window.requestAnimationFrame(() => {
      actionRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }

  function handleAnswerBlur() {
    blurTimerRef.current = window.setTimeout(() => {
      setIsTyping(false);
      blurTimerRef.current = null;
    }, 180);
  }

  const question = deck[index];

  // Shuffle once per question id so choice position isn't learnable.
  const choiceOrder: ShuffledChoice[] = useMemo(() => {
    if (!question || question.type !== "multiple_choice") return [];
    return shuffleChoices(question.choices);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: shuffle only when question id changes
  }, [question?.id]);

  const progress =
    course.questions.length > 0
      ? Math.min((index + 1) / course.questions.length, 1)
      : 0;

  function resetInputs() {
    setSelectedChoice(null);
    setTrueFalseValue(null);
    setTextAnswer("");
    setFeedback(null);
    setPeek(null);
    setAnswered(false);
  }

  function recordResult(correct: boolean) {
    setStats((prev) => ({
      seen: prev.seen + 1,
      correct: prev.correct + (correct ? 1 : 0),
    }));
    setPassStats((prev) => ({
      seen: prev.seen + 1,
      correct: prev.correct + (correct ? 1 : 0),
    }));
    if (question) {
      setRecords((prev) => recordAnswer(prev, question.id, correct));
      if (!correct) {
        setPassMissed((prev) =>
          prev.some((item) => item.id === question.id)
            ? prev
            : [...prev, question],
        );
      }
    }
  }

  function finishAnswer(correct: boolean, message: ReactNode) {
    setPeek(null);
    setFeedback({ correct, message });
    setAnswered(true);
    recordResult(correct);
  }

  function beginPassTracking() {
    setPassStats({ seen: 0, correct: 0 });
    setPassMissed([]);
    setShowSummary(false);
  }

  function startNextPass() {
    setDeck(buildWeightedDeck(course.questions, records, deckWeightOptions));
    setIndex(0);
    setPass((prev) => prev + 1);
    beginPassTracking();
    resetInputs();
  }

  function drillMissedQuestions() {
    if (passMissed.length === 0) {
      startNextPass();
      return;
    }
    setDeck([...passMissed]);
    setIndex(0);
    beginPassTracking();
    resetInputs();
  }

  function resetProgress() {
    clearCourseProgress(course.id);
    const freshRecords = Object.fromEntries(
      course.questions.map((question) => [question.id, emptyRecord()]),
    );
    setRecords(freshRecords);
    setDeck(buildWeightedDeck(course.questions, freshRecords, deckWeightOptions));
    setIndex(0);
    setPass(1);
    setStats({ seen: 0, correct: 0 });
    beginPassTracking();
    resetInputs();
  }

  function checkMultipleChoice(choiceIndex: number) {
    if (!question || question.type !== "multiple_choice" || answered) return;

    const picked = choiceOrder[choiceIndex];
    if (!picked) return;

    const correct = picked.originalIndex === question.answer;
    finishAnswer(
      correct,
      correct
        ? `Correct! ${question.explanation}`
        : `Not quite. ${question.explanation}`,
    );
  }

  function checkTrueFalse(value: boolean) {
    if (!question || question.type !== "true_false" || answered) return;

    const correct = value === question.answer;
    finishAnswer(
      correct,
      correct
        ? `Correct! ${question.explanation}`
        : `Not quite. ${question.explanation}`,
    );
  }

  function checkTextAnswer() {
    if (!question || answered) return;

    if (question.type === "fill_blank") {
      const matchMode = question.matchMode ?? "flexible";
      if (matchMode === "ordered") {
        const result = matchOrderedAnswer(textAnswer, question.answers);
        finishAnswer(
          result.correct,
          orderedVerseFeedback(
            result.correct,
            result.hadSlips,
            result.ops,
            result.acceptedAnswer,
            question.explanation,
          ),
        );
        return;
      }

      const correct = answersMatch(textAnswer, question.answers, matchMode);
      finishAnswer(
        correct,
        correct
          ? `Correct! ${question.explanation}`
          : `Close — expected something like: ${question.answers[0]}. ${question.explanation}`,
      );
      return;
    }

    if (question.type === "short_answer") {
      const matchMode = question.matchMode ?? "flexible";

      // Full-list recall: every keyword required; do not fall back to paraphrase.
      if (question.requireAll && question.keywords && question.keywords.length > 0) {
        const correct = keywordsMatch(textAnswer, question.keywords, {
          requireAll: true,
        });
        finishAnswer(
          correct,
          shortAnswerFeedback(question, correct, textAnswer),
        );
        return;
      }

      // Definition/link questions: term must sit with the right meaning.
      if (question.pairs && question.pairs.length > 0) {
        const correct = pairsMatch(textAnswer, question.pairs);
        finishAnswer(
          correct,
          shortAnswerFeedback(question, correct, textAnswer),
        );
        return;
      }

      if (matchMode === "ordered") {
        const result = matchOrderedAnswer(textAnswer, [question.modelAnswer]);
        finishAnswer(
          result.correct,
          orderedVerseFeedback(
            result.correct,
            result.hadSlips,
            result.ops,
            result.acceptedAnswer,
            question.explanation,
          ),
        );
        return;
      }

      const keywordOk = question.keywords
        ? keywordsMatch(textAnswer, question.keywords)
        : false;
      const correct =
        keywordOk ||
        answersMatch(textAnswer, [question.modelAnswer], matchMode, {
          paraphrase: true,
        });
      finishAnswer(
        correct,
        shortAnswerFeedback(question, correct, textAnswer),
      );
    }
  }

  function shortAnswerFeedback(
    q: Extract<Question, { type: "short_answer" }>,
    correct: boolean,
    userAnswer?: string,
  ): ReactNode {
    if (correct) return `Nice work! ${q.explanation}`;

    if (userAnswer !== undefined && userAnswer.trim().length > 0) {
      if (q.requireAll && q.keywords && q.keywords.length > 0) {
        const missed = missedKeywordLabels(
          userAnswer,
          q.keywords,
          q.modelAnswer,
        );
        if (missed.length > 0) {
          const total = q.keywords.length;
          return listRecallFeedback(
            total - missed.length,
            total,
            missed,
            q.modelAnswer,
            q.explanation,
          );
        }
      }

      if (q.pairs && q.pairs.length > 0) {
        const missed = missedPairLabels(
          userAnswer,
          q.pairs,
          q.modelAnswer,
        );
        if (missed.length > 0) {
          const total = q.pairs.length;
          return listRecallFeedback(
            total - missed.length,
            total,
            missed,
            q.modelAnswer,
            q.explanation,
          );
        }
      }
    }

    return (
      <>
        <p>Model answer: {q.modelAnswer}</p>
        <p className="verse-feedback-note">{q.explanation}</p>
      </>
    );
  }

  function markSelfCheck(correct: boolean) {
    if (!question || answered || question.type !== "short_answer") return;
    finishAnswer(correct, shortAnswerFeedback(question, correct));
  }

  function revealAnswerMessage(q: Question): string {
    if (q.type === "multiple_choice") {
      return `Answer: ${q.choices[q.answer]}. ${q.explanation}`;
    }
    if (q.type === "true_false") {
      return `Answer: ${q.answer ? "True" : "False"}. ${q.explanation}`;
    }
    if (q.type === "fill_blank") {
      return `Answer: ${q.answers[0]}. ${q.explanation}`;
    }
    return `Model answer: ${q.modelAnswer}. ${q.explanation}`;
  }

  function dontKnow() {
    if (!question || answered) return;
    finishAnswer(false, revealAnswerMessage(question));
  }

  function skipQuestion() {
    if (!question || answered || deck.length === 0) return;

    if (deck.length <= 1) {
      startNextPass();
      return;
    }

    const working = [...deck];
    const [skipped] = working.splice(index, 1);
    const insertAt = Math.min(index + 8, working.length);
    working.splice(insertAt, 0, skipped);

    if (index >= working.length) {
      setDeck(working);
      setIndex(Math.max(working.length - 1, 0));
      setShowSummary(true);
      resetInputs();
      return;
    }

    setDeck(working);
    setIndex(index);
    resetInputs();
  }

  function goNext() {
    if (deck.length === 0 || !question) return;

    const working = [...deck];
    let nextIndex = index + 1;

    if (feedback && !feedback.correct) {
      const [missed] = working.splice(index, 1);
      // Space misses out so they return later this pass, not immediately.
      const gap = Math.max(8, Math.min(14, Math.floor(working.length / 3)));
      const insertAt = Math.min(index + gap, working.length);
      working.splice(insertAt, 0, missed);
      nextIndex = index;
    }

    if (nextIndex >= working.length) {
      setDeck(working);
      setIndex(Math.max(working.length - 1, 0));
      setShowSummary(true);
      resetInputs();
      return;
    }

    setDeck(working);
    setIndex(nextIndex);
    resetInputs();
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (showSummary) return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }

      if (answered && event.key === "Enter") {
        event.preventDefault();
        goNext();
        return;
      }

      if (answered || !question) return;

      if (question.type === "multiple_choice") {
        const key = event.key.toLowerCase();
        const fromDigit = Number(event.key) - 1;
        const fromLetter = key.charCodeAt(0) - 97;
        const choiceIndex =
          fromDigit >= 0 && fromDigit <= 3
            ? fromDigit
            : fromLetter >= 0 && fromLetter <= 3
              ? fromLetter
              : -1;
        if (choiceIndex < 0 || choiceIndex >= choiceOrder.length) return;
        event.preventDefault();
        setSelectedChoice(choiceIndex);
        checkMultipleChoice(choiceIndex);
        return;
      }

      if (question.type === "true_false") {
        const key = event.key.toLowerCase();
        if (key === "t") {
          event.preventDefault();
          setTrueFalseValue(true);
          checkTrueFalse(true);
        } else if (key === "f") {
          event.preventDefault();
          setTrueFalseValue(false);
          checkTrueFalse(false);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // Handlers are recreated each render; deps below capture the state they close over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    answered,
    choiceOrder,
    feedback,
    question,
    showSummary,
    deck,
    index,
    passMissed,
    records,
    passStats,
  ]);

  const accuracy =
    stats.seen === 0 ? 0 : Math.round((stats.correct / stats.seen) * 100);
  const passAccuracy =
    passStats.seen === 0
      ? 0
      : Math.round((passStats.correct / passStats.seen) * 100);
  const needsTextCheck = question
    ? question.type === "fill_blank" || question.type === "short_answer"
    : false;
  const canCheck =
    !answered && needsTextCheck && textAnswer.trim().length > 0;
  const isLoadingDeck = deck.length === 0;

  return (
    <CourseShell
      course={course}
      courses={courses}
      activeCourseId={course.id}
      onSelectCourse={onSelectCourse}
      stats={stats}
      pass={pass}
      progress={showSummary ? 1 : progress}
      accuracy={accuracy}
      isTyping={isTyping}
      onResetProgress={resetProgress}
    >
      {showSummary ? (
        <PassSummary
          pass={pass}
          seen={passStats.seen}
          correct={passStats.correct}
          accuracy={passAccuracy}
          missed={passMissed}
          onDrillMissed={drillMissedQuestions}
          onStartNextPass={startNextPass}
        />
      ) : isLoadingDeck || !question ? (
        <QuestionCardSkeleton />
      ) : (
        <main className="question-panel">
          <p className="question-meta">
            {question.type.replaceAll("_", " ")} · {index + 1} of {deck.length}
          </p>
          <h2 className="question-prompt">{question.prompt}</h2>

          {question.type === "multiple_choice" && (
            <div className="choice-list" role="group" aria-label="Choices">
              {choiceOrder.map((choice, choiceIndex) => {
                const isSelected = selectedChoice === choiceIndex;
                const showResult = answered && isSelected;
                const isCorrectChoice =
                  choice.originalIndex === question.answer;

                return (
                  <button
                    key={`${question.id}-${choice.originalIndex}-${choiceIndex}`}
                    type="button"
                    className={[
                      "choice-btn",
                      isSelected ? "is-selected" : "",
                      answered && isCorrectChoice ? "is-correct" : "",
                      showResult && !isCorrectChoice ? "is-wrong" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    disabled={answered}
                    onClick={() => {
                      setSelectedChoice(choiceIndex);
                      checkMultipleChoice(choiceIndex);
                    }}
                  >
                    <span className="choice-letter">
                      {String.fromCharCode(65 + choiceIndex)}
                    </span>
                    <span>{choice.text}</span>
                    {answered && isCorrectChoice ? (
                      <span className="result-icon choice-result" aria-hidden="true">
                        ✓
                      </span>
                    ) : null}
                    {showResult && !isCorrectChoice ? (
                      <span className="result-icon choice-result" aria-hidden="true">
                        ✗
                      </span>
                    ) : null}
                    {answered && isCorrectChoice ? (
                      <span className="sr-only">Correct answer</span>
                    ) : null}
                    {showResult && !isCorrectChoice ? (
                      <span className="sr-only">Incorrect answer</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}

          {question.type === "true_false" && (
            <div className="tf-row" role="group" aria-label="True or false">
              {[true, false].map((value) => {
                const label = value ? "True" : "False";
                const isSelected = trueFalseValue === value;
                const isCorrectValue = answered && value === question.answer;
                const isWrongPick =
                  answered && isSelected && value !== question.answer;

                return (
                  <button
                    key={label}
                    type="button"
                    className={[
                      "tf-btn",
                      isSelected ? "is-selected" : "",
                      isCorrectValue ? "is-correct" : "",
                      isWrongPick ? "is-wrong" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    disabled={answered}
                    onClick={() => {
                      setTrueFalseValue(value);
                      checkTrueFalse(value);
                    }}
                  >
                    {label}
                    {isCorrectValue ? (
                      <span className="result-icon choice-result" aria-hidden="true">
                        ✓
                      </span>
                    ) : null}
                    {isWrongPick ? (
                      <span className="result-icon choice-result" aria-hidden="true">
                        ✗
                      </span>
                    ) : null}
                    {isCorrectValue ? (
                      <span className="sr-only">Correct answer</span>
                    ) : null}
                    {isWrongPick ? (
                      <span className="sr-only">Incorrect answer</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}

          {needsTextCheck && (
            <div className="text-answer">
              <label className="sr-only" htmlFor="answer-input">
                Your answer
              </label>
              {question.type === "fill_blank" &&
              (question.matchMode ?? "flexible") !== "ordered" ? (
                <input
                  key={question.id}
                  id="answer-input"
                  className="answer-input"
                  type="text"
                  enterKeyHint="done"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={textAnswer}
                  onChange={(event) => setTextAnswer(event.target.value)}
                  onFocus={handleAnswerFocus}
                  onBlur={handleAnswerBlur}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      checkTextAnswer();
                    }
                  }}
                  placeholder="Type your answer…"
                  disabled={answered}
                />
              ) : (
                <textarea
                  key={question.id}
                  id="answer-input"
                  className={
                    question.type === "fill_blank"
                      ? "answer-textarea answer-textarea-verse"
                      : "answer-textarea"
                  }
                  value={textAnswer}
                  onChange={(event) => {
                    setTextAnswer(event.target.value);
                    if (question.type === "fill_blank") {
                      const el = event.currentTarget;
                      el.style.height = "auto";
                      el.style.height = `${el.scrollHeight}px`;
                    }
                  }}
                  onFocus={handleAnswerFocus}
                  onBlur={handleAnswerBlur}
                  onKeyDown={(event) => {
                    if (
                      question.type === "fill_blank" &&
                      (question.matchMode ?? "flexible") === "ordered" &&
                      event.key === "Enter" &&
                      !event.shiftKey
                    ) {
                      event.preventDefault();
                      checkTextAnswer();
                    }
                  }}
                  placeholder={
                    question.type === "fill_blank"
                      ? "Type the verse…"
                      : "Type what you remember…"
                  }
                  rows={question.type === "fill_blank" ? 5 : 3}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  disabled={answered}
                />
              )}
              {question.type === "short_answer" && !answered && (
                <div className="self-check">
                  <p>Prefer a self-check?</p>
                  <div className="self-check-actions">
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => setPeek(question.modelAnswer)}
                    >
                      Peek answer
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => markSelfCheck(true)}
                    >
                      I got it
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => markSelfCheck(false)}
                    >
                      Missed it
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {peek && !answered && (
            <div className="feedback is-peek" role="status">
              <strong>Model answer</strong>
              <p>{peek}</p>
            </div>
          )}

          {feedback && (
            <div
              className={`feedback ${feedback.correct ? "is-correct" : "is-wrong"}`}
              role="status"
            >
              <strong>
                <span className="result-icon" aria-hidden="true">
                  {feedback.correct ? "✓" : "✗"}
                </span>
                <span className="sr-only">
                  {feedback.correct ? "Correct:" : "Incorrect:"}
                </span>
                {feedback.correct ? "Correct" : "Keep going"}
              </strong>
              <div className="feedback-body">{feedback.message}</div>
            </div>
          )}

          {!answered &&
          (question.type === "multiple_choice" ||
            question.type === "true_false") ? (
            <p className="tap-hint">Tap an answer to check</p>
          ) : null}

          {!answered ? (
            <div className="defer-actions">
              <button
                type="button"
                className="defer-btn"
                onClick={dontKnow}
              >
                I don&apos;t know
              </button>
              <button
                type="button"
                className="defer-btn"
                onClick={skipQuestion}
              >
                Skip
              </button>
            </div>
          ) : null}
        </main>
      )}

      {!isLoadingDeck && ((!answered && needsTextCheck) || answered) ? (
        <div className="action-dock" ref={actionRef}>
          {!answered && needsTextCheck ? (
            <button
              type="button"
              className="primary-btn"
              disabled={!canCheck}
              onMouseDown={(event) => event.preventDefault()}
              onClick={checkTextAnswer}
            >
              Check answer
            </button>
          ) : null}
          {answered ? (
            <button type="button" className="primary-btn" onClick={goNext}>
              Next question
            </button>
          ) : null}
        </div>
      ) : null}
    </CourseShell>
  );
}

type CourseShellProps = {
  course: Course;
  courses: Course[];
  activeCourseId: string;
  onSelectCourse: (courseId: string) => void;
  stats: { seen: number; correct: number };
  pass: number;
  progress: number;
  accuracy?: number;
  isTyping?: boolean;
  onResetProgress?: () => void;
  children: ReactNode;
};

function CourseShell({
  course,
  courses,
  activeCourseId,
  onSelectCourse,
  stats,
  pass,
  progress,
  accuracy,
  isTyping = false,
  onResetProgress,
  children,
}: CourseShellProps) {
  const shownAccuracy =
    accuracy ??
    (stats.seen === 0 ? 0 : Math.round((stats.correct / stats.seen) * 100));

  return (
    <div className={`study-shell ${isTyping ? "is-typing" : ""}`}>
      <header className="study-header">
        <div>
          <p className="brand">Study Buddy</p>
          <h1 className="course-title">{course.title}</h1>
          {onResetProgress ? (
            <button
              type="button"
              className="reset-progress"
              onClick={onResetProgress}
            >
              Reset progress
            </button>
          ) : null}
        </div>
        <div className="stats" aria-live="polite">
          <div>
            <span className="stat-value">{stats.correct}</span>
            <span className="stat-label">right</span>
          </div>
          <div>
            <span className="stat-value">{shownAccuracy}%</span>
            <span className="stat-label">accuracy</span>
          </div>
          <div>
            <span className="stat-value">{pass}</span>
            <span className="stat-label">pass</span>
          </div>
        </div>
      </header>

      <div className="progress-track" aria-hidden="true">
        <div
          className="progress-fill"
          style={{ width: `${Math.max(progress * 100, 6)}%` }}
        />
      </div>

      {children}

      <CourseTabs
        courses={courses}
        activeCourseId={activeCourseId}
        onSelect={onSelectCourse}
      />
    </div>
  );
}

function QuestionCardSkeleton() {
  return (
    <main className="question-panel is-skeleton" aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading questions…</p>
      <div className="skeleton-line skeleton-meta" />
      <div className="skeleton-line skeleton-prompt" />
      <div className="skeleton-line skeleton-prompt short" />
      <div className="skeleton-choice" />
      <div className="skeleton-choice" />
      <div className="skeleton-choice" />
    </main>
  );
}

type PassSummaryProps = {
  pass: number;
  seen: number;
  correct: number;
  accuracy: number;
  missed: Question[];
  onDrillMissed: () => void;
  onStartNextPass: () => void;
};

function PassSummary({
  pass,
  seen,
  correct,
  accuracy,
  missed,
  onDrillMissed,
  onStartNextPass,
}: PassSummaryProps) {
  return (
    <main className="question-panel pass-summary">
      <p className="question-meta">Pass {pass} complete</p>
      <h2 className="question-prompt">Nice work — here&apos;s this pass</h2>
      <div className="summary-score" aria-label="Pass score">
        <div>
          <span className="stat-value">
            {correct}/{seen}
          </span>
          <span className="stat-label">score</span>
        </div>
        <div>
          <span className="stat-value">{accuracy}%</span>
          <span className="stat-label">accuracy</span>
        </div>
        <div>
          <span className="stat-value">{missed.length}</span>
          <span className="stat-label">missed</span>
        </div>
      </div>

      {missed.length > 0 ? (
        <div className="summary-missed">
          <h3>Missed this pass</h3>
          <ul>
            {missed.map((question) => (
              <li key={question.id}>{question.prompt}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="summary-perfect">No misses this pass.</p>
      )}

      <div className="summary-actions">
        {missed.length > 0 ? (
          <button type="button" className="primary-btn" onClick={onDrillMissed}>
            Drill missed questions
          </button>
        ) : null}
        <button
          type="button"
          className={missed.length > 0 ? "ghost-btn summary-next" : "primary-btn"}
          onClick={onStartNextPass}
        >
          Start next pass
        </button>
      </div>
    </main>
  );
}
