"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { CourseTabs } from "@/components/CourseTabs";
import {
  answersMatch,
  keywordsMatch,
  shuffleChoices,
  type ShuffledChoice,
} from "@/lib/questions";
import {
  buildWeightedDeck,
  clearCourseProgress,
  emptyRecord,
  loadCourseProgress,
  recordAnswer,
  restoreDeck,
  saveCourseProgress,
  type QuestionRecord,
} from "@/lib/progress";
import type { Course, Question } from "@/lib/types";

type StudyBuddyProps = {
  courses: Course[];
};

type Feedback = {
  correct: boolean;
  message: string;
};

function useIsClient() {
  return useSyncExternalStore(
    (onStoreChange) => {
      // Ensure a client re-render after hydration when server/client snapshots differ.
      queueMicrotask(onStoreChange);
      return () => {};
    },
    () => true,
    () => false,
  );
}

export function StudyBuddy({ courses }: StudyBuddyProps) {
  const [activeCourseId, setActiveCourseId] = useState(courses[0]?.id ?? "");
  const activeCourse = useMemo(
    () => courses.find((course) => course.id === activeCourseId) ?? courses[0],
    [courses, activeCourseId],
  );
  const isClient = useIsClient();

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

  if (!isClient) {
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
  const initial = useMemo(
    () => restoreDeck(course.questions, loadCourseProgress(course.id)),
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

  function finishAnswer(correct: boolean, message: string) {
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
    setDeck(buildWeightedDeck(course.questions, records));
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
    setDeck(buildWeightedDeck(course.questions, freshRecords));
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
      const correct = answersMatch(
        textAnswer,
        question.answers,
        question.matchMode ?? "flexible",
      );
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
      const keywordOk =
        matchMode === "ordered"
          ? false
          : question.keywords
            ? keywordsMatch(textAnswer, question.keywords)
            : false;
      const correct =
        keywordOk ||
        answersMatch(textAnswer, [question.modelAnswer], matchMode, {
          paraphrase: matchMode === "flexible",
        });
      finishAnswer(correct, shortAnswerFeedback(question, correct));
    }
  }

  function shortAnswerFeedback(
    q: Extract<Question, { type: "short_answer" }>,
    correct: boolean,
  ): string {
    if (correct) return `Nice work! ${q.explanation}`;
    return `Model answer: ${q.modelAnswer}. ${q.explanation}`;
  }

  function markSelfCheck(correct: boolean) {
    if (!question || answered || question.type !== "short_answer") return;
    finishAnswer(correct, shortAnswerFeedback(question, correct));
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
              {question.type === "fill_blank" ? (
                <input
                  id="answer-input"
                  className="answer-input"
                  type="text"
                  enterKeyHint="done"
                  autoComplete="off"
                  autoCorrect="off"
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
                  id="answer-input"
                  className="answer-textarea"
                  value={textAnswer}
                  onChange={(event) => setTextAnswer(event.target.value)}
                  onFocus={handleAnswerFocus}
                  onBlur={handleAnswerBlur}
                  placeholder="Type what you remember…"
                  rows={3}
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
              <p>{feedback.message}</p>
            </div>
          )}

          {!answered &&
          (question.type === "multiple_choice" ||
            question.type === "true_false") ? (
            <p className="tap-hint">Tap an answer to check</p>
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
