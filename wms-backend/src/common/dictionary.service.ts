import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DictionaryService {
  constructor(private prisma: PrismaService) {}

  async create(dto: {
    category: string;
    code: string;
    label: string;
    labelEn?: string;
    sortOrder?: number;
    parentCode?: string;
    extra?: string;
  }) {
    const existing = await this.prisma.dictionary.findUnique({
      where: { category_code: { category: dto.category, code: dto.code } },
    });
    if (existing) {
      throw new ConflictException(`字典项 [${dto.category}/${dto.code}] 已存在`);
    }

    return this.prisma.dictionary.create({
      data: {
        category: dto.category,
        code: dto.code,
        label: dto.label,
        labelEn: dto.labelEn,
        sortOrder: dto.sortOrder ?? 0,
        parentCode: dto.parentCode,
        extra: dto.extra,
      },
    });
  }

  async bulkCreate(items: {
    category: string;
    code: string;
    label: string;
    labelEn?: string;
    sortOrder?: number;
    parentCode?: string;
    extra?: string;
  }[]) {
    const results: any[] = [];
    for (const item of items) {
      const record = await this.prisma.dictionary.upsert({
        where: { category_code: { category: item.category, code: item.code } },
        create: {
          category: item.category,
          code: item.code,
          label: item.label,
          labelEn: item.labelEn,
          sortOrder: item.sortOrder ?? 0,
          parentCode: item.parentCode,
          extra: item.extra,
        },
        update: {
          label: item.label,
          labelEn: item.labelEn,
          sortOrder: item.sortOrder ?? 0,
          parentCode: item.parentCode,
          extra: item.extra,
        },
      });
      results.push(record);
    }
    return results;
  }

  async listByCategory(category: string) {
    return this.prisma.dictionary.findMany({
      where: { category, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async listCategories() {
    const items = await this.prisma.dictionary.findMany({
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });
    return items.map((i) => i.category);
  }

  async update(id: string, dto: {
    label?: string;
    labelEn?: string;
    sortOrder?: number;
    isActive?: boolean;
    parentCode?: string;
    extra?: string;
  }) {
    const existing = await this.prisma.dictionary.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`字典项 ${id} 不存在`);

    return this.prisma.dictionary.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.dictionary.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`字典项 ${id} 不存在`);

    return this.prisma.dictionary.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
