import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { BatteryDto } from './dto/battery.dto';

interface ListProductsQuery {
  page?: number;
  pageSize?: number;
  sku?: string;
  name?: string;
  customerId?: string;
  brand?: string;
  isHazardous?: boolean;
}

/** Battery-config values that imply a battery is present. */
const BATTERY_PRESENT = new Set(['内置电池', '配套电池', '纯电池', 'BUILT_IN', 'INCLUDED', 'PURE']);

/** Battery types that require capacity (mAh) + voltage (V). */
const CAPACITY_VOLTAGE_TYPES = new Set([
  '纽扣电池',
  '锂电池(锂离子电池)',
  '铅酸电池',
  '其他',
  '其它',
]);

/** Battery type that requires lithium content (g). */
const LITHIUM_METAL_TYPES = new Set(['锂电池(锂金属电池)']);

/** Excel header (Chinese, exact from template) → DTO field. */
const EXCEL_HEADER_MAP: Record<string, string> = {
  'SKU 编码': 'sku',
  'SKU编码': 'sku',
  '条形码编号': 'barcode',
  '品名(中文)': 'nameZh',
  '品名(英文)': 'nameEn',
  '原产国(二字码)': 'originCountry',
  'HS Code': 'hsCode',
  '预估重量（单个SKU）': 'weight',
  '预估重量单位': 'weightUnit',
  '预估长度（单个SKU）': 'length',
  '预估宽度（单个SKU）': 'width',
  '预估高度（单个SKU）': 'height',
  '预估尺寸单位': 'dimensionUnit',
  '申报价值': 'declaredValue',
  '申报单价': 'declaredValue',
  '实际价值': 'actualValue',
  '币种(三字码)': 'currency',
  '自带物流包装': 'hasShippingBag',
  '品牌': 'brand',
  '供应商': 'supplier',
  '型号': 'model',
  '材质': 'material',
  '用途': 'usage',
  '组合类型': 'itemType',
  '物流包装属性': 'packagingAttr',
  '电池配置': 'batteryConfig',
  '其他属性': 'otherAttrs',
  '危险品': 'isHazardous',
  '危险代码': 'hazardCode',
  'Prop65': 'prop65',
  '食品': 'isFood',
  '冷藏': 'isRefrigerated',
  '序列号': 'hasSerialNumber',
  '批次管理': 'isLotControlled',
  '备注': 'remark',
  '商品链接': 'salesUrl',
  '销售链接': 'salesUrl',
  '目录': 'catalogue',
  '关联海外仓仓库代码': 'warehouseCodes',
  '单位': 'unit',
  // ── battery sub-fields ──
  '单个电池安时额定值(mAh)': 'battery.capacityMah',
  '商品携带标签': 'battery.carryingLabel',
  '电池芯/电池组': 'battery.cellOrPack',
  '电池其他属性': 'battery.otherDesc',
  '其他电池属性': 'battery.otherDesc',
  '单个电池锂含量(g)': 'battery.lithiumContentG',
  '电池型号': 'battery.batteryModel',
  '电池包装材质': 'battery.packageMaterial',
  '电池包装': 'battery.packaging',
  '电池数量（个数）': 'battery.quantity',
  '电池类型': 'battery.batteryType',
  '单个电池重量(g)': 'battery.weightGrams',
  'UN编码': 'battery.unCode',
  '单个电池额定电压(V)': 'battery.voltageV',
  '电池充电状态': 'battery.chargeStatus',
  'MSDS报告证书链接列表': 'battery.msdsFileList',
};

const NUMERIC_FIELDS = new Set([
  'weight',
  'length',
  'width',
  'height',
  'declaredValue',
  'actualValue',
]);

const BATTERY_NUMERIC = new Set([
  'capacityMah',
  'lithiumContentG',
  'quantity',
  'weightGrams',
  'voltageV',
]);

