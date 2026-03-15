import type { UserRole } from '@prisma/client';

export interface SessionUser {
  userId: string;
  role: UserRole;
}
