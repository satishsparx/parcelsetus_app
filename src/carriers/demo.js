import { CarrierProvider } from './interface.js';

// Local demo adapter. Replace with credential-backed providers after commercial/API onboarding.
export class DemoCarrier extends CarrierProvider {
  constructor({ name, price, days, divisor = 5000, cod = true }) {
    super(name, {
      serviceability: true,
      rates: false,
      booking: false,
      tracking: false,
      cancellation: false,
      cod,
    });
    this.price = price;
    this.days = days;
    this.divisor = divisor;
  }
  async checkServiceability(request) {
    const pinsValid = /^\d{6}$/.test(request.pickupPin) && /^\d{6}$/.test(request.destinationPin);
    const weight = Math.max(
      Number(request.weightGrams || 0),
      (Number(request.lengthCm || 0) *
        Number(request.widthCm || 0) *
        Number(request.heightCm || 0) *
        1000) /
        this.divisor,
    );
    const eligible =
      pinsValid && weight <= 25000 && (request.paymentType !== 'COD' || this.capabilities.cod);
    return {
      eligible,
      reason: eligible
        ? undefined
        : 'PIN, weight, or payment type is outside this service’s configured limits.',
    };
  }
  async calculateRate(request) {
    const volumetricGrams =
      (Number(request.lengthCm || 0) *
        Number(request.widthCm || 0) *
        Number(request.heightCm || 0) *
        1000) /
      this.divisor;
    const chargeableGrams = Math.max(Number(request.weightGrams || 0), volumetricGrams);
    const price = Math.ceil(this.price + (Math.max(0, chargeableGrams - 500) / 500) * 18);
    return {
      amount: price,
      currency: 'INR',
      estimatedDays: this.days,
      quoteId: `${this.name.toLowerCase().replaceAll(' ', '-')}-${Date.now()}`,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      source: 'demo-estimate',
      chargeableGrams: Math.ceil(chargeableGrams),
      surcharges: [],
    };
  }
  async createBooking(_request) {
    return {
      awb: `${this.name.slice(0, 2).toUpperCase()}${Date.now().toString().slice(-10)}`,
      labelUrl: null,
      providerReference: null,
      status: 'Pickup scheduled',
      demo: true,
    };
  }
  async getTracking(awb) {
    return { awb, status: 'In transit', providerStatus: 'IN_TRANSIT', events: [] };
  }
}

export const carriers = [
  new DemoCarrier({ name: 'Delhivery', price: 86, days: '2–3 days', divisor: 5000 }),
  new DemoCarrier({ name: 'India Post', price: 52, days: '3–5 days', divisor: 6000 }),
  new DemoCarrier({ name: 'Shadowfax', price: 112, days: '1–2 days', divisor: 5000 }),
  new DemoCarrier({ name: 'Amazon Shipping', price: 92, days: '2–4 days', divisor: 5000 }),
];
