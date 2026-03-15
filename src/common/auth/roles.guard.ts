import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@prisma/client';
import { UsersService } from '../../users/users.service';
import { ROLES_KEY } from './roles.decorator';
import type { SessionUser } from './session-user.interface';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!roles || roles.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{
        session?: {
          auth?: SessionUser;
          save: (callback: (error?: Error) => void) => void;
        };
      }>();

    const session = request.session;
    const auth = session?.auth;

    if (!auth?.userId) {
      throw new UnauthorizedException('Authentication required');
    }

    const currentUser = await this.usersService.getAuthState(auth.userId);

    if (!currentUser.isActive) {
      throw new ForbiddenException('User is deactivated');
    }

    if (auth.role !== currentUser.role) {
      if (!session) {
        throw new UnauthorizedException('Authentication required');
      }

      session.auth = {
        userId: auth.userId,
        role: currentUser.role,
      };
      await saveSession(session);
    }

    if (!roles.includes(currentUser.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}

function saveSession(session: {
  save: (callback: (error?: Error) => void) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    session.save((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
