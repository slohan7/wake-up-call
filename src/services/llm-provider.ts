import OpenAI from 'openai';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';

export interface LLMProvider {
  generateText(prompt: string, maxTokens?: number): Promise<string>;
  generateJSON<T>(prompt: string, maxTokens?: number): Promise<T>;
}

interface AnthropicMessageResponse {
  content?: Array<{
    type: string;
    text?: string;
  }>;
  error?: {
    message?: string;
    type?: string;
  };
}

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string = config.OPENAI_API_KEY!, model: string = config.LLM_MODEL) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async generateText(prompt: string, maxTokens: number = 2000): Promise<string> {
    return withRetry(async () => {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
          temperature: 0.7,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error('No content generated');
        }

        return content;
      } catch (error) {
        logger.error('OpenAI text generation failed', { error });
        throw error;
      }
    });
  }

  async generateJSON<T>(prompt: string, maxTokens: number = 2000): Promise<T> {
    return withRetry(async () => {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
          temperature: 0.7,
          response_format: { type: 'json_object' },
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error('No content generated');
        }

        return JSON.parse(content) as T;
      } catch (error) {
        logger.error('OpenAI JSON generation failed', { error });
        throw error;
      }
    });
  }
}

export class AnthropicProvider implements LLMProvider {
  constructor(
    private apiKey: string = config.ANTHROPIC_API_KEY!,
    private model: string = config.LLM_MODEL
  ) {}

  async generateText(prompt: string, maxTokens: number = 2000): Promise<string> {
    return withRetry(async () => {
      try {
        return await this.requestMessage(prompt, maxTokens);
      } catch (error) {
        logger.error('Anthropic text generation failed', { error });
        throw error;
      }
    });
  }

  async generateJSON<T>(prompt: string, maxTokens: number = 2000): Promise<T> {
    return withRetry(async () => {
      try {
        const content = await this.requestMessage(
          `${prompt}\n\nReturn only valid JSON. Do not wrap the response in markdown fences and do not add commentary.`,
          maxTokens,
          0.2
        );
        return parseJsonResponse<T>(content);
      } catch (error) {
        logger.error('Anthropic JSON generation failed', { error });
        throw error;
      }
    });
  }

  private async requestMessage(
    prompt: string,
    maxTokens: number,
    temperature: number = 0.7
  ): Promise<string> {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'anthropic-version': ANTHROPIC_API_VERSION,
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        temperature,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    const body = await response.json() as AnthropicMessageResponse;
    if (!response.ok) {
      const message = body.error?.message || response.statusText || 'Unknown Anthropic API error';
      throw new Error(`Anthropic API request failed (${response.status}): ${message}`);
    }

    const content = (body.content || [])
      .filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text!.trim())
      .filter(Boolean)
      .join('\n')
      .trim();

    if (!content) {
      throw new Error('No content generated');
    }

    return content;
  }
}

export class MockLLMProvider implements LLMProvider {
  async generateText(prompt: string): Promise<string> {
    logger.info('Mock LLM generateText called', { promptLength: prompt.length });
    return `Mock response for prompt: ${prompt.substring(0, 100)}...`;
  }

  async generateJSON<T>(prompt: string): Promise<T> {
    logger.info('Mock LLM generateJSON called', { promptLength: prompt.length });
    
    // Return mock brief data
    return {
      fullBrief: `# Daily Brief - Mock Data

## Executive Summary
This is a mock daily brief for testing purposes.

## Top Priorities
1. Review quarterly reports
2. Team standup at 10 AM
3. Follow up with investors

## Meetings Today
- 10:00 AM - Team Standup (30 min)
- 2:00 PM - Product Review (1 hr)
- 4:00 PM - 1:1 with Sarah (30 min)

## Action Items
- Send update email to board
- Review and approve marketing budget
- Schedule next week's customer calls`,
      
      smsBrief: 'Mock Brief: 3 meetings today. First: Team Standup 10AM. Priorities: 1) Quarterly reports 2) Team standup 3) Investor follow-ups. 2 overdue tasks.',
      
      voiceBrief: 'Good morning! You have a busy day with three meetings. Your first is the team standup at 10 AM. Top priority today is reviewing the quarterly reports. You also have two overdue follow-ups that need attention.',
      
      topPriorities: [
        'Review quarterly reports',
        'Team standup at 10 AM',
        'Follow up with investors',
      ],
    } as T;
  }
}

function parseJsonResponse<T>(content: string): T {
  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
    }

    throw new Error('Failed to parse JSON from LLM response');
  }
}

export function getConfiguredLLMDisplayName(): string {
  switch (config.LLM_PROVIDER) {
    case 'anthropic':
      return 'Anthropic Claude';
    case 'openai':
      return 'OpenAI';
    case 'mock':
    default:
      return 'Mock LLM';
  }
}

export function hasConfiguredLiveLLMKey(): boolean {
  switch (config.LLM_PROVIDER) {
    case 'anthropic':
      return !!config.ANTHROPIC_API_KEY;
    case 'openai':
      return !!config.OPENAI_API_KEY;
    case 'mock':
    default:
      return false;
  }
}

export function createLLMProvider(): LLMProvider {
  switch (config.LLM_PROVIDER) {
    case 'anthropic':
      if (!config.ANTHROPIC_API_KEY) {
        logger.warn('Anthropic API key not configured, falling back to mock provider');
        return new MockLLMProvider();
      }
      return new AnthropicProvider();

    case 'openai':
      if (!config.OPENAI_API_KEY) {
        logger.warn('OpenAI API key not configured, falling back to mock provider');
        return new MockLLMProvider();
      }
      return new OpenAIProvider();
    
    case 'mock':
    default:
      return new MockLLMProvider();
  }
}
