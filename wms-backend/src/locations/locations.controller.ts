import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ok } from '../common/api-response';
import { LocationsService } from './locations.service';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Get()
  async list(
    @Query('floor') floor?: number,
    @Query('status') status?: 'EMPTY' | 'OCCUPIED' | 'RESERVED' | 'DISABLED',
    @Query('warehouseId') warehouseId?: string,
  ) {
    return ok(await this.locationsService.list({ floor, status, warehouseId }));
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN')
  @Post()
  async create(
    @Body()
    body: {
      code: string;
      warehouseId: string;
      zone?: string;
      row: string;
      col: number;
      floor?: number;
      status?: 'EMPTY' | 'OCCUPIED' | 'RESERVED' | 'DISABLED';
    },
  ) {
    return ok(await this.locationsService.create(body));
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN')
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body()
    body: Partial<{
      code: string;
      zone: string;
      row: string;
      col: number;
      floor: number;
      status: 'EMPTY' | 'OCCUPIED' | 'RESERVED' | 'DISABLED';
    }>,
  ) {
    return ok(await this.locationsService.update(id, body));
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return ok(await this.locationsService.remove(id));
  }
}