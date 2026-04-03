import { Body, Controller, Header, Post } from '@nestjs/common';
import { PaymentsService } from './payments.service';

@Controller('payments/webhooks')
export class PaymentsWebhookController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('tbank')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async handleTBankWebhook(@Body() body: Record<string, unknown>) {
    return this.paymentsService.handleTBankWebhook(body);
  }
}
