import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { handlePrismaError } from '../common/database/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import {
  SCHEDULE_WEEKDAY,
  type ScheduleWeekdayValue,
} from './schedule.constants';
import { CreateScheduleSlotDto } from './dto/create-schedule-slot.dto';
import { CreateTemplateSlotDto } from './dto/create-template-slot.dto';
import { UpdateScheduleSlotDto } from './dto/update-schedule-slot.dto';

const templateSlotSelect = {
  id: true,
  weekday: true,
  title: true,
  startTime: true,
  endTime: true,
  ageBadge: true,
  secondaryBadge: true,
  sortOrder: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ScheduleTemplateSlotSelect;

type TemplateSlotRecord = Prisma.ScheduleTemplateSlotGetPayload<{
  select: typeof templateSlotSelect;
}>;

const WEEKDAY_SEQUENCE: ScheduleWeekdayValue[] = [
  SCHEDULE_WEEKDAY.MONDAY,
  SCHEDULE_WEEKDAY.TUESDAY,
  SCHEDULE_WEEKDAY.WEDNESDAY,
  SCHEDULE_WEEKDAY.THURSDAY,
  SCHEDULE_WEEKDAY.FRIDAY,
  SCHEDULE_WEEKDAY.SATURDAY,
  SCHEDULE_WEEKDAY.SUNDAY,
];

const WEEKDAY_LABELS: Record<ScheduleWeekdayValue, string> = {
  [SCHEDULE_WEEKDAY.MONDAY]: 'Понедельник',
  [SCHEDULE_WEEKDAY.TUESDAY]: 'Вторник',
  [SCHEDULE_WEEKDAY.WEDNESDAY]: 'Среда',
  [SCHEDULE_WEEKDAY.THURSDAY]: 'Четверг',
  [SCHEDULE_WEEKDAY.FRIDAY]: 'Пятница',
  [SCHEDULE_WEEKDAY.SATURDAY]: 'Суббота',
  [SCHEDULE_WEEKDAY.SUNDAY]: 'Воскресенье',
};

const WEEKDAY_SHORT_LABELS: Record<ScheduleWeekdayValue, string> = {
  [SCHEDULE_WEEKDAY.MONDAY]: 'Пн',
  [SCHEDULE_WEEKDAY.TUESDAY]: 'Вт',
  [SCHEDULE_WEEKDAY.WEDNESDAY]: 'Ср',
  [SCHEDULE_WEEKDAY.THURSDAY]: 'Чт',
  [SCHEDULE_WEEKDAY.FRIDAY]: 'Пт',
  [SCHEDULE_WEEKDAY.SATURDAY]: 'Сб',
  [SCHEDULE_WEEKDAY.SUNDAY]: 'Вс',
};

const DEFAULT_TEMPLATE_SLOTS: Array<CreateTemplateSlotDto> = [
  {
    weekday: SCHEDULE_WEEKDAY.MONDAY,
    title: 'Детский теннис',
    startTime: '10:00',
    endTime: '11:00',
    ageBadge: '6+',
    sortOrder: 10,
  },
  {
    weekday: SCHEDULE_WEEKDAY.MONDAY,
    title: 'LEVEL - UP',
    startTime: '16:30',
    endTime: '17:30',
    ageBadge: '16+',
    secondaryBadge: 'Александр',
    sortOrder: 20,
  },
  {
    weekday: SCHEDULE_WEEKDAY.MONDAY,
    title: 'ООП',
    startTime: '17:00',
    endTime: '18:00',
    ageBadge: '4+',
    secondaryBadge: 'Детское',
    sortOrder: 30,
  },
  {
    weekday: SCHEDULE_WEEKDAY.MONDAY,
    title: 'Стретчинг',
    startTime: '17:00',
    endTime: '18:00',
    ageBadge: '16+',
    sortOrder: 40,
  },
  {
    weekday: SCHEDULE_WEEKDAY.MONDAY,
    title: 'Шейпинг',
    startTime: '18:00',
    endTime: '19:00',
    ageBadge: '16+',
    sortOrder: 50,
  },
  {
    weekday: SCHEDULE_WEEKDAY.MONDAY,
    title: 'Здоровая спина',
    startTime: '19:00',
    endTime: '20:00',
    ageBadge: '16+',
    sortOrder: 60,
  },
  {
    weekday: SCHEDULE_WEEKDAY.MONDAY,
    title: 'Худеем вместе',
    startTime: '20:00',
    endTime: '21:00',
    ageBadge: '16+',
    sortOrder: 70,
  },
  {
    weekday: SCHEDULE_WEEKDAY.WEDNESDAY,
    title: 'Детский теннис',
    startTime: '10:00',
    endTime: '11:00',
    ageBadge: '6+',
    sortOrder: 10,
  },
  {
    weekday: SCHEDULE_WEEKDAY.WEDNESDAY,
    title: 'ООП',
    startTime: '17:00',
    endTime: '18:00',
    ageBadge: '4+',
    secondaryBadge: 'Детское',
    sortOrder: 20,
  },
  {
    weekday: SCHEDULE_WEEKDAY.WEDNESDAY,
    title: 'Стретчинг',
    startTime: '17:00',
    endTime: '18:00',
    ageBadge: '16+',
    sortOrder: 30,
  },
  {
    weekday: SCHEDULE_WEEKDAY.WEDNESDAY,
    title: 'Шейпинг',
    startTime: '18:00',
    endTime: '19:00',
    ageBadge: '16+',
    sortOrder: 40,
  },
  {
    weekday: SCHEDULE_WEEKDAY.WEDNESDAY,
    title: 'Здоровая спина',
    startTime: '19:00',
    endTime: '20:00',
    ageBadge: '16+',
    sortOrder: 50,
  },
  {
    weekday: SCHEDULE_WEEKDAY.WEDNESDAY,
    title: 'Худеем вместе',
    startTime: '20:00',
    endTime: '21:00',
    ageBadge: '16+',
    sortOrder: 60,
  },
  {
    weekday: SCHEDULE_WEEKDAY.THURSDAY,
    title: 'Функциональная тренировка',
    startTime: '18:30',
    endTime: '19:30',
    ageBadge: '16+',
    secondaryBadge: 'Мария',
    sortOrder: 10,
  },
  {
    weekday: SCHEDULE_WEEKDAY.FRIDAY,
    title: 'Йога',
    startTime: '09:30',
    endTime: '10:30',
    ageBadge: '16+',
    sortOrder: 10,
  },
  {
    weekday: SCHEDULE_WEEKDAY.SATURDAY,
    title: 'Семейное плавание',
    startTime: '12:00',
    endTime: '13:00',
    ageBadge: '4+',
    secondaryBadge: 'Бассейн',
    sortOrder: 10,
  },
];

@Injectable()
export class ScheduleService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.seedInitialTemplate();
    } catch {
      // Database may be unavailable during bootstrap or tests.
    }
  }

  async listDays(from?: string) {
    const startDate = from ? parseDateOnly(from) : startOfDay(new Date());
    const dates = Array.from({ length: 7 }, (_, index) => addDays(startDate, index));
    const templateByWeekday = await this.getTemplateSlotsByWeekday();
    const todayKey = formatDateKey(startOfDay(new Date()));

    return dates.map((date) => {
      const weekday = getWeekday(date);
      const dateKey = formatDateKey(date);
      const hasClasses = this.resolveItemsForDate(date, templateByWeekday).length > 0;

      return {
        date: dateKey,
        weekday,
        shortLabel: WEEKDAY_SHORT_LABELS[weekday],
        label: WEEKDAY_LABELS[weekday],
        dayNumber: date.getDate(),
        monthLabel: formatMonthLabel(date),
        isToday: dateKey === todayKey,
        isSunday: weekday === SCHEDULE_WEEKDAY.SUNDAY,
        hasClasses,
      };
    });
  }

  async getDaySchedule(date?: string) {
    const targetDate = date ? parseDateOnly(date) : startOfDay(new Date());
    const targetKey = formatDateKey(targetDate);
    const weekday = getWeekday(targetDate);
    const templateByWeekday = await this.getTemplateSlotsByWeekday();
    const items = this.resolveItemsForDate(targetDate, templateByWeekday);

    return {
      date: targetKey,
      weekday,
      shortLabel: WEEKDAY_SHORT_LABELS[weekday],
      label: WEEKDAY_LABELS[weekday],
      isSunday: weekday === SCHEDULE_WEEKDAY.SUNDAY,
      isClosed: weekday === SCHEDULE_WEEKDAY.SUNDAY,
      items,
    };
  }

  async getAdminWorkspace(date?: string) {
    const selectedDate = date ? parseDateOnly(date) : startOfDay(new Date());
    const [templateSlots, tabs, resolvedDay] = await Promise.all([
      this.listTemplateSlots(),
      this.listDays(formatDateKey(selectedDate)),
      this.getDaySchedule(formatDateKey(selectedDate)),
    ]);

    return {
      selectedDate: formatDateKey(selectedDate),
      tabs,
      templateDays: WEEKDAY_SEQUENCE.map((weekday) => ({
        weekday,
        label: WEEKDAY_LABELS[weekday],
        shortLabel: WEEKDAY_SHORT_LABELS[weekday],
        slots: templateSlots.filter((slot) => slot.weekday === weekday),
      })),
      resolvedDay,
    };
  }

  async createTemplateSlot(dto: CreateTemplateSlotDto) {
    validateTimeRange(dto.startTime, dto.endTime);

    try {
      await this.prisma.scheduleTemplateSlot.create({
        data: {
          weekday: dto.weekday,
          ...normalizeSlotInput(dto),
        },
      });
    } catch (error) {
      handlePrismaError(error, 'Schedule template slot');
    }

    return this.getAdminWorkspace();
  }

  async updateTemplateSlot(slotId: string, dto: UpdateScheduleSlotDto) {
    const current = await this.prisma.scheduleTemplateSlot.findUnique({
      where: { id: slotId },
      select: templateSlotSelect,
    });

    if (!current) {
      throw new NotFoundException('Schedule template slot not found');
    }

    const nextStartTime = dto.startTime ?? current.startTime;
    const nextEndTime = dto.endTime ?? current.endTime;
    validateTimeRange(nextStartTime, nextEndTime);

    try {
      await this.prisma.scheduleTemplateSlot.update({
        where: { id: slotId },
        data: normalizeSlotUpdateInput(dto),
      });
    } catch (error) {
      handlePrismaError(error, 'Schedule template slot');
    }

    return this.getAdminWorkspace();
  }

  async deleteTemplateSlot(slotId: string) {
    await this.ensureTemplateSlotExists(slotId);
    await this.prisma.scheduleTemplateSlot.delete({
      where: { id: slotId },
    });

    return this.getAdminWorkspace();
  }

  private async seedInitialTemplate() {
    const count = await this.prisma.scheduleTemplateSlot.count();

    if (count > 0) {
      return;
    }

    await this.prisma.scheduleTemplateSlot.createMany({
      data: DEFAULT_TEMPLATE_SLOTS.map((slot) => ({
        weekday: slot.weekday,
        ...normalizeSlotInput(slot),
      })),
    });
  }

  private async listTemplateSlots(): Promise<TemplateSlotRecord[]> {
    return this.prisma.scheduleTemplateSlot.findMany({
      select: templateSlotSelect,
      orderBy: [
        { weekday: 'asc' },
        { sortOrder: 'asc' },
        { startTime: 'asc' },
        { createdAt: 'asc' },
      ],
    });
  }

  private async getTemplateSlotsByWeekday() {
    const slots = await this.prisma.scheduleTemplateSlot.findMany({
      where: { isActive: true },
      select: templateSlotSelect,
      orderBy: [{ sortOrder: 'asc' }, { startTime: 'asc' }, { createdAt: 'asc' }],
    });

    return slots.reduce((map, slot) => {
      const current = map.get(slot.weekday) ?? [];
      current.push(slot);
      map.set(slot.weekday as ScheduleWeekdayValue, current);
      return map;
    }, new Map<ScheduleWeekdayValue, TemplateSlotRecord[]>());
  }

  private resolveItemsForDate(
    date: Date,
    templateByWeekday: Map<ScheduleWeekdayValue, TemplateSlotRecord[]>,
  ) {
    const weekday = getWeekday(date);

    if (weekday === SCHEDULE_WEEKDAY.SUNDAY) {
      return [];
    }

    return (templateByWeekday.get(weekday) ?? []).map((slot) => ({
      id: slot.id,
      title: slot.title,
      startTime: slot.startTime,
      endTime: slot.endTime,
      ageBadge: slot.ageBadge,
      secondaryBadge: slot.secondaryBadge,
      sortOrder: slot.sortOrder,
    }));
  }

  private async ensureTemplateSlotExists(slotId: string) {
    const slot = await this.prisma.scheduleTemplateSlot.findUnique({
      where: { id: slotId },
      select: { id: true },
    });

    if (!slot) {
      throw new NotFoundException('Schedule template slot not found');
    }
  }
}

