import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RequestPasswordRecoveryDto } from './dto/request-password-recovery.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendRegisterCodeDto } from './dto/resend-register-code.dto';
import { ResetPasswordRecoveryDto } from './dto/reset-password-recovery.dto';
import { VerifyRegisterDto } from './dto/verify-register.dto';
import { VerifyPasswordRecoveryDto } from './dto/verify-password-recovery.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.OK)
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('register/verify')
  @HttpCode(HttpStatus.OK)
  verifyRegister(
    @Body() dto: VerifyRegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.verifyRegister(dto, request, response);
  }

  @Post('register/resend')
  @HttpCode(HttpStatus.OK)
  resendRegisterCode(@Body() dto: ResendRegisterCodeDto) {
    return this.authService.resendRegisterCode(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.login(dto, request, response);
  }

  @Post('recovery/request')
  @HttpCode(HttpStatus.OK)
  requestPasswordRecovery(@Body() dto: RequestPasswordRecoveryDto) {
    return this.authService.requestPasswordRecovery(dto);
  }

  @Post('recovery/resend')
  @HttpCode(HttpStatus.OK)
  resendPasswordRecovery(@Body() dto: RequestPasswordRecoveryDto) {
    return this.authService.resendPasswordRecovery(dto);
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
    this.authService.clearAuthCookies(response);

    return result;
  }

  @Get('me')
  me(@Req() request: Request) {
    return this.authService.getMeFromSession(request);
  }

  @Post('refresh-session')
  @HttpCode(HttpStatus.OK)
  refreshSession(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.refreshSession(request, response);
  }
}
