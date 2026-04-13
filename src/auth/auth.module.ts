import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthenticatedGuard } from '../common/auth/authenticated.guard';
import { RolesGuard } from '../common/auth/roles.guard';
import { PasswordService } from '../common/security/password.service';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RememberSessionService } from './session/remember-session.service';
import { SessionService } from './session/session.service';

@Module({
  imports: [ConfigModule, UsersModule, MailModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    RememberSessionService,
    PasswordService,
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    AuthenticatedGuard,
  ],
  exports: [SessionService, AuthenticatedGuard],
})
export class AuthModule {}
