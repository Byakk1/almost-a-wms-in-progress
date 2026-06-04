import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ok } from '../common/api-response';
import { ProductsService } from './products.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { BulkImportDto } from './dto/bulk-import.dto';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Get()
  async list(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('sku') sku?: string,
    @Query('name') name?: string,
    @Query('customerId') customerId?: string,
    @Query('brand') brand?: string,
    @Query('isHazardous') isHazardous?: string,
  ) {
    const result = await this.productsService.list({
      page,
      pageSize,
      sku,
      name,
      customerId,
      brand,
      isHazardous: isHazardous === 'true' ? true : isHazardous === 'false' ? false : undefined,
    });
    return ok(result.data, result.pagination);
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post()
  async create(@Body() body: CreateProductDto) {
    return ok(await this.productsService.create(body));
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Get(':id')
  async detail(@Param('id') id: string) {
    return ok(await this.productsService.detail(id));
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: UpdateProductDto) {
    return ok(await this.productsService.update(id, body));
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return ok(await this.productsService.remove(id));
  }

  /** Bulk import — accepts pre-parsed JSON (used by API clients / tests). */
  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post('bulk-import')
  async bulkImport(@Body() body: BulkImportDto) {
    const result = await this.productsService.bulkImport(body.customerId, body.items);
    return ok(result);
  }

  /** Bulk import — accepts the raw 海外仓商品库上传模板V2 .xlsx file. */
  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post('bulk-import-excel')
  @UseInterceptors(FileInterceptor('file'))
  async bulkImportExcel(
    @UploadedFile() file: Express.Multer.File,
    @Body('customerId') customerId: string,
  ) {
    const result = await this.productsService.bulkImportExcel(customerId, file);
    return ok(result);
  }
}
