import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import {
  getEndOfLocalDay,
  getLocalDateKey,
  getStartOfLocalDay,
  parseLocalDateKey,
} from '../utils/date';
import type { 
  Person, 
  Meeting, 
  Task, 
  FollowUp, 
  Brief, 
  DeliveryLog,
  WorkflowRun,
} from '../models/types';

export class DatabaseService {
  private db: Database.Database;

  constructor(databasePath: string = config.DATABASE_PATH) {
    if (databasePath !== ':memory:') {
      mkdirSync(dirname(databasePath), { recursive: true });
    }

    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initializeSchema();
  }

  private initializeSchema(): void {
    try {
      const schemaPath = this.resolveSchemaPath();
      const schema = readFileSync(schemaPath, 'utf-8');
      this.db.exec(schema);
      logger.info('Database schema initialized');
    } catch (error) {
      logger.error('Failed to initialize database schema:', error);
      throw error;
    }
  }

  private resolveSchemaPath(): string {
    const candidates = [
      join(__dirname, 'schema.sql'),
      join(process.cwd(), 'src', 'db', 'schema.sql'),
      join(process.cwd(), 'dist', 'db', 'schema.sql'),
    ];

    const schemaPath = candidates.find(candidate => existsSync(candidate));
    if (!schemaPath) {
      throw new Error('Unable to locate schema.sql');
    }

    return schemaPath;
  }

  private mapPerson(row: any): Person {
    return {
      ...row,
      last_contact: this.parseNullableDateValue(row.last_contact),
      created_at: this.parseDateValue(row.created_at),
      updated_at: this.parseDateValue(row.updated_at),
    };
  }

  private mapBrief(row: any): Brief {
    return {
      ...row,
      date: parseLocalDateKey(row.date),
      is_high_priority: Boolean(row.is_high_priority),
      created_at: this.parseDateValue(row.created_at),
    };
  }

  private mapWorkflowRun(row: any): WorkflowRun {
    return {
      ...row,
      dry_run: Boolean(row.dry_run),
      integration_failures: row.integration_failures ? JSON.parse(row.integration_failures) : [],
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      created_at: this.parseDateValue(row.created_at),
    };
  }

  private mapDeliveryLog(row: any): DeliveryLog {
    return {
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      delivered_at: this.parseNullableDateValue(row.delivered_at),
      created_at: this.parseDateValue(row.created_at),
    };
  }

  private parseDateValue(value: unknown): Date | undefined {
    if (!value) {
      return undefined;
    }

    return this.parseDateLike(value);
  }

  private parseNullableDateValue(value: unknown): Date | null {
    if (!value) {
      return null;
    }

    return this.parseDateLike(value);
  }

