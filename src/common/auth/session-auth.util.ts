import type { UserRole } from '@prisma/client';
import type { Request } from 'express';

export function setAuthenticatedSession(
  request: Request,
  user: { id: string; role: UserRole },
): Promise<void> {
  request.session.auth = {
    userId: user.id,
    role: user.role,
  };

  return new Promise((resolve, reject) => {
    request.session.save((error) => {
      if (error) {
        reject(
          error instanceof Error ? error : new Error('Failed to save session'),
        );
        return;
      }

      resolve();
    });
  });
}
