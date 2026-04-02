import type { 
  Meeting, 
  Task, 
  FollowUp, 
  EmailThread,
  BriefContext 
} from '../models/types';
import { isOverdue, getTimeUntilMeeting } from '../utils/date';

export interface PriorityScore {
  total: number;
  breakdown: {
    meetings: number;
    tasks: number;
    followUps: number;
    emails: number;
  };
  isHighPriority: boolean;
  topPriorities: string[];
}

export class PrioritizationService {
  private readonly HIGH_PRIORITY_THRESHOLD: number;

  constructor(highPriorityThreshold: number = 8) {
    this.HIGH_PRIORITY_THRESHOLD = highPriorityThreshold;
  }

  calculatePriority(context: BriefContext): PriorityScore {
    const meetingScore = this.scoreMeetings(context.meetings);
    const taskScore = this.scoreTasks(context.tasks);
    const followUpScore = this.scoreFollowUps(context.followUps);
    const emailScore = this.scoreEmails(context.emails);

    const total = Math.min(meetingScore + taskScore + followUpScore + emailScore, 10);
    const isHighPriority = total >= this.HIGH_PRIORITY_THRESHOLD;

    const topPriorities = this.identifyTopPriorities(context);

    return {
      total,
      breakdown: {
        meetings: meetingScore,
        tasks: taskScore,
        followUps: followUpScore,
        emails: emailScore,
      },
      isHighPriority,
      topPriorities,
    };
  }

  private scoreMeetings(meetings: Meeting[]): number {
    if (meetings.length === 0) return 0;

    let score = 0;

    meetings.forEach(meeting => {
      // Base score for having a meeting
      score += 1;

      // Add importance score
      score += (meeting.importance_score || 5) / 10;

      // Early morning or late evening meetings are higher priority
      const hour = meeting.start_time.getHours();
      if (hour < 9 || hour >= 18) {
        score += 0.5;
      }

      // Back-to-back meetings increase score
      const hasBackToBack = meetings.some(m => 
        m.id !== meeting.id &&
        Math.abs(m.start_time.getTime() - meeting.end_time.getTime()) < 15 * 60 * 1000
      );
      if (hasBackToBack) {
        score += 0.3;
      }
    });

    // Many meetings in a day increases priority
    if (meetings.length > 5) score += 2;
    else if (meetings.length > 3) score += 1;

    return Math.min(score, 10); // Cap at 10
  }

  private scoreTasks(tasks: Task[]): number {
    if (tasks.length === 0) return 0;

    let score = 0;

    tasks.forEach(task => {
      switch (task.priority) {
        case 'urgent':
          score += 2;
          break;
        case 'high':
          score += 1.5;
          break;
        case 'medium':
          score += 1;
          break;
        case 'low':
          score += 0.5;
          break;
      }

      // Overdue tasks increase score significantly
      if (task.due_date && isOverdue(task.due_date)) {
        score += 1.5;
      }
    });

    return Math.min(score, 10);
  }

  private scoreFollowUps(followUps: Array<FollowUp & { person?: any }>): number {
    if (followUps.length === 0) return 0;

    let score = 0;

    followUps.forEach(followUp => {
      // Base score for follow-up
      score += 0.5;

      // Priority-based scoring
      score += (followUp.priority / 10);

      // Person importance
      if (followUp.person?.importance) {
        score += (followUp.person.importance / 20);
      }

      // Overdue follow-ups are critical
      if (isOverdue(followUp.due_date)) {
        score += 1;
      }
    });

    return Math.min(score, 10);
  }

  private scoreEmails(emails: EmailThread[]): number {
    if (emails.length === 0) return 0;

    let score = 0;

    emails.forEach(email => {
      if (email.isImportant) score += 0.5;
      if (email.isUnread) score += 0.3;
      
      // Very recent emails (last 24h) are higher priority
      const hoursSince = (Date.now() - email.date.getTime()) / (1000 * 60 * 60);
      if (hoursSince < 24) {
        score += 0.5;
      }
    });

    // Many important emails increase priority
    const importantCount = emails.filter(e => e.isImportant).length;
    if (importantCount > 5) score += 2;
    else if (importantCount > 2) score += 1;

    return Math.min(score, 10);
  }

  private identifyTopPriorities(context: BriefContext): string[] {
    const priorities: Array<{ text: string; score: number }> = [];

    // Check for urgent meetings
    const nextMeeting = [...context.meetings]
      .sort((a, b) => a.start_time.getTime() - b.start_time.getTime())[0];
    
    if (nextMeeting) {
      const timeUntil = getTimeUntilMeeting(nextMeeting.start_time);
      priorities.push({
        text: `${nextMeeting.title} (${timeUntil})`,
        score: nextMeeting.importance_score || 5,
      });
    }

    // Check for urgent tasks
    const urgentTasks = context.tasks
      .filter(t => t.priority === 'urgent' && t.status !== 'completed')
      .slice(0, 2);
    
    urgentTasks.forEach(task => {
      priorities.push({
        text: task.title,
        score: 10,
      });
    });

    // Check for overdue follow-ups
    const overdueFollowUps = context.followUps
      .filter(f => isOverdue(f.due_date))
      .slice(0, 2);
    
    overdueFollowUps.forEach(followUp => {
      const person = followUp.person?.name || 'someone';
      priorities.push({
        text: `Follow up with ${person}: ${followUp.subject}`,
        score: 9,
      });
    });

    // Check for high-priority tasks due today
    const highPriorityTasks = context.tasks
      .filter(t => 
        t.priority === 'high' && 
        t.status !== 'completed' &&
        t.due_date && !isOverdue(t.due_date)
      )
      .slice(0, 2);
    
    highPriorityTasks.forEach(task => {
      priorities.push({
        text: task.title,
        score: 6,
      });
    });

    // Sort by score and return top 3
    return priorities
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(p => p.text);
  }

  scoreMeetingImportance(meeting: Meeting, attendeeEmails: string[]): number {
    let score = 5; // Base score

    // Check for keywords in title
    const importantKeywords = ['urgent', 'critical', 'important', 'review', 'decision', 'launch', 'deadline'];
    const title = meeting.title.toLowerCase();
    if (importantKeywords.some(kw => title.includes(kw))) {
      score += 2;
    }

    // Check for C-level attendees
    const executivePatterns = ['ceo', 'cto', 'cfo', 'coo', 'founder', 'president', 'vp'];
    const hasExecutive = attendeeEmails.some(email => 
      executivePatterns.some(pattern => email.toLowerCase().includes(pattern))
    );
    if (hasExecutive) {
      score += 2;
    }

    // Large meetings (>5 people) are often important
    if (meeting.attendees.length > 5) {
      score += 1;
    }

    // 1-on-1 meetings are also often important
    if (meeting.attendees.length === 2) {
      score += 1;
    }

    return Math.min(score, 10);
  }
}

export const prioritizationService = new PrioritizationService();
