import { StudyBuddy } from "@/components/StudyBuddy";
import { getCourses } from "@/lib/questions";

export default function Home() {
  const courses = getCourses();

  return <StudyBuddy courses={courses} />;
}
