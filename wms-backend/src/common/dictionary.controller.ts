import { Controller, Get, Post, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { DictionaryService } from './dictionary.service';
import { ok } from './api-response';
import { Roles } from './decorators/roles.decorator';

@Controller('dictionaries')
export class DictionaryController {
  constructor(private readonly dictService: DictionaryService) {}

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN')
  @Post()
  async create(
    @Body()
    body: {
      category: string;
      code: string;
      label: string;
      labelEn?: string;
      sortOrder?: number;
      parentCode?: string;
      extra?: string;
    },
  ) {
    const result = await this.dictService.create(body);
    return ok(result);
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN')
  @Post('bulk')
  async bulkCreate(
    @Body()
    body: {
      items: {
        category: string;
        code: string;
        label: string;
        labelEn?: string;
        sortOrder?: number;
        parentCode?: string;
        extra?: string;
      }[];
    },
  ) {
    const result = await this.dictService.bulkCreate(body.items);
    return ok(result);
  }

  @Get('categories')
  async listCategories() {
    const result = await this.dictService.listCategories();
    return ok(result);
  }

  @Get('by-category/:category')
  async listByCategory(@Param('category') category: string) {
    const result = await this.dictService.listByCategory(category);
    return ok(result);
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN')
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      label?: string;
      labelEn?: string;
      sortOrder?: number;
      isActive?: boolean;
      parentCode?: string;
      extra?: string;
    },
  ) {
    const result = await this.dictService.update(id, body);
    return ok(result);
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    const result = await this.dictService.remove(id);
    return ok(result);
  }
}
