import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
import type { Harnessfile } from "../../ir/types.js";

// Builds the LangGraph state annotation from the harnessfile IR.
// Extends MessagesAnnotation (which includes the messages array with concat reducer)
// with step output fields and internal tracking fields.

export function buildStateAnnotation(ir: Harnessfile) {
  // Collect output field names from all steps that declare output schemas
  const outputFields: Record<string, string> = {};
  if (ir.steps) {
    for (const [stepName, step] of Object.entries(ir.steps)) {
      if (step.output) {
        for (const [field, type] of Object.entries(step.output)) {
          outputFields[`${stepName}_${field}`] = type;
        }
      }
    }
  }

  // Build the state annotation extending MessagesAnnotation
  // MessagesAnnotation already provides { messages: BaseMessage[] } with concat reducer
  const StateAnnotation = Annotation.Root({
    // Include messages from MessagesAnnotation
    ...MessagesAnnotation.spec,

    // Current step being executed
    _currentStep: Annotation<string>({
      reducer: (_prev, next) => next,
      default: () => "",
    }),

    // Step outputs stored by step name
    _stepOutputs: Annotation<Record<string, unknown>>({
      reducer: (prev, next) => ({ ...prev, ...next }),
      default: () => ({}),
    }),

    // Eval iteration counters per step
    _evalIterations: Annotation<Record<string, number>>({
      reducer: (prev, next) => ({ ...prev, ...next }),
      default: () => ({}),
    }),

    // Trigger input data
    _triggerData: Annotation<Record<string, unknown>>({
      reducer: (_prev, next) => next,
      default: () => ({}),
    }),
  });

  return StateAnnotation;
}

export type HarnessState = ReturnType<typeof buildStateAnnotation>;
