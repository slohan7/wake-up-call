import { 
  BriefContext, 
  GeneratedBrief, 
  Meeting,
  Task,
  FollowUp,
  EmailThread,
} from '../models/types';
import { createLLMProvider, LLMProvider } from './llm-provider';
import { PrioritizationService } from './prioritization';
import { 
  BRIEF_GENERATION_PROMPT,
  formatMeetingsForPrompt,
  formatTasksForPrompt,
  formatFollowUpsForPrompt,
  formatEmailsForPrompt,
  formatSystemPrioritiesForPrompt,
} from '../prompts/brief-prompts';
import { 
  formatLocalDate, 
  formatLocalTime, 
  getMeetingDuration,
  getTimeUntilMeeting,
} from '../utils/date';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

export class BriefGeneratorService {
  private llmProvider: LLMProvider;
  private prioritizationService: PrioritizationService;
  private lastGenerationUsedFallback = false;

  constructor(provider?: LLMProvider) {
    this.llmProvider = provider ?? createLLMProvider();
    this.prioritizationService = new PrioritizationService(config.HIGH_PRIORITY_THRESHOLD);
  }

  setLLMProvider(provider: LLMProvider): void {
    this.llmProvider = provider;
  }

  getLastGenerationMetadata(): { usedFallback: boolean } {
    return {
      usedFallback: this.lastGenerationUsedFallback,
    };
  }

  async generateBrief(context: BriefContext): Promise<GeneratedBrief> {
    const priorityScore = this.prioritizationService.calculatePriority(context);

    try {
      this.lastGenerationUsedFallback = false;
      // Prepare data for prompt
      const meetingsData = this.prepareMeetingsData(context.meetings);
      const tasksData = this.prepareTasksData(context.tasks);
      const followUpsData = this.prepareFollowUpsData(context.followUps);
      const emailsData = this.prepareEmailsData(context.emails);

      // Generate the brief using LLM
      const prompt = this.buildPrompt(
        context,
        priorityScore,
        meetingsData,
        tasksData,
        followUpsData,
        emailsData
      );

      const generatedContent = await this.llmProvider.generateJSON<{
        fullBrief: string;
        smsBrief: string;
        voiceBrief: string;
        topPriorities: string[];
      }>(prompt);

      // Ensure content meets length requirements
      const processedContent = this.processGeneratedContent(generatedContent);

      return {
        fullBrief: processedContent.fullBrief,
        smsBrief: processedContent.smsBrief,
        voiceBrief: processedContent.voiceBrief,
        priorityScore: priorityScore.total,
        isHighPriority: priorityScore.isHighPriority,
        topPriorities: processedContent.topPriorities || priorityScore.topPriorities,
      };
    } catch (error) {
      this.lastGenerationUsedFallback = true;
      logger.error('Failed to generate brief', { error });
      
      // Fallback to basic brief generation
      return this.generateFallbackBrief(context, priorityScore);
    }
  }

  private prepareMeetingsData(meetings: Meeting[]): any[] {
    return meetings.map(meeting => ({
      title: meeting.title,
      startTime: formatLocalTime(meeting.start_time),
      endTime: formatLocalTime(meeting.end_time),
      duration: getMeetingDuration(meeting.start_time, meeting.end_time),
      timeUntil: getTimeUntilMeeting(meeting.start_time),
      attendees: meeting.attendees.slice(0, 5), // Limit attendees for brevity
      location: meeting.location,
      description: meeting.description?.substring(0, 200),
      prepNotes: meeting.prep_notes,
      importance: meeting.importance_score,
    }));
  }

