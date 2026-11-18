"use client";

import { useRef, type KeyboardEvent } from "react";
import type { Course } from "@/lib/types";

type CourseTabsProps = {
  courses: Course[];
  activeCourseId: string;
  onSelect: (courseId: string) => void;
};

export function CourseTabs({
  courses,
  activeCourseId,
  onSelect,
}: CourseTabsProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function focusTab(index: number) {
    const next = tabRefs.current[index];
    next?.focus();
  }

  function onTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (courses.length === 0) return;

    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % courses.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + courses.length) % courses.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = courses.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    const course = courses[nextIndex];
    if (!course) return;
    onSelect(course.id);
    focusTab(nextIndex);
  }

  return (
    <nav
      className="course-tabs"
      aria-label="Course topics"
      role="tablist"
      style={{ gridTemplateColumns: `repeat(${Math.max(courses.length, 1)}, minmax(0, 1fr))` }}
    >
      {courses.map((course, index) => {
        const isActive = course.id === activeCourseId;
        const label = course.shortTitle ?? course.title;

        return (
          <button
            key={course.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            title={course.title}
            className={`course-tab ${isActive ? "is-active" : ""}`}
            onClick={() => onSelect(course.id)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            <span className="course-tab-label">{label}</span>
            <span className="course-tab-count">
              {course.questions.length} Qs
            </span>
          </button>
        );
      })}
    </nav>
  );
}
