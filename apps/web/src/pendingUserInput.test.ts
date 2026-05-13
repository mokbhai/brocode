import { describe, expect, it } from "vitest";

import {
  buildPendingUserInputAnswers,
  countAnsweredPendingUserInputQuestions,
  derivePendingUserInputProgress,
  findFirstUnansweredPendingUserInputQuestionIndex,
  resolvePendingUserInputAnswer,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
} from "./pendingUserInput";

describe("resolvePendingUserInputAnswer", () => {
  it("uses the first single-select option when no draft answer exists", () => {
    expect(
      resolvePendingUserInputAnswer(
        {
          id: "scope",
          header: "Scope",
          question: "What should the plan target first?",
          options: [
            {
              label: "Renderer first (Recommended)",
              description: "Fix the visible submit path first",
            },
            {
              label: "Server first",
              description: "Harden provider handling first",
            },
          ],
        },
        undefined,
      ),
    ).toBe("Renderer first (Recommended)");
  });

  it("prefers a custom answer over a selected option", () => {
    expect(
      resolvePendingUserInputAnswer(
        {
          id: "compat",
          header: "Compat",
          question: "How strict should compatibility be?",
          options: [],
        },
        {
          selectedOptionLabels: ["Keep current envelope"],
          customAnswer: "Keep the existing envelope for one release",
        },
      ),
    ).toBe("Keep the existing envelope for one release");
  });

  it("falls back to the selected option", () => {
    expect(
      resolvePendingUserInputAnswer(
        {
          id: "scope",
          header: "Scope",
          question: "What should the plan target first?",
          options: [],
        },
        {
          selectedOptionLabels: ["Scaffold only"],
        },
      ),
    ).toBe("Scaffold only");
  });

  it("clears the preset selection when a custom answer is entered", () => {
    expect(
      setPendingUserInputCustomAnswer(
        {
          selectedOptionLabels: ["Preserve existing tags"],
        },
        "doesn't matter",
      ),
    ).toEqual({
      customAnswer: "doesn't matter",
    });
  });

  it("returns all selected options for multi-select questions", () => {
    expect(
      resolvePendingUserInputAnswer(
        {
          id: "targets",
          header: "Targets",
          question: "Which outputs should we ship?",
          multiSelect: true,
          options: [],
        },
        {
          selectedOptionLabels: ["CLI", "Desktop"],
        },
      ),
    ).toEqual(["CLI", "Desktop"]);
  });
});

describe("togglePendingUserInputOptionSelection", () => {
  it("toggles options for multi-select questions", () => {
    const question = {
      id: "targets",
      header: "Targets",
      question: "Which outputs should we ship?",
      multiSelect: true,
      options: [],
    } as const;

    expect(
      togglePendingUserInputOptionSelection(question, { selectedOptionLabels: ["CLI"] }, "Desktop"),
    ).toEqual({
      customAnswer: "",
      selectedOptionLabels: ["CLI", "Desktop"],
    });

    expect(
      togglePendingUserInputOptionSelection(
        question,
        { selectedOptionLabels: ["CLI", "Desktop"] },
        "CLI",
      ),
    ).toEqual({
      customAnswer: "",
      selectedOptionLabels: ["Desktop"],
    });
  });
});

describe("buildPendingUserInputAnswers", () => {
  it("includes default single-select answers for untouched prompts", () => {
    expect(
      buildPendingUserInputAnswers(
        [
          {
            id: "scope",
            header: "Scope",
            question: "What should the plan target first?",
            options: [
              {
                label: "Renderer first (Recommended)",
                description: "Fix the visible submit path first",
              },
            ],
          },
        ],
        {},
      ),
    ).toEqual({
      scope: "Renderer first (Recommended)",
    });
  });

  it("returns a canonical answer map for complete prompts", () => {
    expect(
      buildPendingUserInputAnswers(
        [
          {
            id: "scope",
            header: "Scope",
            question: "What should the plan target first?",
            options: [
              {
                label: "Orchestration-first",
                description: "Focus on orchestration first",
              },
            ],
          },
          {
            id: "compat",
            header: "Compat",
            question: "How strict should compatibility be?",
            options: [
              {
                label: "Keep current envelope",
                description: "Preserve current wire format",
              },
            ],
          },
        ],
        {
          scope: {
            selectedOptionLabels: ["Orchestration-first"],
          },
          compat: {
            customAnswer: "Keep the current envelope for one release window",
          },
        },
      ),
    ).toEqual({
      scope: "Orchestration-first",
      compat: "Keep the current envelope for one release window",
    });
  });

  it("returns null when any multi-select question is unanswered", () => {
    expect(
      buildPendingUserInputAnswers(
        [
          {
            id: "scope",
            header: "Scope",
            question: "What should the plan target first?",
            multiSelect: true,
            options: [
              {
                label: "Orchestration-first",
                description: "Focus on orchestration first",
              },
            ],
          },
        ],
        {},
      ),
    ).toBeNull();
  });
});

describe("pending user input question progress", () => {
  const questions = [
    {
      id: "scope",
      header: "Scope",
      question: "What should the plan target first?",
      options: [
        {
          label: "Orchestration-first",
          description: "Focus on orchestration first",
        },
      ],
    },
    {
      id: "compat",
      header: "Compat",
      question: "How strict should compatibility be?",
      options: [
        {
          label: "Keep current envelope",
          description: "Preserve current wire format",
        },
      ],
    },
  ] as const;

  it("counts default single-select options as answered", () => {
    expect(countAnsweredPendingUserInputQuestions(questions, {})).toBe(2);
  });

  it("finds the first unanswered multi-select question", () => {
    const questionsWithRequiredMultiSelect = [
      questions[0],
      {
        ...questions[1],
        multiSelect: true,
      },
    ] as const;

    expect(findFirstUnansweredPendingUserInputQuestionIndex(questionsWithRequiredMultiSelect, {}))
      .toBe(1);
  });

  it("returns the last question index when all answers are complete", () => {
    expect(
      findFirstUnansweredPendingUserInputQuestionIndex(questions, {
        scope: {
          selectedOptionLabels: ["Orchestration-first"],
        },
        compat: {
          customAnswer: "Keep it for one release window",
        },
      }),
    ).toBe(1);
  });

  it("derives the active question and advancement state", () => {
    expect(
      derivePendingUserInputProgress(
        questions,
        {
          scope: {
            selectedOptionLabels: ["Orchestration-first"],
          },
        },
        0,
      ),
    ).toMatchObject({
      questionIndex: 0,
      activeQuestion: questions[0],
      selectedOptionLabels: ["Orchestration-first"],
      customAnswer: "",
      resolvedAnswer: "Orchestration-first",
      answeredQuestionCount: 2,
      isLastQuestion: false,
      isComplete: true,
      canAdvance: true,
    });
  });
});
