import { DatabaseService } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';

describe('DatabaseService', () => {
  let db: DatabaseService;

  beforeEach(() => {
    // Use in-memory database for tests
    db = new DatabaseService(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  describe('People operations', () => {
    it('should create and retrieve a person', () => {
      const personData = {
        email: 'test@example.com',
        name: 'Test User',
        company: 'Test Co',
        importance: 7,
        last_contact: null,
      };

      const created = db.createPerson(personData);
      expect(created.id).toBeDefined();
      expect(created.email).toBe(personData.email);

      const retrieved = db.getPerson(created.id!);
      expect(retrieved).toEqual(created);
    });

    it('should find person by email', () => {
      const personData = {
        email: 'findme@example.com',
        name: 'Find Me',
        company: null,
        importance: 5,
        last_contact: null,
      };

      db.createPerson(personData);
      const found = db.getPersonByEmail('findme@example.com');
      
      expect(found).not.toBeNull();
      expect(found?.email).toBe('findme@example.com');
    });
  });

  describe('Task operations', () => {
    it('should create and retrieve tasks', () => {
      const taskData = {
        title: 'Test Task',
        description: 'Test description',
        due_date: new Date(),
        priority: 'high' as const,
        status: 'pending' as const,
        category: 'Test',
      };

      const created = db.createTask(taskData);
      expect(created.id).toBeDefined();
      expect(created.title).toBe(taskData.title);

      const retrieved = db.getTask(created.id!);
      expect(retrieved?.title).toBe(taskData.title);
    });

    it('should get pending tasks', () => {
      // Create multiple tasks with different statuses
      db.createTask({
        title: 'Pending Task',
        priority: 'medium',
        status: 'pending',
        due_date: new Date(),
        description: null,
        category: null,
      });

      db.createTask({
        title: 'Completed Task',
        priority: 'low',
        status: 'completed',
        due_date: null,
        description: null,
        category: null,
      });

      const pending = db.getPendingTasks();
      expect(pending).toHaveLength(1);
      expect(pending[0].title).toBe('Pending Task');
    });
  });

  describe('Meeting operations', () => {
    it('should upsert meetings', () => {
      const now = new Date();
      const meetingData = {
        calendar_id: 'gcal-123',
        title: 'Test Meeting',
        start_time: now,
        end_time: new Date(now.getTime() + 60 * 60 * 1000),
        attendees: ['user1@example.com', 'user2@example.com'],
        location: 'Conference Room',
        description: 'Test meeting description',
        prep_notes: null,
        importance_score: 7,
      };

      // First insert
      const created = db.upsertMeeting(meetingData);
      expect(created.id).toBeDefined();
      expect(created.title).toBe(meetingData.title);

      // Update
      const updated = db.upsertMeeting({
        ...meetingData,
        title: 'Updated Meeting',
      });
      expect(updated.id).toBe(created.id);
      expect(updated.title).toBe('Updated Meeting');
    });

    it('should get today meetings', () => {
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Today's meeting
      db.upsertMeeting({
        calendar_id: 'today-1',
        title: 'Today Meeting',
        start_time: new Date(today.setHours(10, 0, 0, 0)),
        end_time: new Date(today.setHours(11, 0, 0, 0)),
        attendees: [],
        location: null,
        description: null,
        prep_notes: null,
        importance_score: 5,
      });

      // Tomorrow's meeting
      db.upsertMeeting({
        calendar_id: 'tomorrow-1',
        title: 'Tomorrow Meeting',
        start_time: new Date(tomorrow.setHours(10, 0, 0, 0)),
        end_time: new Date(tomorrow.setHours(11, 0, 0, 0)),
        attendees: [],
        location: null,
        description: null,
        prep_notes: null,
        importance_score: 5,
      });

      const todayMeetings = db.getTodayMeetings(new Date());
      expect(todayMeetings).toHaveLength(1);
      expect(todayMeetings[0].title).toBe('Today Meeting');
    });
  });

  describe('Brief operations', () => {
    it('should create and retrieve briefs', () => {
      const briefData = {
        date: new Date(),
        full_content: 'Full brief content',
        sms_content: 'SMS brief',
        voice_content: 'Voice brief',
        priority_score: 7.5,
        is_high_priority: false,
      };

      const created = db.createBrief(briefData);
      expect(created.id).toBeDefined();
      expect(created.full_content).toBe(briefData.full_content);

      const retrieved = db.getBrief(created.id!);
      expect(retrieved?.full_content).toBe(briefData.full_content);
    });

    it('should prevent duplicate briefs for same date', () => {
      const date = new Date();
      const briefData = {
        date,
        full_content: 'Content 1',
        sms_content: 'SMS 1',
        voice_content: 'Voice 1',
        priority_score: 5,
        is_high_priority: false,
      };

      db.createBrief(briefData);
      
      // Should throw error for duplicate date
      expect(() => {
        db.createBrief({
          ...briefData,
          full_content: 'Content 2',
        });
      }).toThrow();
    });

    it('should update an existing brief', () => {
      const date = new Date('2026-04-01T12:00:00Z');
      const created = db.createBrief({
        date,
        full_content: 'Original',
        sms_content: 'Original SMS',
        voice_content: 'Original voice',
        priority_score: 4,
        is_high_priority: false,
      });

      const updated = db.updateBrief(created.id!, {
        date,
        full_content: 'Updated',
        sms_content: 'Updated SMS',
        voice_content: 'Updated voice',
        priority_score: 9,
        is_high_priority: true,
      });

      expect(updated.id).toBe(created.id);
      expect(updated.full_content).toBe('Updated');
      expect(updated.priority_score).toBe(9);
      expect(updated.is_high_priority).toBe(true);
    });
  });

  describe('Delivery log operations', () => {
    it('should track delivery logs', () => {
      // Create a brief first
      const brief = db.createBrief({
        date: new Date(),
        full_content: 'Test',
        sms_content: 'Test',
        voice_content: 'Test',
        priority_score: 5,
        is_high_priority: false,
      });

      const logData = {
        brief_id: brief.id!,
        delivery_type: 'sms' as const,
        status: 'sent' as const,
        recipient: '+1234567890',
        error_message: null,
        metadata: { messageId: 'twilio-123' },
        delivered_at: new Date(),
      };

      const created = db.createDeliveryLog(logData);
      expect(created.id).toBeDefined();
      expect(created.delivery_type).toBe('sms');

      const logs = db.getDeliveryLogsForBrief(brief.id!);
      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe('sent');
    });

    it('should check for duplicate delivery', () => {
      const date = new Date();
      const brief = db.createBrief({
        date,
        full_content: 'Test',
        sms_content: 'Test',
        voice_content: 'Test',
        priority_score: 5,
        is_high_priority: false,
      });

      db.createDeliveryLog({
        brief_id: brief.id!,
        delivery_type: 'sms',
        status: 'sent',
        recipient: '+1234567890',
        error_message: null,
        metadata: null,
        delivered_at: new Date(),
      });

      const hasSMS = db.hasDeliveryForToday(date, 'sms');
      const hasVoice = db.hasDeliveryForToday(date, 'voice');

      expect(hasSMS).toBe(true);
      expect(hasVoice).toBe(false);
    });

    it('updates a delivery log by provider message id', () => {
      const brief = db.createBrief({
        date: new Date(),
        full_content: 'Test',
        sms_content: 'Test',
        voice_content: 'Test',
        priority_score: 5,
        is_high_priority: false,
      });

      db.createDeliveryLog({
        brief_id: brief.id!,
        delivery_type: 'sms',
        status: 'pending',
        recipient: '+1234567890',
        error_message: null,
        metadata: {
          messageId: 'SM123',
          providerStatus: 'queued',
        },
        delivered_at: null,
      });

      const updated = db.updateDeliveryLogByProviderMessageId({
        providerMessageId: 'SM123',
        deliveryType: 'sms',
        status: 'sent',
        metadata: {
          providerStatus: 'delivered',
        },
      });

      expect(updated).not.toBeNull();
      expect(updated?.status).toBe('sent');
      expect(updated?.metadata?.messageId).toBe('SM123');
      expect(updated?.metadata?.providerStatus).toBe('delivered');
      expect(updated?.delivered_at).toBeInstanceOf(Date);
    });
  });

  describe('Seed behavior', () => {
    it('does not create duplicate sample records on repeated seed runs', () => {
      const first = seedDatabase(db);
      const second = seedDatabase(db);

      expect(first.createdCounts).toEqual({
        people: 4,
        tasks: 4,
        followUps: 3,
        meetings: 3,
      });

      expect(second.createdCounts).toEqual({
        people: 0,
        tasks: 0,
        followUps: 0,
        meetings: 0,
      });

      expect(second.skippedCounts).toEqual({
        people: 4,
        tasks: 4,
        followUps: 3,
        meetings: 3,
      });

      expect(db.countRecords('people')).toBe(4);
      expect(db.countRecords('tasks')).toBe(4);
      expect(db.countRecords('follow_ups')).toBe(3);
      expect(db.countRecords('meetings')).toBe(3);
    });
  });
});