function normalizeSlotInput(slot: CreateScheduleSlotDto) {
  return {
    title: slot.title.trim(),
    startTime: slot.startTime,
    endTime: slot.endTime,
    ageBadge: slot.ageBadge?.trim() || null,
    secondaryBadge: slot.secondaryBadge?.trim() || null,
    sortOrder: slot.sortOrder ?? 0,
    isActive: slot.isActive ?? true,
  };
}

function normalizeSlotUpdateInput(slot: UpdateScheduleSlotDto) {
  return {
    weekday: slot.weekday,
    title: slot.title?.trim(),
    startTime: slot.startTime,
    endTime: slot.endTime,
    ageBadge: slot.ageBadge !== undefined ? slot.ageBadge.trim() || null : undefined,
    secondaryBadge:
      slot.secondaryBadge !== undefined ? slot.secondaryBadge.trim() || null : undefined,
    sortOrder: slot.sortOrder,
    isActive: slot.isActive,
  };
}

function validateTimeRange(startTime: string, endTime: string) {
  if (startTime >= endTime) {
    throw new BadRequestException('endTime must be later than startTime');
  }
}

function parseDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new BadRequestException('Date must match YYYY-MM-DD');
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('Invalid date');
  }

  return date;
}

function formatDateKey(date: Date) {
  return startOfDay(date).toISOString().slice(0, 10);
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function getWeekday(date: Date): ScheduleWeekdayValue {
  const day = date.getUTCDay();
  return (
    {
      0: SCHEDULE_WEEKDAY.SUNDAY,
      1: SCHEDULE_WEEKDAY.MONDAY,
      2: SCHEDULE_WEEKDAY.TUESDAY,
      3: SCHEDULE_WEEKDAY.WEDNESDAY,
      4: SCHEDULE_WEEKDAY.THURSDAY,
      5: SCHEDULE_WEEKDAY.FRIDAY,
      6: SCHEDULE_WEEKDAY.SATURDAY,
    }[day] ?? SCHEDULE_WEEKDAY.MONDAY
  );
}

function formatMonthLabel(date: Date) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
  }).format(date);
}
