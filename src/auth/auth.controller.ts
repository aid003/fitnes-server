import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { AuthenticatedGuard } from '../common/auth/authenticated.guard';
import type { SessionUser } from '../common/auth/session-user.interface';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RequestPasswordRecoveryDto } from './dto/request-password-recovery.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordRecoveryDto } from './dto/reset-password-recovery.dto';
import { VerifyPasswordRecoveryDto } from './dto/verify-password-recovery.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto, @Req() request: Request) {
    return this.authService.register(dto, request);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() request: Request) {
    return this.authService.login(dto, request);
  }

  @Post('recovery/request')
  @HttpCode(HttpStatus.OK)
  requestPasswordRecovery(@Body() dto: RequestPasswordRecoveryDto) {
    return this.authService.requestPasswordRecovery(dto);
  }

  @Post('recovery/verify')
  @HttpCode(HttpStatus.OK)
  verifyPasswordRecovery(@Body() dto: VerifyPasswordRecoveryDto) {
    return this.authService.verifyPasswordRecovery(dto);
  }

  @Post('recovery/reset')
  @HttpCode(HttpStatus.OK)
  resetPasswordRecovery(@Body() dto: ResetPasswordRecoveryDto) {
    return this.authService.resetPasswordRecovery(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.logout(request);
    response.clearCookie('sid');

    return result;
  }

  @Get('me')
  @UseGuards(AuthenticatedGuard)
  me(@CurrentUser() currentUser: SessionUser) {
    return this.authService.getMe(currentUser.userId);
  }
}
