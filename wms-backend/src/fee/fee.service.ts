import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FeeService {
  constructor(private prisma: PrismaService) {}

  async calculateFee(body: {
    customerId: string;
    warehouseId: string;
    items: Array<{ productId: string; qty: number }>;
    shippingMode: 'AIR' | 'SEA' | 'EXPRESS';
    destinationCountry?: string;
  }) {
    // Basic mockup logic over actual DB products to estimate fee based on weight/volume
    
    let totalWeight = 0;
    let totalVolume = 0;

    for (const item of body.items) {
      const product = await this.prisma.product.findUnique({
        where: { id: item.productId }
      });
      if (!product) throw new NotFoundException(`Product ${item.productId} not found`);

      totalWeight += Number(product.weight || 0) * item.qty;
      const volume = Number(product.length || 0) * Number(product.width || 0) * Number(product.height || 0);
      totalVolume += volume * item.qty;
    }

    // Base rates
    const rateMatrix = {
      AIR: 5.5, // per kg
      SEA: 1.2, // per kg (volumetric converted)
      EXPRESS: 8.0, // per kg
    };

    const rate = rateMatrix[body.shippingMode] || 5.0;
    // Simple calculation: max of physical weight vs volumetric weight (assuming divisor is 5000 for cm3 to kg)
    const volumetricWeight = totalVolume / 5000;
    const chargeableWeight = Math.max(totalWeight, volumetricWeight);
    
    const estimatedFee = chargeableWeight * rate;

    return {
      shippingMode: body.shippingMode,
      totalWeight,
      totalVolume,
      chargeableWeight,
      estimatedFee: Number(estimatedFee.toFixed(2)),
      currency: 'USD',
      details: 'Based on standard rate matrix'
    };
  }
}
