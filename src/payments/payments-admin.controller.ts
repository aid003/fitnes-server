import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthenticatedGuard } from '../common/auth/authenticated.guard';
import { Roles } from '../common/auth/roles.decorator';
import { PaymentsService } from './payments.service';

@Controller('admin/payments')
@UseGuards(AuthenticatedGuard)
@Roles(UserRole.ADMIN)
export class PaymentsAdminController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('overview')
  getOverview(@Query('range') range?: string) {
    return this.paymentsService.getAdminPaymentsOverview(range);
  }

  @Get('ledger')
  getLedger(
    @Query('range') range?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.paymentsService.getAdminPaymentsLedger({
      range,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
