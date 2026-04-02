import { PrioritizationService } from '../src/services/prioritization';
import { BriefContext, Meeting, Task, FollowUp } from '../src/models/types';

describe('PrioritizationService', () => {
  let service: PrioritizationService;
  
  beforeEach(() => {
    service = new PrioritizationService(8);
  });

  describe('calculatePriority', () => {
    it('should return low priority for empty day', () => {
      const context: BriefContext = {
        date: new Date(),
        timezone: 'America/Detroit',
        meetings: [],
        tasks: [],
        followUps: [],
        emails: [],
        previousBrief: null,
      };

      const result = service.calculatePriority(context);
      
      expect(result.total).toBe(0);
      expect(result.isHighPriority).toBe(false);
      expect(result.topPriorities).toHaveLength(0);
    });

    it('should return high priority for busy day', () => {
      const now = new Date();
      const context: BriefContext = {
        date: now,
        timezone: 'America/Detroit',
        meetings: [
          {
            id: 1,
            calendar_id: 'test-1',
            title: 'Important Meeting',
            start_time: new Date(now.getTime() + 60 * 60 * 1000),
            end_time: new Date(now.getTime() + 2 * 60 * 60 * 1000),
            attendees: ['ceo@company.com'],
            importance_score: 9,
          } as Meeting,
        ],
        tasks: [
          {
            id: 1,
            title: 'Urgent Task',
            priority: 'urgent',
            status: 'pending',
            due_date: now,
          } as Task,
          {
            id: 2,
            title: 'High Priority Task',
            priority: 'high',
            status: 'pending',
            due_date: now,
          } as Task,
        ],
        followUps: [
          {
            id: 1,
            person_id: 1,
            subject: 'Important follow-up',
            due_date: new Date(now.getTime() - 24 * 60 * 60 * 1000), // Overdue
            status: 'pending',
            priority: 8,
          } as FollowUp,
        ],
        emails: [],
        previousBrief: null,
      };

      const result = service.calculatePriority(context);
      
      expect(result.total).toBeGreaterThan(5);
      expect(result.topPriorities).toHaveLength(3);
      expect(result.topPriorities[0]).toContain('Urgent Task');
    });

    it('should identify top priorities correctly', () => {
      const now = new Date();
      const context: BriefContext = {
        date: now,
        timezone: 'America/Detroit',
        meetings: [
          {
            id: 1,
            calendar_id: 'test-1',
            title: 'Team Standup',
            start_time: new Date(now.getTime() + 30 * 60 * 1000),
            end_time: new Date(now.getTime() + 60 * 60 * 1000),
            attendees: ['team@company.com'],
            importance_score: 5,
          } as Meeting,
        ],
        tasks: [
          {
            id: 1,
            title: 'Review contracts',
            priority: 'urgent',
            status: 'pending',
            due_date: now,
          } as Task,
        ],
        followUps: [],
        emails: [],
        previousBrief: null,
      };

      const result = service.calculatePriority(context);
      
      expect(result.topPriorities).toContain('Review contracts');
      expect(result.topPriorities.some(p => p.includes('Team Standup'))).toBe(true);
    });
  });

  describe('scoreMeetingImportance', () => {
    it('should score urgent meetings higher', () => {
      const meeting: Meeting = {
        id: 1,
        calendar_id: 'test',
        title: 'URGENT: Budget Review',
        start_time: new Date(),
        end_time: new Date(),
        attendees: ['user@example.com'],
        importance_score: 5,
      } as Meeting;

      const score = service.scoreMeetingImportance(meeting, meeting.attendees);
      
      expect(score).toBeGreaterThan(5);
    });

    it('should score executive meetings higher', () => {
      const meeting: Meeting = {
        id: 1,
        calendar_id: 'test',
        title: 'Quarterly Review',
        start_time: new Date(),
        end_time: new Date(),
        attendees: ['ceo@company.com', 'user@company.com'],
        importance_score: 5,
      } as Meeting;

      const score = service.scoreMeetingImportance(meeting, meeting.attendees);
      
      expect(score).toBeGreaterThan(5);
    });
  });
});