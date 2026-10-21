/**
 * Self-verification questions. They are not a quiz with right answers — they
 * ask the person to recall concrete details, which is hard to do honestly
 * without having done the task.
 */

interface Topic {
  match: RegExp;
  questions: string[];
}

const TOPICS: Topic[] = [
  {
    match: /\b(read|reading|book|pages?|chapter|novel|article)\b/i,
    questions: [
      'What did you read? Name the book, chapter or article.',
      'What was the main idea of what you read?',
      'Write one thing you learned or want to remember.',
    ],
  },
  {
    match: /\b(revise|revision|study|studying|notes|exam|kcse|homework|assignment|essay|maths?|statistics|science|lecture|coursework|practice)\b/i,
    questions: [
      'Which topic or questions did you work on?',
      'What was the hardest part, and how did you get through it?',
      'Explain one thing from this task in your own words.',
    ],
  },
  {
    match: /\b(gym|run|running|walk|workout|exercise|training|football|swim|yoga|jog|push-?ups?)\b/i,
    questions: [
      'What exercises did you do?',
      'How long did you train for, and where?',
      'How did your body feel afterwards?',
    ],
  },
  {
    match: /\b(clean|tidy|wash|dishes|laundry|bed|sweep|mop|chores?|room|kitchen|cook|cooking)\b/i,
    questions: [
      'What exactly did you clean or sort out?',
      'What was the messiest part before you started?',
      'How long did it take you?',
    ],
  },
  {
    match: /\b(invoice|email|client|meeting|report|design|code|coding|work|project|presentation|call)\b/i,
    questions: [
      'What did you finish? Be specific.',
      'Who is it for, and what is the next step?',
      'What took the most time?',
    ],
  },
];

const GENERIC = [
  'What exactly did you do for this task?',
  'How long did it take, and where were you?',
  'What was the hardest part?',
];

export function questionsFor(title: string): string[] {
  const topic = TOPICS.find((t) => t.match.test(title));
  return topic ? topic.questions : GENERIC;
}

/** A short, honest answer is fine, but a single word isn't recall. */
export const MIN_ANSWER_LENGTH = 12;
