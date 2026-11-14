import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Liveness/readiness da aplicação' })
  @ApiOkResponse({ schema: { example: { status: 'ok' } } })
  health(): { status: string } {
    return { status: 'ok' };
  }
}
