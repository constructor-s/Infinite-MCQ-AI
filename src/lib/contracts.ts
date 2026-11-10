import { z } from "zod";
import { blueprintTagsSchema, type BlueprintTags } from "./blueprint.js";
import { focusedStudySchema } from "./studyFocus.js";
export type { BlueprintTags } from "./blueprint.js";

export const optionIdSchema = z.enum(["A", "B", "C", "D", "E"]);
export type OptionId = z.infer<typeof optionIdSchema>;

export const topicDefinitionSchema = z.object({
  id: z.string().min(3),
  category: z.string().min(2),
  title: z.string().min(2),
  description: z.string().min(20),
  weight: z.number().positive(),
  status: z.literal("curated")
});

export type TopicDefinition = z.infer<typeof topicDefinitionSchema>;

const questionFieldsSchema = z.object({
  vignette: z.string().trim().min(40).max(3500),
  blueprint: blueprintTagsSchema,
  stem: z.string().min(15),
  options: z.array(z.object({
    id: optionIdSchema,
    text: z.string().min(2),
    hint: z.string().min(15),
    explanation: z.string().min(15)
  })).length(5),
  correctOptionId: optionIdSchema,
  highYieldPearl: z.string().min(15),
  vignetteSignature: z.string().min(8).max(120)
});

function validateOptions(question: z.infer<typeof questionFieldsSchema>, ctx: z.RefinementCtx) {
  const ids = question.options.map((option) => option.id);
  const texts = question.options.map((option) => option.text.trim().toLowerCase());
  if (new Set(ids).size !== 5 || !["A", "B", "C", "D", "E"].every((id) => ids.includes(id as OptionId))) {
    ctx.addIssue({ code: "custom", path: ["options"], message: "Options must contain unique IDs A through E" });
  }
  if (new Set(texts).size !== 5) {
    ctx.addIssue({ code: "custom", path: ["options"], message: "Option text must be unique" });
  }
  if (!ids.includes(question.correctOptionId)) {
    ctx.addIssue({ code: "custom", path: ["correctOptionId"], message: "Correct option must exist" });
  }
}

export const generatedQuestionSchema = questionFieldsSchema.superRefine(validateOptions);

export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;

const questionMetadataSchema = z.object({
  id: z.string().uuid(),
  topicId: z.string(),
  topicTitle: z.string(),
  category: z.string(),
  model: z.string(),
  generatedAt: z.string().datetime(),
  optionOrderVersion: z.literal(1)
});

export const clinicalQuestionSchema = questionFieldsSchema.extend({
  ...questionMetadataSchema.shape,
  schemaVersion: z.literal(2),
  blueprintVersion: z.string().min(1),
  curriculumVersion: z.string().min(1),
  crosswalkVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  enablingObjectiveId: z.string().min(1),
  // Local generation provenance; the generation HTTP response omits this field.
  generationFocus: focusedStudySchema.optional()
}).superRefine(validateOptions);
export type ClinicalQuestion = z.infer<typeof clinicalQuestionSchema>;

export const generateQuestionRequestSchema = z.object({
  topicId: z.string().min(3),
  blueprint: blueprintTagsSchema,
  enablingObjectiveId: z.string().min(1),
  model: z.enum(["gemini-3.5-flash-lite", "gemini-3.8-flash"]),
  avoidSignatures: z.array(z.string().min(3).max(120)).max(5).default([])
});

export type GenerateQuestionRequest = z.infer<typeof generateQuestionRequestSchema>;

export type QuestionGenerationDiagnostic = {
  requestId?: string;
  stage: "candidate" | "refinement";
  category: "schema" | "json" | "quality";
  code: string;
  issues: { path: (string | number)[]; code: string; message: string }[];
  issueCount: number;
  truncated: boolean;
};

export const questionQualityWarningSchema = z.object({
  requestId: z.string().optional(),
  stage: z.enum(["candidate", "refinement"]),
  category: z.literal("quality"),
  code: z.string().min(1),
  issues: z.array(z.object({
    path: z.array(z.union([z.string(), z.number()])),
    code: z.string().min(1),
    message: z.string()
  }).strict()),
  issueCount: z.number().int().nonnegative(),
  truncated: z.boolean()
}).strict();
export type QuestionQualityWarning = z.infer<typeof questionQualityWarningSchema>;

export type EncounterMode = "fresh" | "review";
export type FollowUpMessage = { role: "user" | "assistant"; text: string };
export type Encounter = {
  id: string;
  questionId: string;
  topicId: string;
  blueprint: BlueprintTags;
  mode: EncounterMode;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  firstSelectedOptionId?: OptionId;
  firstAttemptCorrect?: boolean;
  selectedOptionIds: OptionId[];
  revealedAnswer: boolean;
  eventuallyCorrect: boolean;
  followUpMessages?: FollowUpMessage[];
};

export type ModelOption = {
  id: "gemini-3.5-flash-lite" | "gemini-3.8-flash";
  label: string;
  description: string;
  available: boolean;
};

export type Theme = "auto" | "light" | "dark";
