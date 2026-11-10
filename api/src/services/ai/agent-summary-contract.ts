import type { AiResponseFormat } from './client'

/** Kept separate from prompts so experiments use the actual parser contract. */
export const AGENT_SUMMARY_FORMAT: AiResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'agent_conversation_summary',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        goal: { type: 'string', maxLength: 800 },
        ...Object.fromEntries(['decisions', 'rejected', 'openQuestions', 'nextSteps', 'references'].map(key => [key,
          { type: 'array', maxItems: 16, items: { type: 'string', maxLength: 600 } },
        ])),
      },
      required: ['goal', 'decisions', 'rejected', 'openQuestions', 'nextSteps', 'references'],
      additionalProperties: false,
    },
  },
}