const BOOLEAN_FIELDS = new Set([
  'hasShippingBag',
  'isHazardous',
  'prop65',
  'isFood',
  'isRefrigerated',
  'hasSerialNumber',
  'isLotControlled',
]);

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── List / Detail ───────────────────────────────
  async list(query: ListProductsQuery) {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 20);

    const where: any = {};
    if (query.sku) where.sku = { contains: query.sku, mode: 'insensitive' };
    if (query.name) {
      where.OR = [
        { name: { contains: query.name, mode: 'insensitive' } },
        { nameZh: { contains: query.name, mode: 'insensitive' } },
        { nameEn: { contains: query.name, mode: 'insensitive' } },
      ];
    }
    if (query.customerId) where.customerId = query.customerId;
    if (query.brand) where.brand = { contains: query.brand, mode: 'insensitive' };
    if (query.isHazardous !== undefined) where.isHazardous = query.isHazardous;

    const [total, rows] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: { customer: true, battery: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      data: rows.map((row) => this.mapProduct(row)),
      pagination: { page, pageSize, total },
    };
  }

  async detail(id: string) {
    const row = await this.prisma.product.findUnique({
      where: { id },
      include: { customer: true, battery: true },
    });
    if (!row) throw new NotFoundException('产品不存在');
    return this.mapProduct(row);
  }

  // ─── Create ──────────────────────────────────────
  async create(body: CreateProductDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: body.customerId },
    });
    if (!customer) throw new NotFoundException('客户不存在');

    this.validateBusinessRules(body);

    const { battery, customerName: _customerName, ...productData } = body;

    const row = await this.prisma.product.create({
      data: {
        sku: productData.sku,
        name: productData.name || productData.nameZh || productData.nameEn || productData.sku,
        nameZh: productData.nameZh,
        nameEn: productData.nameEn,
        customerId: productData.customerId,
        barcode: productData.barcode,
        unit: productData.unit ?? 'pcs',
        weight: productData.weight,
        weightUnit: productData.weightUnit ?? 'kg',
        length: productData.length,
        width: productData.width,
        height: productData.height,
        dimensionUnit: productData.dimensionUnit ?? 'cm',
        hsCode: productData.hsCode,
        originCountry: productData.originCountry?.toUpperCase(),
        declaredValue: productData.declaredValue,
        actualValue: productData.actualValue,
        currency: (productData.currency ?? 'USD').toUpperCase(),
        material: productData.material,
        usage: productData.usage,
        brand: productData.brand,
        supplier: productData.supplier,
        model: productData.model,
        itemType: productData.itemType,
        hasShippingBag: productData.hasShippingBag ?? false,
        packagingAttr: productData.packagingAttr,
        salesUrl: productData.salesUrl,
        catalogue: productData.catalogue,
        warehouseCodes: productData.warehouseCodes,
        remark: productData.remark,
        imageUrl: productData.imageUrl,
        batteryConfig: productData.batteryConfig,
        otherAttrs: productData.otherAttrs,
        isHazardous: productData.isHazardous ?? false,
        hazardCode: productData.hazardCode,
        prop65: productData.prop65 ?? false,
        isFood: productData.isFood ?? false,
        isRefrigerated: productData.isRefrigerated ?? false,
        hasSerialNumber: productData.hasSerialNumber ?? false,
        isLotControlled: productData.isLotControlled ?? false,
        ...(battery
          ? { battery: { create: this.cleanBattery(battery) } }
          : {}),
      },
      include: { customer: true, battery: true },
    });

    return this.mapProduct(row);
  }

  // ─── Update ──────────────────────────────────────
  async update(id: string, body: UpdateProductDto) {
    const exists = await this.prisma.product.findUnique({
      where: { id },
      include: { battery: true },
    });
    if (!exists) throw new NotFoundException('产品不存在');

    if (body.customerId) {
      const customer = await this.prisma.customer.findUnique({ where: { id: body.customerId } });
      if (!customer) throw new NotFoundException('客户不存在');
    }

    // Run conditional validation against the merged result so partial updates are coherent.
    const merged: any = { ...exists, ...body };
    this.validateBusinessRules(merged);

    const { battery, customerName: _customerName, ...fields } = body;

    const data: any = {};
    for (const [key, val] of Object.entries(fields)) {
      if (val !== undefined) data[key] = val;
    }
    if (data.originCountry) data.originCountry = String(data.originCountry).toUpperCase();
    if (data.currency) data.currency = String(data.currency).toUpperCase();

    if (battery !== undefined) {
      const cleaned = this.cleanBattery(battery);
      if (exists.battery) {
        await this.prisma.productBattery.update({
          where: { productId: id },
          data: cleaned,
        });
      } else {
        await this.prisma.productBattery.create({
          data: { productId: id, ...cleaned },
        });
      }
    }

    const row = await this.prisma.product.update({
      where: { id },
      data,
      include: { customer: true, battery: true },
    });

    return this.mapProduct(row);
  }

  async remove(id: string) {
    const exists = await this.prisma.product.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('产品不存在');
    await this.prisma.product.delete({ where: { id } });
    return true;
  }

  // ─── Bulk Import (JSON) ──────────────────────────
  async bulkImport(
    customerId: string,
    items: CreateProductDto[],
  ): Promise<{ created: number; updated: number; errors: string[] }> {
    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const item of items) {
      try {
        const existing = await this.prisma.product.findUnique({ where: { sku: item.sku } });
        if (existing) {
          await this.update(existing.id, { ...item, customerId });
          updated++;
        } else {
          await this.create({ ...item, customerId });
          created++;
        }
      } catch (err: any) {
        errors.push(`SKU [${item.sku}]: ${err.message}`);
      }
    }

    return { created, updated, errors };
  }

  // ─── Bulk Import (Excel file) ────────────────────
  async bulkImportExcel(
    customerId: string,
    file: Express.Multer.File,
  ): Promise<{ created: number; updated: number; errors: string[] }> {
    if (!file) throw new BadRequestException('请上传 Excel 文件');
    if (!customerId) throw new BadRequestException('customerId 不能为空');

    const items = this.parseTemplateXlsx(file.buffer);
    return this.bulkImport(customerId, items);
  }

  /** Parse 海外仓商品库上传模板V2.xlsx into typed CreateProductDto rows. */
  private parseTemplateXlsx(buffer: Buffer): CreateProductDto[] {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames.find((n) => n.includes('上传') || n.includes('模板')) ?? wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (rows.length < 2) return [];

    const headers = (rows[0] as string[]).map((h) =>
      String(h ?? '')
        .replace(/^\*/, '')
        .replace(/\s+/g, ' ')
        .trim(),
    );

    const result: CreateProductDto[] = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every((v) => v === null || v === undefined || v === '')) continue;

      const item: any = { battery: {} };
      headers.forEach((header, idx) => {
        const target = EXCEL_HEADER_MAP[header];
        if (!target) return;
        const raw = row[idx];
        if (raw === null || raw === undefined || raw === '') return;

        const [head, sub] = target.split('.');
        if (head === 'battery') {
          item.battery[sub] = this.coerceCell(sub, raw);
        } else {
          item[target] = this.coerceCell(target, raw);
        }
      });

      if (Object.keys(item.battery).length === 0) delete item.battery;
      if (item.sku) result.push(item as CreateProductDto);
    }

    return result;
  }

  private coerceCell(field: string, value: any): any {
    if (NUMERIC_FIELDS.has(field) || BATTERY_NUMERIC.has(field)) {
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    }
    if (BOOLEAN_FIELDS.has(field)) {
      const s = String(value).trim().toLowerCase();
      return ['是', 'y', 'yes', 'true', '1'].includes(s);
    }
    return String(value).trim();
  }

  // ─── Conditional rules (template enforces these) ─
  private validateBusinessRules(p: Partial<CreateProductDto>) {
    if (p.isHazardous === true && !p.hazardCode) {
      throw new BadRequestException('危险品 时 危险代码 必填');
    }

    const cfg = p.batteryConfig?.trim();
    const batteryPresent = !!cfg && BATTERY_PRESENT.has(cfg);
    const b = p.battery;

    if (batteryPresent) {
      if (!b) {
        throw new BadRequestException(`电池配置=${cfg} 时必须填写电池信息`);
      }
      const required: Array<[keyof BatteryDto, string]> = [
        ['batteryType', '电池类型'],
        ['cellOrPack', '电池芯/电池组'],
        ['batteryModel', '电池型号'],
        ['chargeStatus', '电池充电状态'],
        ['packageMaterial', '电池包装材质'],
        ['packaging', '电池包装'],
        ['unCode', 'UN编码'],
        ['weightGrams', '单个电池重量(g)'],
      ];
      for (const [key, label] of required) {
        if (b[key] === undefined || b[key] === null || b[key] === '') {
          throw new BadRequestException(`${label} 必填（电池配置=${cfg}）`);
        }
      }

      const t = b.batteryType?.trim();
      if (t && CAPACITY_VOLTAGE_TYPES.has(t)) {
        if (b.capacityMah == null) {
          throw new BadRequestException(`电池类型=${t} 时 单个电池安时额定值(mAh) 必填`);
        }
        if (b.voltageV == null) {
          throw new BadRequestException(`电池类型=${t} 时 单个电池额定电压(V) 必填`);
        }
      }
      if (t && LITHIUM_METAL_TYPES.has(t) && b.lithiumContentG == null) {
        throw new BadRequestException(`电池类型=${t} 时 单个电池锂含量(g) 必填`);
      }
    }
  }

  private cleanBattery(b: BatteryDto): any {
    const out: any = {};
    for (const [k, v] of Object.entries(b)) {
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  // ─── Mapper ──────────────────────────────────────
  private mapProduct(row: any) {
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      nameZh: row.nameZh,
      nameEn: row.nameEn,
      customerId: row.customerId,
      customerName: row.customer?.name,
      barcode: row.barcode,
      unit: row.unit,
      weight: row.weight,
      weightUnit: row.weightUnit,
      length: row.length,
      width: row.width,
      height: row.height,
      dimensionUnit: row.dimensionUnit,
      hsCode: row.hsCode,
      originCountry: row.originCountry,
      declaredValue: row.declaredValue,
      actualValue: row.actualValue,
      currency: row.currency,
      material: row.material,
      usage: row.usage,
      brand: row.brand,
      supplier: row.supplier,
      model: row.model,
      itemType: row.itemType,
      hasShippingBag: row.hasShippingBag,
      packagingAttr: row.packagingAttr,
      salesUrl: row.salesUrl,
      catalogue: row.catalogue,
      warehouseCodes: row.warehouseCodes,
      remark: row.remark,
      imageUrl: row.imageUrl,
      batteryConfig: row.batteryConfig,
      otherAttrs: row.otherAttrs,
      isHazardous: row.isHazardous,
      hazardCode: row.hazardCode,
      prop65: row.prop65,
      isFood: row.isFood,
      isRefrigerated: row.isRefrigerated,
      hasSerialNumber: row.hasSerialNumber,
      isLotControlled: row.isLotControlled,
      battery: row.battery || null,
      createdAt: this.formatDate(row.createdAt),
      updatedAt: this.formatDate(row.updatedAt),
    };
  }

  private formatDate(date: Date) {
    const iso = date.toISOString();
    return iso.slice(0, 19).replace('T', ' ');
  }
}