  private parseDateLike(value: unknown): Date {
    if (value instanceof Date) {
      return value;
    }

    const stringValue = String(value);
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stringValue)) {
      return new Date(stringValue.replace(' ', 'T') + 'Z');
    }

    return new Date(stringValue);
  }

  // People operations
  createPerson(person: Omit<Person, 'id' | 'created_at' | 'updated_at'>): Person {
    const stmt = this.db.prepare(`
      INSERT INTO people (email, name, company, importance, last_contact)
      VALUES (@email, @name, @company, @importance, @last_contact)
    `);
    
    const info = stmt.run({
      ...person,
      last_contact: person.last_contact?.toISOString() || null,
    });
    return this.getPerson(info.lastInsertRowid as number)!;
  }

  getPerson(id: number): Person | null {
    const stmt = this.db.prepare('SELECT * FROM people WHERE id = ?');
    const row = stmt.get(id) as any;
    return row ? this.mapPerson(row) : null;
  }

  getPersonByEmail(email: string): Person | null {
    const stmt = this.db.prepare('SELECT * FROM people WHERE email = ?');
    const row = stmt.get(email) as any;
    return row ? this.mapPerson(row) : null;
  }

  getAllPeople(): Person[] {
    const stmt = this.db.prepare(`
      SELECT * FROM people
      ORDER BY importance DESC, updated_at DESC, created_at DESC
    `);
    const rows = stmt.all() as any[];
    return rows.map(row => this.mapPerson(row));
  }

  updatePerson(id: number, person: Omit<Person, 'id' | 'created_at' | 'updated_at'>): Person {
    const stmt = this.db.prepare(`
      UPDATE people
      SET
        email = @email,
        name = @name,
        company = @company,
        importance = @importance,
        last_contact = @last_contact,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `);

    stmt.run({
      id,
      ...person,
      last_contact: person.last_contact?.toISOString() || null,
    });

    return this.getPerson(id)!;
  }

  updatePersonLastContact(id: number, lastContact: Date): void {
    const stmt = this.db.prepare(`
      UPDATE people 
      SET last_contact = @lastContact, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `);
    stmt.run({ id, lastContact: lastContact.toISOString() });
  }

  deletePersonByEmail(email: string): void {
    const stmt = this.db.prepare('DELETE FROM people WHERE email = ?');
    stmt.run(email);
  }

  countFollowUpsForPerson(personId: number): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM follow_ups WHERE person_id = ?');
    const row = stmt.get(personId) as { count: number };
    return row.count;
  }

  // Meeting operations
  upsertMeeting(meeting: Omit<Meeting, 'id' | 'created_at'>): Meeting {
    const stmt = this.db.prepare(`
      INSERT INTO meetings (
        calendar_id, title, start_time, end_time, 
        attendees, location, description, prep_notes, importance_score
      ) VALUES (
        @calendar_id, @title, @start_time, @end_time,
        @attendees, @location, @description, @prep_notes, @importance_score
      )
      ON CONFLICT(calendar_id) DO UPDATE SET
        title = @title,
        start_time = @start_time,
        end_time = @end_time,
        attendees = @attendees,
        location = @location,
        description = @description,
        prep_notes = @prep_notes,
        importance_score = @importance_score
    `);

    const params = {
      ...meeting,
      start_time: meeting.start_time.toISOString(),
      end_time: meeting.end_time.toISOString(),
      attendees: JSON.stringify(meeting.attendees),
    };

    stmt.run(params);
    return this.getMeetingByCalendarId(meeting.calendar_id)!;
  }

  getMeetingByCalendarId(calendarId: string): Meeting | null {
    const stmt = this.db.prepare('SELECT * FROM meetings WHERE calendar_id = ?');
    const row = stmt.get(calendarId) as any;
    if (!row) return null;

    return {
      ...row,
      start_time: this.parseDateLike(row.start_time),
      end_time: this.parseDateLike(row.end_time),
      attendees: JSON.parse(row.attendees),
      created_at: this.parseDateValue(row.created_at),
    };
  }

  deleteMeetingByCalendarId(calendarId: string): void {
    const stmt = this.db.prepare('DELETE FROM meetings WHERE calendar_id = ?');
    stmt.run(calendarId);
  }

  getTodayMeetings(date: Date): Meeting[] {
    const startOfDay = getStartOfLocalDay(date);
    const endOfDay = getEndOfLocalDay(date);

    const stmt = this.db.prepare(`
      SELECT * FROM meetings 
      WHERE start_time >= ? AND start_time <= ?
      ORDER BY start_time ASC
    `);

    const rows = stmt.all(startOfDay.toISOString(), endOfDay.toISOString()) as any[];
    return rows.map(row => ({
      ...row,
      start_time: this.parseDateLike(row.start_time),
      end_time: this.parseDateLike(row.end_time),
      attendees: JSON.parse(row.attendees),
      created_at: this.parseDateValue(row.created_at),
    }));
  }

  // Task operations
  createTask(task: Omit<Task, 'id' | 'created_at' | 'updated_at'>): Task {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (title, description, due_date, priority, status, category)
      VALUES (@title, @description, @due_date, @priority, @status, @category)
    `);

    const params = {
      ...task,
      due_date: task.due_date?.toISOString() || null,
    };

    const info = stmt.run(params);
    return this.getTask(info.lastInsertRowid as number)!;
  }

  getTask(id: number): Task | null {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;

    return {
      ...row,
      due_date: this.parseNullableDateValue(row.due_date),
      created_at: this.parseDateValue(row.created_at),
      updated_at: this.parseDateValue(row.updated_at),
    };
  }

  getTaskByTitle(title: string): Task | null {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE title = ? ORDER BY id ASC LIMIT 1');
    const row = stmt.get(title) as any;
    if (!row) return null;

    return {
      ...row,
      due_date: this.parseNullableDateValue(row.due_date),
      created_at: this.parseDateValue(row.created_at),
      updated_at: this.parseDateValue(row.updated_at),
    };
  }

  getPendingTasks(includeOverdue: boolean = true): Task[] {
    let query = `
      SELECT * FROM tasks 
      WHERE status IN ('pending', 'in_progress')
    `;
    const params: unknown[] = [];

    if (includeOverdue) {
      query += ' AND (due_date IS NULL OR due_date <= ?)';
      params.push(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
    }

    query += ` ORDER BY 
      CASE priority 
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
      END,
      due_date ASC`;

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      ...row,
      due_date: this.parseNullableDateValue(row.due_date),
      created_at: this.parseDateValue(row.created_at),
      updated_at: this.parseDateValue(row.updated_at),
    }));
  }

  updateTaskStatus(id: number, status: Task['status']): void {
    const stmt = this.db.prepare(`
      UPDATE tasks 
      SET status = @status, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `);
    stmt.run({ id, status });
  }

  updateTask(id: number, task: Omit<Task, 'id' | 'created_at' | 'updated_at'>): Task {
    const stmt = this.db.prepare(`
      UPDATE tasks
      SET
        title = @title,
        description = @description,
        due_date = @due_date,
        priority = @priority,
        status = @status,
        category = @category,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `);

    stmt.run({
      id,
      ...task,
      due_date: task.due_date?.toISOString() || null,
    });

    return this.getTask(id)!;
  }

  deleteTaskByTitle(title: string): void {
    const stmt = this.db.prepare('DELETE FROM tasks WHERE title = ?');
    stmt.run(title);
  }

  // Follow-up operations
  createFollowUp(followUp: Omit<FollowUp, 'id' | 'created_at' | 'updated_at'>): FollowUp {
    const stmt = this.db.prepare(`
      INSERT INTO follow_ups (person_id, subject, context, due_date, status, priority)
      VALUES (@person_id, @subject, @context, @due_date, @status, @priority)
    `);

    const params = {
      ...followUp,
      due_date: followUp.due_date.toISOString(),
    };

    const info = stmt.run(params);
    return this.getFollowUp(info.lastInsertRowid as number)!;
  }

  getFollowUp(id: number): FollowUp | null {
    const stmt = this.db.prepare('SELECT * FROM follow_ups WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;

    return {
      ...row,
      due_date: this.parseDateLike(row.due_date),
      created_at: this.parseDateValue(row.created_at),
      updated_at: this.parseDateValue(row.updated_at),
    };
  }

  getFollowUpByPersonAndSubject(personId: number, subject: string): FollowUp | null {
    const stmt = this.db.prepare(`
      SELECT * FROM follow_ups
      WHERE person_id = ? AND subject = ?
      ORDER BY id ASC
      LIMIT 1
    `);
    const row = stmt.get(personId, subject) as any;
    if (!row) return null;

    return {
      ...row,
      due_date: this.parseDateLike(row.due_date),
      created_at: this.parseDateValue(row.created_at),
      updated_at: this.parseDateValue(row.updated_at),
    };
  }

  deleteFollowUpByPersonAndSubject(personId: number, subject: string): void {
    const stmt = this.db.prepare('DELETE FROM follow_ups WHERE person_id = ? AND subject = ?');
    stmt.run(personId, subject);
  }

  getOverdueFollowUps(): Array<FollowUp & { person?: Person }> {
    const stmt = this.db.prepare(`
      SELECT 
        f.*,
        p.id as person_id,
        p.email as person_email,
        p.name as person_name,
        p.company as person_company,
        p.importance as person_importance,
        p.last_contact as person_last_contact,
        p.created_at as person_created_at,
        p.updated_at as person_updated_at
      FROM follow_ups f
      LEFT JOIN people p ON f.person_id = p.id
      WHERE f.status = 'pending' AND f.due_date <= ?
      ORDER BY f.priority DESC, f.due_date ASC
    `);

    const rows = stmt.all(new Date().toISOString()) as any[];
    return rows.map(row => ({
      id: row.id,
      person_id: row.person_id,
      subject: row.subject,
      context: row.context,
      due_date: this.parseDateLike(row.due_date),
      status: row.status,
      priority: row.priority,
      created_at: this.parseDateValue(row.created_at),
      updated_at: this.parseDateValue(row.updated_at),
      person: row.person_email ? {
        id: row.person_id,
        email: row.person_email,
        name: row.person_name,
        company: row.person_company,
        importance: row.person_importance,
        last_contact: this.parseNullableDateValue(row.person_last_contact),
        created_at: this.parseDateValue(row.person_created_at),
        updated_at: this.parseDateValue(row.person_updated_at),
      } : undefined,
    }));
  }

  getPendingFollowUps(): Array<FollowUp & { person?: Person }> {
    const stmt = this.db.prepare(`
      SELECT 
        f.*,
        p.id as person_id,
        p.email as person_email,
        p.name as person_name,
        p.company as person_company,
        p.importance as person_importance,
        p.last_contact as person_last_contact,
        p.created_at as person_created_at,
        p.updated_at as person_updated_at
      FROM follow_ups f
      LEFT JOIN people p ON f.person_id = p.id
      WHERE f.status = 'pending'
      ORDER BY
        CASE WHEN f.due_date <= ? THEN 0 ELSE 1 END,
        f.priority DESC,
        f.due_date ASC
    `);

    const rows = stmt.all(new Date().toISOString()) as any[];
    return rows.map(row => ({
      id: row.id,
      person_id: row.person_id,
      subject: row.subject,
      context: row.context,
      due_date: this.parseDateLike(row.due_date),
      status: row.status,
      priority: row.priority,
      created_at: this.parseDateValue(row.created_at),
      updated_at: this.parseDateValue(row.updated_at),
      person: row.person_email ? {
        id: row.person_id,
        email: row.person_email,
        name: row.person_name,
        company: row.person_company,
        importance: row.person_importance,
        last_contact: this.parseNullableDateValue(row.person_last_contact),
        created_at: this.parseDateValue(row.person_created_at),
        updated_at: this.parseDateValue(row.person_updated_at),
      } : undefined,
    }));
  }

  updateFollowUpStatus(id: number, status: FollowUp['status']): void {
    const stmt = this.db.prepare(`
      UPDATE follow_ups 
      SET status = @status, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `);
    stmt.run({ id, status });
  }

  updateFollowUp(id: number, followUp: Omit<FollowUp, 'id' | 'created_at' | 'updated_at'>): FollowUp {
    const stmt = this.db.prepare(`
      UPDATE follow_ups
      SET
        person_id = @person_id,
        subject = @subject,
        context = @context,
        due_date = @due_date,
        status = @status,
        priority = @priority,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `);

    stmt.run({
      id,
      ...followUp,
      due_date: followUp.due_date.toISOString(),
    });

    return this.getFollowUp(id)!;
  }

  // Brief operations
  createBrief(brief: Omit<Brief, 'id' | 'created_at'>): Brief {
    const stmt = this.db.prepare(`
      INSERT INTO briefs (date, full_content, sms_content, voice_content, priority_score, is_high_priority)
      VALUES (@date, @full_content, @sms_content, @voice_content, @priority_score, @is_high_priority)
    `);

    const params = {
      ...brief,
      date: getLocalDateKey(brief.date),
      is_high_priority: brief.is_high_priority ? 1 : 0,
    };

    const info = stmt.run(params);
    return this.getBrief(info.lastInsertRowid as number)!;
  }

  getBrief(id: number): Brief | null {
    const stmt = this.db.prepare('SELECT * FROM briefs WHERE id = ?');
    const row = stmt.get(id) as any;
    return row ? this.mapBrief(row) : null;
  }

  getBriefByDate(date: Date): Brief | null {
    const dateStr = getLocalDateKey(date);
    const stmt = this.db.prepare('SELECT * FROM briefs WHERE date = ?');
    const row = stmt.get(dateStr) as any;
    return row ? this.mapBrief(row) : null;
  }

  getLatestBrief(): Brief | null {
    const stmt = this.db.prepare('SELECT * FROM briefs ORDER BY date DESC LIMIT 1');
    const row = stmt.get() as any;
    return row ? this.mapBrief(row) : null;
  }

  getBriefDateKey(brief: Brief): string {
    return getLocalDateKey(brief.date);
  }

  updateBrief(id: number, brief: Omit<Brief, 'id' | 'created_at'>): Brief {
    const stmt = this.db.prepare(`
      UPDATE briefs
      SET
        date = @date,
        full_content = @full_content,
        sms_content = @sms_content,
        voice_content = @voice_content,
        priority_score = @priority_score,
        is_high_priority = @is_high_priority
      WHERE id = @id
    `);

    stmt.run({
      id,
      ...brief,
      date: getLocalDateKey(brief.date),
      is_high_priority: brief.is_high_priority ? 1 : 0,
    });

    return this.getBrief(id)!;
  }

  // Delivery log operations
  createDeliveryLog(log: Omit<DeliveryLog, 'id' | 'created_at'>): DeliveryLog {
    const stmt = this.db.prepare(`
      INSERT INTO delivery_logs (
        brief_id, delivery_type, status, recipient, 
        error_message, metadata, delivered_at
      ) VALUES (
        @brief_id, @delivery_type, @status, @recipient,
        @error_message, @metadata, @delivered_at
      )
    `);

    const params = {
      ...log,
      metadata: log.metadata ? JSON.stringify(log.metadata) : null,
      delivered_at: log.delivered_at?.toISOString() || null,
    };

    const info = stmt.run(params);
    return this.getDeliveryLog(info.lastInsertRowid as number)!;
  }

  getDeliveryLog(id: number): DeliveryLog | null {
    const stmt = this.db.prepare('SELECT * FROM delivery_logs WHERE id = ?');
    const row = stmt.get(id) as any;
    return row ? this.mapDeliveryLog(row) : null;
  }

  updateDeliveryLogStatus(
    id: number, 
    status: DeliveryLog['status'], 
    errorMessage?: string
  ): void {
    const stmt = this.db.prepare(`
      UPDATE delivery_logs 
      SET 
        status = @status, 
        error_message = @errorMessage,
        delivered_at = CASE WHEN @status = 'sent' THEN datetime('now') ELSE delivered_at END
      WHERE id = @id
    `);
    
    stmt.run({ 
      id, 
      status, 
      errorMessage: errorMessage || null 
    });
  }

  getDeliveryLogByProviderMessageId(
    providerMessageId: string,
    deliveryType?: DeliveryLog['delivery_type']
  ): DeliveryLog | null {
    const rows = deliveryType
      ? this.db
          .prepare(`
            SELECT * FROM delivery_logs
            WHERE delivery_type = ?
            ORDER BY created_at DESC, id DESC
          `)
          .all(deliveryType)
      : this.db
          .prepare(`
            SELECT * FROM delivery_logs
            ORDER BY created_at DESC, id DESC
          `)
          .all();

    for (const row of rows as any[]) {
      const deliveryLog = this.mapDeliveryLog(row);
      if (
        deliveryLog.metadata?.messageId === providerMessageId ||
        deliveryLog.metadata?.callId === providerMessageId
      ) {
        return deliveryLog;
      }
    }

    return null;
  }

  updateDeliveryLogByProviderMessageId(options: {
    providerMessageId: string;
    deliveryType?: DeliveryLog['delivery_type'];
    status: DeliveryLog['status'];
    errorMessage?: string | null;
    metadata?: Record<string, unknown>;
  }): DeliveryLog | null {
    const { providerMessageId, deliveryType, status, errorMessage, metadata } = options;
    const existing = this.getDeliveryLogByProviderMessageId(providerMessageId, deliveryType);
    if (!existing?.id) {
      return null;
    }

    const stmt = this.db.prepare(`
      UPDATE delivery_logs
      SET
        status = @status,
        error_message = @errorMessage,
        metadata = @metadata,
        delivered_at = CASE WHEN @status = 'sent' THEN datetime('now') ELSE delivered_at END
      WHERE id = @id
    `);

    stmt.run({
      id: existing.id,
      status,
      errorMessage: errorMessage || null,
      metadata: JSON.stringify({
        ...(existing.metadata || {}),
        ...(metadata || {}),
      }),
    });

    return this.getDeliveryLog(existing.id);
  }

  getDeliveryLogsForBrief(briefId: number): DeliveryLog[] {
    const stmt = this.db.prepare(`
      SELECT * FROM delivery_logs 
      WHERE brief_id = ?
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(briefId) as any[];
    return rows.map(row => this.mapDeliveryLog(row));
  }

  getLatestDeliveryForDate(date: Date, deliveryType: DeliveryLog['delivery_type']): DeliveryLog | null {
    const dateStr = getLocalDateKey(date);
    const stmt = this.db.prepare(`
      SELECT dl.*
      FROM delivery_logs dl
      JOIN briefs b ON dl.brief_id = b.id
      WHERE b.date = ? AND dl.delivery_type = ?
      ORDER BY dl.created_at DESC, dl.id DESC
      LIMIT 1
    `);

    const row = stmt.get(dateStr, deliveryType) as any;
    return row ? this.mapDeliveryLog(row) : null;
  }

  // Check for duplicate delivery
  hasDeliveryForToday(date: Date, deliveryType: DeliveryLog['delivery_type']): boolean {
    const dateStr = getLocalDateKey(date);
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM delivery_logs dl
      JOIN briefs b ON dl.brief_id = b.id
      WHERE b.date = ? AND dl.delivery_type = ? AND dl.status = 'sent'
    `);

    const result = stmt.get(dateStr, deliveryType) as { count: number };
    return result.count > 0;
  }

  createWorkflowRun(run: Omit<WorkflowRun, 'id' | 'created_at'>): WorkflowRun {
    const stmt = this.db.prepare(`
      INSERT INTO workflow_runs (
        run_type, trigger, date_key, status, dry_run, brief_id,
        sms_status, voice_status, integration_failures, error_message, metadata
      ) VALUES (
        @run_type, @trigger, @date_key, @status, @dry_run, @brief_id,
        @sms_status, @voice_status, @integration_failures, @error_message, @metadata
      )
    `);

    const info = stmt.run({
      ...run,
      dry_run: run.dry_run ? 1 : 0,
      integration_failures: JSON.stringify(run.integration_failures || []),
      metadata: run.metadata ? JSON.stringify(run.metadata) : null,
    });

    return this.getWorkflowRun(info.lastInsertRowid as number)!;
  }

  getWorkflowRun(id: number): WorkflowRun | null {
    const stmt = this.db.prepare('SELECT * FROM workflow_runs WHERE id = ?');
    const row = stmt.get(id) as any;
    return row ? this.mapWorkflowRun(row) : null;
  }

  getLatestWorkflowRun(runType: WorkflowRun['run_type'] = 'daily_brief'): WorkflowRun | null {
    const stmt = this.db.prepare(`
      SELECT * FROM workflow_runs
      WHERE run_type = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `);
    const row = stmt.get(runType) as any;
    return row ? this.mapWorkflowRun(row) : null;
  }

  getLatestWorkflowRuns(runType: WorkflowRun['run_type'], limit: number = 5): WorkflowRun[] {
    const stmt = this.db.prepare(`
      SELECT * FROM workflow_runs
      WHERE run_type = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `);
    const rows = stmt.all(runType, limit) as any[];
    return rows.map(row => this.mapWorkflowRun(row));
  }

  getLatestSmokeRunForDate(date: Date, trigger: string): WorkflowRun | null {
    const stmt = this.db.prepare(`
      SELECT * FROM workflow_runs
      WHERE run_type = 'smoke_test' AND trigger = ? AND date_key = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `);
    const row = stmt.get(trigger, getLocalDateKey(date)) as any;
    return row ? this.mapWorkflowRun(row) : null;
  }

  countRecords(table: 'people' | 'meetings' | 'tasks' | 'follow_ups' | 'briefs' | 'delivery_logs' | 'workflow_runs'): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`);
    const result = stmt.get() as { count: number };
    return result.count;
  }

  // Cleanup old data
  cleanupOldData(daysToKeep: number = 30): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const stmt = this.db.prepare(`
      DELETE FROM briefs 
      WHERE date < ?
    `);

    const info = stmt.run(getLocalDateKey(cutoffDate));
    logger.info(`Cleaned up ${info.changes} old briefs`);
  }

  close(): void {
    this.db.close();
  }
}
