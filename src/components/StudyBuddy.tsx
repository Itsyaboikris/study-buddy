"use client";

import { useEffect, useMemo, useState } from "react";
import { CourseTabs } from "@/components/CourseTabs";
import {
  answersMatch,
  keywordsMatch,
  shuffle,
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
  const [cycle, setCycle] = useState(1);

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
    setCycle(1);
  }, [activeCourse]);

  const question = deck[index];
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

  function checkAnswer() {
    if (!question || answered) return;

    let correct = false;
    let message = question.explanation;

    if (question.type === "multiple_choice") {
      if (selectedChoice === null) return;
      correct = selectedChoice === question.answer;
      message = correct
        ? `Correct! ${question.explanation}`
        : `Not quite. ${question.explanation}`;
    }

    if (question.type === "true_false") {
      if (trueFalseValue === null) return;
      correct = trueFalseValue === question.answer;
      message = correct
        ? `Correct! ${question.explanation}`
        : `Not quite. ${question.explanation}`;
    }

    if (question.type === "fill_blank") {
      correct = answersMatch(textAnswer, question.answers);
      message = correct
        ? `Correct! ${question.explanation}`
        : `Close — expected something like: ${question.answers[0]}. ${question.explanation}`;
    }

    if (question.type === "short_answer") {
      const keywordOk = question.keywords
        ? keywordsMatch(textAnswer, question.keywords)
        : false;
      correct = keywordOk || answersMatch(textAnswer, [question.modelAnswer]);
      message = correct
        ? `Nice work! ${question.explanation}`
        : `Model answer: ${question.modelAnswer} ${question.explanation}`;
    }

    setPeek(null);
    setFeedback({ correct, message });
    setAnswered(true);
    recordResult(correct);
  }

  function markSelfCheck(correct: boolean) {
    if (!question || answered || question.type !== "short_answer") return;
    setPeek(null);
    setFeedback({
      correct,
      message: correct
        ? `Nice work! ${question.explanation}`
        : `Model answer: ${question.modelAnswer} ${question.explanation}`,
    });
    setAnswered(true);
    recordResult(correct);
  }

  function goNext() {
    if (!activeCourse || deck.length === 0 || !question) return;

    let working = [...deck];
    let nextIndex = index + 1;

    if (feedback && !feedback.correct) {
      const [missed] = working.splice(index, 1);
      const insertAt = Math.min(index + 2, working.length);
      working.splice(insertAt, 0, missed);
      nextIndex = index;
    }

    if (nextIndex >= working.length) {
      setDeck(buildDeck(activeCourse.questions));
      setIndex(0);
      setCycle((prev) => prev + 1);
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
  const canCheck =
    !answered &&
    ((question.type === "multiple_choice" && selectedChoice !== null) ||
      (question.type === "true_false" && trueFalseValue !== null) ||
      ((question.type === "fill_blank" || question.type === "short_answer") &&
        textAnswer.trim().length > 0));

  return (
    <div className="study-shell">
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
            <span className="stat-value">{cycle}</span>
            <span className="stat-label">loop</span>
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
            {question.choices.map((choice, choiceIndex) => {
              const isSelected = selectedChoice === choiceIndex;
              const showResult = answered && isSelected;
              const isCorrectChoice = choiceIndex === question.answer;

              return (
                <button
                  key={`${question.id}-${choiceIndex}`}
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
                  onClick={() => setSelectedChoice(choiceIndex)}
                >
                  <span className="choice-letter">
                    {String.fromCharCode(65 + choiceIndex)}
                  </span>
                  <span>{choice}</span>
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
                  onClick={() => setTrueFalseValue(value)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {(question.type === "fill_blank" ||
          question.type === "short_answer") && (
          <div className="text-answer">
            <label className="sr-only" htmlFor="answer-input">
              Your answer
            </label>
            <textarea
              id="answer-input"
              value={textAnswer}
              onChange={(event) => setTextAnswer(event.target.value)}
              placeholder={
                question.type === "fill_blank"
                  ? "Type your answer…"
                  : "Type what you remember…"
              }
              rows={question.type === "short_answer" ? 4 : 3}
              disabled={answered}
            />
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

        <div className="action-row">
          {!answered ? (
            <button
              type="button"
              className="primary-btn"
              disabled={!canCheck}
              onClick={checkAnswer}
            >
              Check answer
            </button>
          ) : (
            <button type="button" className="primary-btn" onClick={goNext}>
              Next question
            </button>
          )}
        </div>
      </main>

      <CourseTabs
        courses={courses}
        activeCourseId={activeCourse.id}
        onSelect={setActiveCourseId}
      />
    </div>
  );
}
