import { expect, test } from "vitest";

import { revealProgressiveItems } from "./progressiveVisibility";

const course = [
  { key: "swim_start", completed: true },
  { key: "swim_finish", completed: true },
  { key: "bike_start", completed: false },
  { key: "bike_finish", completed: false },
  { key: "run_start", completed: false },
  { key: "run_finish", completed: false },
];

test("reveals completed checkpoints and only the next pending checkpoint", () => {
  expect(
    revealProgressiveItems(course, (item) => item.completed).map((item) => item.key),
  ).toEqual(["swim_start", "swim_finish", "bike_start"]);
});

test("does not expose an out-of-order later crossing", () => {
  const delayed = course.map((item) =>
    item.key === "bike_finish" ? { ...item, completed: true } : item,
  );
  expect(
    revealProgressiveItems(delayed, (item) => item.completed).map((item) => item.key),
  ).toEqual(["swim_start", "swim_finish", "bike_start"]);
});

test("reveals the full sequence only after canonical finish", () => {
  expect(revealProgressiveItems(course, (item) => item.completed, true)).toHaveLength(6);
});
