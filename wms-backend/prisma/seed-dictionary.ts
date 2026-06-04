/**
 * Dictionary seed for product upload template (海外仓商品库上传模板V2).
 *
 * Run with:
 *   npx ts-node prisma/seed-dictionary.ts
 *
 * Idempotent — uses upsert on (category, code).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

type Item = {
  category: string;
  code: string;
  label: string;
  labelEn?: string;
  sortOrder?: number;
};

const items: Item[] = [
  // ── 电池配置 (BATTERY_CONFIG) ──
  { category: 'BATTERY_CONFIG', code: 'NONE', label: '不含电池', labelEn: 'No Battery', sortOrder: 1 },
  { category: 'BATTERY_CONFIG', code: 'BUILT_IN', label: '内置电池', labelEn: 'Built-in', sortOrder: 2 },
  { category: 'BATTERY_CONFIG', code: 'INCLUDED', label: '配套电池', labelEn: 'Included', sortOrder: 3 },
  { category: 'BATTERY_CONFIG', code: 'PURE', label: '纯电池', labelEn: 'Pure Battery', sortOrder: 4 },

  // ── 电池类型 (BATTERY_TYPE) ──
  { category: 'BATTERY_TYPE', code: 'LI_ION', label: '锂电池(锂离子电池)', labelEn: 'Lithium-ion', sortOrder: 1 },
  { category: 'BATTERY_TYPE', code: 'LI_METAL', label: '锂电池(锂金属电池)', labelEn: 'Lithium Metal', sortOrder: 2 },
  { category: 'BATTERY_TYPE', code: 'BUTTON', label: '纽扣电池', labelEn: 'Button Cell', sortOrder: 3 },
  { category: 'BATTERY_TYPE', code: 'LEAD_ACID', label: '铅酸电池', labelEn: 'Lead-acid', sortOrder: 4 },
  { category: 'BATTERY_TYPE', code: 'DRY', label: '干电池', labelEn: 'Dry Cell', sortOrder: 5 },
  { category: 'BATTERY_TYPE', code: 'NIMH', label: '镍氢电池', labelEn: 'Ni-MH', sortOrder: 6 },
  { category: 'BATTERY_TYPE', code: 'OTHER', label: '其他', labelEn: 'Other', sortOrder: 7 },

  // ── 电池芯/电池组 (CELL_OR_PACK) ──
  { category: 'CELL_OR_PACK', code: 'CELL', label: '电池芯', labelEn: 'Cell', sortOrder: 1 },
  { category: 'CELL_OR_PACK', code: 'PACK', label: '电池组', labelEn: 'Pack', sortOrder: 2 },

  // ── 电池充电状态 (CHARGE_STATUS) ──
  { category: 'CHARGE_STATUS', code: 'UNDER_30', label: '电量低于30%', labelEn: '< 30%', sortOrder: 1 },
  { category: 'CHARGE_STATUS', code: 'OVER_30', label: '电量高于30%', labelEn: '>= 30%', sortOrder: 2 },

  // ── 电池包装材质 (PACKAGE_MATERIAL) ──
  { category: 'PACKAGE_MATERIAL', code: 'CARTON', label: '纸箱', labelEn: 'Carton', sortOrder: 1 },
  { category: 'PACKAGE_MATERIAL', code: 'PLASTIC', label: '塑料', labelEn: 'Plastic', sortOrder: 2 },
  { category: 'PACKAGE_MATERIAL', code: 'METAL', label: '金属', labelEn: 'Metal', sortOrder: 3 },
  { category: 'PACKAGE_MATERIAL', code: 'OTHER', label: '其他', labelEn: 'Other', sortOrder: 4 },

  // ── 电池包装 (PACKAGING) ──
  { category: 'PACKAGING', code: 'WITH_DEVICE', label: '与设备一同包装', labelEn: 'With device', sortOrder: 1 },
  { category: 'PACKAGING', code: 'INSTALLED', label: '安装在设备内', labelEn: 'Installed in device', sortOrder: 2 },
  { category: 'PACKAGING', code: 'STANDALONE', label: '独立包装', labelEn: 'Standalone', sortOrder: 3 },

  // ── 商品携带标签 (CARRYING_LABEL) ──
  { category: 'CARRYING_LABEL', code: 'UN3480', label: 'UN3480', sortOrder: 1 },
  { category: 'CARRYING_LABEL', code: 'UN3481', label: 'UN3481', sortOrder: 2 },
  { category: 'CARRYING_LABEL', code: 'UN3090', label: 'UN3090', sortOrder: 3 },
  { category: 'CARRYING_LABEL', code: 'UN3091', label: 'UN3091', sortOrder: 4 },
  { category: 'CARRYING_LABEL', code: 'NONE', label: '无', labelEn: 'None', sortOrder: 5 },

  // ── 组合类型 (ITEM_TYPE) ──
  { category: 'ITEM_TYPE', code: 'SINGLE', label: '单品', labelEn: 'Single', sortOrder: 1 },
  { category: 'ITEM_TYPE', code: 'BUNDLE', label: '组合', labelEn: 'Bundle', sortOrder: 2 },
  { category: 'ITEM_TYPE', code: 'SET', label: '套装', labelEn: 'Set', sortOrder: 3 },

  // ── 目录 (CATALOGUE) ──
  { category: 'CATALOGUE', code: 'GENERAL', label: '一般货物', labelEn: 'General', sortOrder: 1 },
  { category: 'CATALOGUE', code: 'ELECTRONICS', label: '电子产品', labelEn: 'Electronics', sortOrder: 2 },
  { category: 'CATALOGUE', code: 'APPAREL', label: '服装鞋帽', labelEn: 'Apparel', sortOrder: 3 },
  { category: 'CATALOGUE', code: 'COSMETICS', label: '化妆品', labelEn: 'Cosmetics', sortOrder: 4 },
  { category: 'CATALOGUE', code: 'FOOD', label: '食品', labelEn: 'Food', sortOrder: 5 },

  // ── 其他属性 (OTHER_ATTRS) ──
  { category: 'OTHER_ATTRS', code: 'NONE', label: '无', labelEn: 'None', sortOrder: 1 },
  { category: 'OTHER_ATTRS', code: 'FRAGILE', label: '易碎', labelEn: 'Fragile', sortOrder: 2 },
  { category: 'OTHER_ATTRS', code: 'LIQUID', label: '液体', labelEn: 'Liquid', sortOrder: 3 },
  { category: 'OTHER_ATTRS', code: 'POWDER', label: '粉末', labelEn: 'Powder', sortOrder: 4 },
  { category: 'OTHER_ATTRS', code: 'MAGNETIC', label: '磁性', labelEn: 'Magnetic', sortOrder: 5 },

  // ── 重量单位 (WEIGHT_UNIT) ──
  { category: 'WEIGHT_UNIT', code: 'KG', label: 'KG', sortOrder: 1 },
  { category: 'WEIGHT_UNIT', code: 'G', label: 'G', sortOrder: 2 },
  { category: 'WEIGHT_UNIT', code: 'LB', label: 'LB', sortOrder: 3 },
  { category: 'WEIGHT_UNIT', code: 'OZ', label: 'OZ', sortOrder: 4 },

  // ── 尺寸单位 (DIMENSION_UNIT) ──
  { category: 'DIMENSION_UNIT', code: 'CM', label: 'CM', sortOrder: 1 },
  { category: 'DIMENSION_UNIT', code: 'MM', label: 'MM', sortOrder: 2 },
  { category: 'DIMENSION_UNIT', code: 'IN', label: 'IN', sortOrder: 3 },

  // ── 币种 (CURRENCY) ──
  { category: 'CURRENCY', code: 'USD', label: 'USD - 美元', labelEn: 'US Dollar', sortOrder: 1 },
  { category: 'CURRENCY', code: 'CNY', label: 'CNY - 人民币', labelEn: 'CNY', sortOrder: 2 },
  { category: 'CURRENCY', code: 'EUR', label: 'EUR - 欧元', labelEn: 'EUR', sortOrder: 3 },
  { category: 'CURRENCY', code: 'GBP', label: 'GBP - 英镑', labelEn: 'GBP', sortOrder: 4 },
  { category: 'CURRENCY', code: 'JPY', label: 'JPY - 日元', labelEn: 'JPY', sortOrder: 5 },
  { category: 'CURRENCY', code: 'CAD', label: 'CAD - 加元', labelEn: 'CAD', sortOrder: 6 },
  { category: 'CURRENCY', code: 'AUD', label: 'AUD - 澳元', labelEn: 'AUD', sortOrder: 7 },
];

async function main() {
  console.log(`Seeding ${items.length} dictionary entries…`);
  for (const item of items) {
    await prisma.dictionary.upsert({
      where: { category_code: { category: item.category, code: item.code } },
      create: {
        category: item.category,
        code: item.code,
        label: item.label,
        labelEn: item.labelEn,
        sortOrder: item.sortOrder ?? 0,
      },
      update: {
        label: item.label,
        labelEn: item.labelEn,
        sortOrder: item.sortOrder ?? 0,
      },
    });
  }
  console.log('✓ Dictionary seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
