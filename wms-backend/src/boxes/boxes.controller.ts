import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ok } from '../common/api-response';
import { BoxesService } from './boxes.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateBoxDto } from './dto/create-box.dto';
import { MeasureBoxDto } from './dto/measure-box.dto';
import { SignOutBoxesDto } from './dto/sign-out-boxes.dto';

// Global prefix 'api/v1' is applied in main.ts — keep the path bare here, or the
// route doubles up (the ExceptionCase controller shipped that bug once already).
@Controller('boxes')
export class BoxesController {
  constructor(private readonly svc: BoxesService) {}

  // ─── List ───────────────────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Get()
  async list(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('status') status?: string,
    @Query('boxNo') boxNo?: string,
    @Query('transitOrderId') transitOrderId?: string,
  ) {
    const result = await this.svc.list({ page, pageSize, status, boxNo, transitOrderId });
    return ok(result.data, result.pagination);
  }

  // ─── Create (打包建箱) ───────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post()
  async create(@Body() body: CreateBoxDto) {
    return ok(await this.svc.create(body));
  }

  // ─── Sign out (按单签出) ────────────────────────────────────────────
  // Declared before the parameterised route so 'sign-out' is never read as a boxNo.

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post('sign-out')
  async signOut(@Body() body: SignOutBoxesDto) {
    return ok(await this.svc.signOut(body));
  }

  // ─── Measure (箱子测量) ─────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Put(':boxNo/measure')
  async measure(@Param('boxNo') boxNo: string, @Body() body: MeasureBoxDto) {
    return ok(await this.svc.measure(boxNo, body));
  }
}
