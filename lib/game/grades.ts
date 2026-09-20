import { MAX_POINTS, ROUNDS_PER_GAME } from './config';

export interface Grade {
  /** What the run gets pressed on. */
  name: string;
  /** One line for the sleeve. */
  line: string;
}

/** Share of the most points a run could have scored, best first. */
const GRADES: [number, Grade][] = [
  [0.9, { name: 'Diamond', line: 'Do you work at a record store?' }],
  [0.75, { name: 'Platinum', line: 'The needle barely touched the groove.' }],
  [0.6, { name: 'Gold record', line: 'Framed and hung in the hallway.' }],
  [0.4, { name: 'Silver', line: 'Solid. Radio-friendly.' }],
  [0.2, { name: 'Bronze', line: 'A respectable B-side.' }],
  [0, { name: 'Demo tape', line: 'Everyone starts somewhere. Press play again.' }],
];

/** How a solo run went, as a record certification. */
export function gradeRun(score: number, rounds = ROUNDS_PER_GAME): Grade {
  const share = score / (rounds * MAX_POINTS);
  return GRADES.find(([floor]) => share >= floor)![1];
}
