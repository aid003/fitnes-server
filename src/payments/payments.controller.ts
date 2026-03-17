import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthenticatedGuard } from '../common/auth/authenticated.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { SessionUser } from '../common/auth/session-user.interface';
import { PaymentsService } from './payments.service';

@Controller('payments')
@UseGuards(AuthenticatedGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('passes/:planId')
  createPassPayment(
    @CurrentUser() currentUser: SessionUser,
    @Param('planId') planId: string,
  ) {
    return this.paymentsService.createPassPayment(currentUser.userId, planId);
  }

  @Get(':paymentId')
  getPayment(
    @CurrentUser() currentUser: SessionUser,
    @Param('paymentId') paymentId: string,
  ) {
    return this.paymentsService.getPaymentStatus(currentUser.userId, paymentId);
  }

  @Post(':paymentId/confirm')
  confirmPayment(
    @CurrentUser() currentUser: SessionUser,
    @Param('paymentId') paymentId: string,
  ) {
    return this.paymentsService.confirmPayment(currentUser.userId, paymentId);
  }
}
