import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { SessionUser } from './session-user.interface';

@Injectable()
export class AuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ session?: { auth?: SessionUser } }>();

    if (!request.session?.auth) {
      throw new UnauthorizedException('Authentication required');
    }

    return true;
  }
}
