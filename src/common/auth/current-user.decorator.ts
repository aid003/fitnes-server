import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { SessionUser } from './session-user.interface';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionUser | null => {
    const request = context
      .switchToHttp()
      .getRequest<{ session?: { auth?: SessionUser } }>();

    return request.session?.auth ?? null;
  },
);
