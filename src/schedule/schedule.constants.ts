export const SCHEDULE_WEEKDAY = {
  MONDAY: 'MONDAY',
  TUESDAY: 'TUESDAY',
  WEDNESDAY: 'WEDNESDAY',
  THURSDAY: 'THURSDAY',
  FRIDAY: 'FRIDAY',
  SATURDAY: 'SATURDAY',
  SUNDAY: 'SUNDAY',
} as const;

export type ScheduleWeekdayValue =
  (typeof SCHEDULE_WEEKDAY)[keyof typeof SCHEDULE_WEEKDAY];

export const USER_ROLE = {
  USER: 'USER',
  ADMIN: 'ADMIN',
  COACH: 'COACH',
} as const;
