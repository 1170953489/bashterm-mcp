import { z } from "zod";

// z.coerce.boolean() converts "false" string to true (truthy).
// This preprocessor handles string "false"/"true" correctly.
const coerceBoolean = z.preprocess((val) => {
  if (typeof val === "string") return val.toLowerCase() === "true";
  return val;
}, z.boolean());

export const terminalCreateSchema = z.object({
  name: z.string().min(1).describe("Display name for the terminal tab"),
  cwd: z.string().optional().describe("Working directory for the terminal"),
  env: z
    .record(z.string())
    .optional()
    .describe("Additional environment variables"),
  shell: z
    .string()
    .optional()
    .describe(
      "Override shell. On Windows, omitted shell creates a cmd session.",
    ),
  agentId: z
    .string()
    .optional()
    .describe("Identifier for the owning agent/subagent"),
});

export const terminalExecuteSchema = z.object({
  sessionId: z.string().min(1).describe("Session ID of the target terminal"),
  command: z.string().min(1).describe("Command to execute"),
  timeoutMs: z.coerce
    .number()
    .min(1000)
    .max(300000)
    .optional()
    .default(30000)
    .describe("Timeout in milliseconds (default: 30000, max: 300000)"),
  waitForCompletion: coerceBoolean
    .optional()
    .default(true)
    .describe("Wait for command to complete before returning (default: true)"),
});

export const terminalReadOutputSchema = z.object({
  sessionId: z.string().min(1).describe("Session ID of the target terminal"),
  offset: z.coerce
    .number()
    .optional()
    .default(0)
    .describe("Line offset (0 = from last read cursor, negative = tail)"),
  lines: z.coerce
    .number()
    .min(1)
    .max(5000)
    .optional()
    .default(500)
    .describe("Maximum lines to return (default: 500, max: 5000)"),
});

export const terminalListSchema = z.object({
  agentId: z
    .string()
    .optional()
    .describe("Filter sessions by agent ID (omit for all sessions)"),
});

export const terminalCloseSchema = z.object({
  sessionId: z.string().min(1).describe("Session ID of the terminal to close"),
});

export const terminalRunSchema = z.object({
  command: z.string().min(1).describe("Command to execute"),
  name: z
    .string()
    .optional()
    .describe("Display name for the terminal tab (auto-generated if omitted)"),
  cwd: z.string().optional().describe("Working directory for the terminal"),
  env: z
    .record(z.string())
    .optional()
    .describe("Additional environment variables"),
  shell: z
    .string()
    .optional()
    .describe(
      "Override shell. On Windows, run plans the command first and defaults ordinary commands to cmd.",
    ),
  agentId: z
    .string()
    .optional()
    .describe("Identifier for the owning agent/subagent"),
  timeoutMs: z.coerce
    .number()
    .min(1000)
    .max(300000)
    .optional()
    .default(30000)
    .describe("Timeout in milliseconds (default: 30000, max: 300000)"),
  waitForCompletion: coerceBoolean
    .optional()
    .default(true)
    .describe("Wait for command to complete before returning (default: true)"),
});

export const terminalSendInputSchema = z.object({
  sessionId: z.string().min(1).describe("Session ID of the target terminal"),
  input: z.string().describe("Text input to send to the terminal"),
  pressEnter: z.coerce
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to press Enter after the input (default: true)"),
});
