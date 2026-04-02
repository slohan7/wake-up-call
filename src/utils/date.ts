import { format, utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz';
import { 
  startOfDay, 
  endOfDay, 
  formatDistanceToNow,
  differenceInMinutes,
  addDays,
} from 'date-fns';
import { config } from './config';

export function getLocalDate(date: Date = new Date()): Date {
  return utcToZonedTime(date, config.TIMEZONE);
}

export function toUTC(localDate: Date): Date {
  return zonedTimeToUtc(localDate, config.TIMEZONE);
}

export function getLocalDateKey(date: Date = new Date()): string {
  return format(date, 'yyyy-MM-dd', { timeZone: config.TIMEZONE });
}

export function parseLocalDateKey(dateKey: string): Date {
  return zonedTimeToUtc(`${dateKey}T12:00:00`, config.TIMEZONE);
}

export function parseInputDate(value: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return parseLocalDateKey(value);
  }

  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

export function formatLocalTime(date: Date, formatStr: string = 'h:mm a'): string {
  return format(date, formatStr, { timeZone: config.TIMEZONE });
}

export function formatLocalDate(date: Date, formatStr: string = 'MMM d, yyyy'): string {
  return format(date, formatStr, { timeZone: config.TIMEZONE });
}

export function getStartOfLocalDay(date: Date = new Date()): Date {
  const localDate = getLocalDate(date);
  return toUTC(startOfDay(localDate));
}

export function getEndOfLocalDay(date: Date = new Date()): Date {
  const localDate = getLocalDate(date);
  return toUTC(endOfDay(localDate));
}

export function getRelativeDateLabel(date: Date): string {
  const today = getLocalDateKey();
  const tomorrow = getLocalDateKey(addDays(new Date(), 1));
  const yesterday = getLocalDateKey(addDays(new Date(), -1));
  const target = getLocalDateKey(date);

  if (target === today) return 'Today';
  if (target === tomorrow) return 'Tomorrow';
  if (target === yesterday) return 'Yesterday';
  
  return formatLocalDate(date, 'EEEE, MMM d');
}

export function getTimeUntilMeeting(meetingTime: Date): string {
  const now = new Date();
  const minutes = differenceInMinutes(meetingTime, now);

  if (minutes < 0) {
    return 'Started ' + formatDistanceToNow(meetingTime, { addSuffix: true });
  }

  if (minutes === 0) return 'Starting now';
  if (minutes < 60) return `In ${minutes} minutes`;
  if (minutes < 120) return `In 1 hour`;
  if (minutes < 1440) return `In ${Math.floor(minutes / 60)} hours`;
  
  return formatDistanceToNow(meetingTime, { addSuffix: true });
}

export function getDaysFromNow(days: number): Date {
  return addDays(new Date(), days);
}

export function isOverdue(date: Date): boolean {
  return date.getTime() < Date.now();
}

export function getDayOfWeek(date: Date): string {
  return format(date, 'EEEE', { timeZone: config.TIMEZONE });
}

export function getMeetingDuration(start: Date, end: Date): string {
  const minutes = differenceInMinutes(end, start);
  
  if (minutes < 60) return `${minutes}min`;
  if (minutes === 60) return '1hr';
  if (minutes % 60 === 0) return `${minutes / 60}hr`;
  
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}hr ${mins}min`;
}