  private prepareTasksData(tasks: Task[]): any[] {
    return tasks
      .filter(t => t.status !== 'completed')
      .sort((a, b) => {
        // Sort by priority then due date
        const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) return priorityDiff;
        
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return a.due_date.getTime() - b.due_date.getTime();
      })
      .slice(0, 10) // Limit to top 10 tasks
      .map(task => ({
        title: task.title,
        priority: task.priority,
        dueDate: task.due_date ? formatLocalDate(task.due_date) : null,
        isOverdue: task.due_date ? task.due_date < new Date() : false,
        category: task.category,
      }));
  }

  private prepareFollowUpsData(followUps: Array<FollowUp & { person?: any }>): any[] {
    return followUps
      .filter(f => f.status === 'pending')
      .sort((a, b) => {
        // Overdue first, then by priority
        const aOverdue = a.due_date < new Date();
        const bOverdue = b.due_date < new Date();
        if (aOverdue && !bOverdue) return -1;
        if (!aOverdue && bOverdue) return 1;
        return b.priority - a.priority;
      })
      .slice(0, 10)
      .map(followUp => ({
        person: followUp.person,
        subject: followUp.subject,
        context: followUp.context,
        dueDate: formatLocalDate(followUp.due_date),
        isOverdue: followUp.due_date < new Date(),
        priority: followUp.priority,
      }));
  }

  private prepareEmailsData(emails: EmailThread[]): any[] {
    return emails
      .sort((a, b) => {
        // Important and unread first
        if (a.isImportant && !b.isImportant) return -1;
        if (!a.isImportant && b.isImportant) return 1;
        if (a.isUnread && !b.isUnread) return -1;
        if (!a.isUnread && b.isUnread) return 1;
        return b.date.getTime() - a.date.getTime();
      })
      .slice(0, 10)
      .map(email => ({
        from: email.from,
        subject: email.subject,
        snippet: email.snippet.substring(0, 100),
        date: formatLocalDate(email.date),
        isImportant: email.isImportant,
        isUnread: email.isUnread,
      }));
  }

  private buildPrompt(
    context: BriefContext,
    priorityScore: any,
    meetings: any[],
    tasks: any[],
    followUps: any[],
    emails: any[]
  ): string {
    const prompt = BRIEF_GENERATION_PROMPT
      .replace('{date}', formatLocalDate(context.date, 'EEEE, MMMM d, yyyy'))
      .replace('{timezone}', context.timezone)
      .replace('{priorityScore}', priorityScore.total.toString())
      .replace('{isHighPriority}', priorityScore.isHighPriority.toString())
      .replace('{systemPriorities}', formatSystemPrioritiesForPrompt(priorityScore.topPriorities))
      .replace('{meetings}', formatMeetingsForPrompt(meetings))
      .replace('{tasks}', formatTasksForPrompt(tasks))
      .replace('{followUps}', formatFollowUpsForPrompt(followUps))
      .replace('{emails}', formatEmailsForPrompt(emails));

    return prompt;
  }

  private processGeneratedContent(content: any): any {
    // Ensure SMS brief is within length limit
    if (content.smsBrief && content.smsBrief.length > config.MAX_SMS_LENGTH) {
      content.smsBrief = content.smsBrief.substring(0, config.MAX_SMS_LENGTH - 3) + '...';
    }

    // Ensure full brief is within length limit
    if (content.fullBrief && content.fullBrief.length > config.MAX_BRIEF_LENGTH * 10) {
      content.fullBrief = content.fullBrief.substring(0, config.MAX_BRIEF_LENGTH * 10);
    }

    // Ensure voice brief is reasonable length (roughly 150 words per minute)
    const maxVoiceWords = Math.floor(config.MAX_VOICE_SECONDS * 2.5);
    if (content.voiceBrief) {
      const words = content.voiceBrief.split(/\s+/);
      if (words.length > maxVoiceWords) {
        content.voiceBrief = words.slice(0, maxVoiceWords).join(' ') + '.';
      }
    }

    return content;
  }

  private generateFallbackBrief(
    context: BriefContext,
    priorityScore = this.prioritizationService.calculatePriority(context)
  ): GeneratedBrief {
    const date = formatLocalDate(context.date, 'EEEE, MMMM d');
    const meetingCount = context.meetings.length;
    const taskCount = context.tasks.filter(t => t.status !== 'completed').length;
    const followUpCount = context.followUps.filter(f => f.status === 'pending').length;
    
    const firstMeeting = context.meetings[0];
    const firstMeetingText = firstMeeting 
      ? `First: ${firstMeeting.title} at ${formatLocalTime(firstMeeting.start_time)}`
      : 'No meetings scheduled';

    const urgentTasks = context.tasks.filter(t => t.priority === 'urgent' && t.status !== 'completed');
    const topPriorities = [
      urgentTasks[0]?.title,
      firstMeeting?.title,
      `${followUpCount} follow-ups pending`,
    ].filter(Boolean).slice(0, 3);

    const fullBrief = `# Daily Brief - ${date}

## Summary
- ${meetingCount} meetings scheduled
- ${taskCount} tasks pending
- ${followUpCount} follow-ups required

## Top Priorities
${topPriorities.map((p, i) => `${i + 1}. ${p}`).join('\n')}

## Schedule
${context.meetings.map(m => 
  `- ${formatLocalTime(m.start_time)}: ${m.title} (${getMeetingDuration(m.start_time, m.end_time)})`
).join('\n') || 'No meetings today'}

## Pending Tasks
${context.tasks
  .filter(t => t.status !== 'completed')
  .slice(0, 5)
  .map(t => `- [${t.priority.toUpperCase()}] ${t.title}`)
  .join('\n') || 'No pending tasks'}`;

    const smsBrief = `${date}: ${meetingCount} meetings, ${taskCount} tasks, ${followUpCount} follow-ups. ${firstMeetingText}. Top: ${topPriorities[0] || 'Check schedule'}.`;

    const voiceBrief = `Good morning! Today is ${date}. You have ${meetingCount} meetings, ${taskCount} pending tasks, and ${followUpCount} follow-ups to handle. ${firstMeetingText}. Your top priority is ${topPriorities[0] || 'reviewing your schedule'}. Have a productive day!`;

    return {
      fullBrief,
      smsBrief: smsBrief.substring(0, config.MAX_SMS_LENGTH),
      voiceBrief,
      priorityScore: priorityScore.total,
      isHighPriority: priorityScore.isHighPriority,
      topPriorities: priorityScore.topPriorities.length > 0 ? priorityScore.topPriorities : topPriorities,
    };
  }
}
