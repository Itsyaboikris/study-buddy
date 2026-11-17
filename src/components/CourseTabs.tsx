"use client";

import type { Course } from "@/lib/types";

type CourseTabsProps = {
  courses: Course[];
  activeCourseId: string;
  onSelect: (courseId: string) => void;
};

const shortLabels: Record<string, string> = {
  acts: "Acts",
  "path-to-righteousness": "Path",
  "family-life": "Family",
  "memory-verses": "Verses",
};

export function CourseTabs({
  courses,
  activeCourseId,
  onSelect,
}: CourseTabsProps) {
  return (
    <nav
      className="course-tabs"
      aria-label="Course topics"
      role="tablist"
    >
      {courses.map((course) => {
        const isActive = course.id === activeCourseId;
        const label = shortLabels[course.id] ?? course.title;

        return (
          <button
            key={course.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={course.title}
            title={course.title}
            className={`course-tab ${isActive ? "is-active" : ""}`}
            onClick={() => onSelect(course.id)}
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
