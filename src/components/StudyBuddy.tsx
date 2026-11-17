"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CourseTabs } from "@/components/CourseTabs";
import {
  answersMatch,
  keywordsMatch,
  shuffle,
  shuffleChoices,
  type ShuffledChoice,
} from "@/lib/questions";
import type { Course, Question } from "@/lib/types";

type StudyBuddyProps = {
  courses: Course[];
};

type Feedback = {
  correct: boolean;
  message: string;
};

function buildDeck(questions: Question[]): Question[] {
  return shuffle(questions);
}

export function StudyBuddy({ courses }: StudyBuddyProps) {
  const [activeCourseId, setActiveCourseId] = useState(courses[0]?.id ?? "");
  const activeCourse = useMemo(
    () => courses.find((course) => course.id === activeCourseId) ?? courses[0],
    [courses, activeCourseId],
  );

  const [deck, setDeck] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [trueFalseValue, setTrueFalseValue] = useState<boolean | null>(null);
  const [textAnswer, setTextAnswer] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [stats, setStats] = useState({ seen: 0, correct: 0 });
  const [pass, setPass] = useState(1);
  const [isTyping, setIsTyping] = useState(false);
  const actionRef = useRef<HTMLDivElement>(null);
  const blurTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!activeCourse) return;
    setDeck(buildDeck(activeCourse.questions));
    setIndex(0);
    setSelectedChoice(null);
    setTrueFalseValue(null);
    setTextAnswer("");
    setFeedback(null);
    setPeek(null);
    setAnswered(false);
    setStats({ seen: 0, correct: 0 });
    setPass(1);
    setIsTyping(false);
  }, [activeCourse]);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current !== null) {
        window.clearTimeout(blurTimerRef.current);
      }
    };
  }, []);

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
    activeCourse && activeCourse.questions.length > 0
      ? Math.min((index + 1) / activeCourse.questions.length, 1)
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
  }

  function finishAnswer(correct: boolean, message: string) {
    setPeek(null);
    setFeedback({ correct, message });
    setAnswered(true);
    recordResult(correct);
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
    // Show one model answer only — explanation often restates the same idea.
    return `Model answer: ${q.modelAnswer}`;
  }

  function markSelfCheck(correct: boolean) {
    if (!question || answered || question.type !== "short_answer") return;
    finishAnswer(correct, shortAnswerFeedback(question, correct));
  }

  function goNext() {
    if (!activeCourse || deck.length === 0 || !question) return;

    let working = [...deck];
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
      setDeck(buildDeck(activeCourse.questions));
      setIndex(0);
      setPass((prev) => prev + 1);
    } else {
      setDeck(working);
      setIndex(nextIndex);
    }

    resetInputs();
  }

  if (!activeCourse || !question) {
    return (
      <div className="empty-state">
        <p>No questions available yet.</p>
      </div>
    );
  }

  const accuracy =
    stats.seen === 0 ? 0 : Math.round((stats.correct / stats.seen) * 100);
  const needsTextCheck =
    question.type === "fill_blank" || question.type === "short_answer";
  const canCheck =
    !answered && needsTextCheck && textAnswer.trim().length > 0;

  return (
    <div className={`study-shell ${isTyping ? "is-typing" : ""}`}>
      <header className="study-header">
        <div>
          <p className="brand">Study Buddy</p>
          <h1 className="course-title">{activeCourse.title}</h1>
        </div>
        <div className="stats" aria-live="polite">
          <div>
            <span className="stat-value">{stats.correct}</span>
            <span className="stat-label">right</span>
          </div>
          <div>
            <span className="stat-value">{accuracy}%</span>
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
            <strong>{feedback.correct ? "Correct" : "Keep going"}</strong>
            <p>{feedback.message}</p>
          </div>
        )}

        {!answered &&
        (question.type === "multiple_choice" ||
          question.type === "true_false") ? (
          <p className="tap-hint">Tap an answer to check</p>
        ) : null}
      </main>

      {(!answered && needsTextCheck) || answered ? (
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

      <CourseTabs
        courses={courses}
        activeCourseId={activeCourse.id}
        onSelect={setActiveCourseId}
      />
    </div>
  );
}
