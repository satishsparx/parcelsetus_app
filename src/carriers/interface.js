/** Provider-independent contract. Implementations must normalize all returned statuses. */
export class CarrierProvider {
  constructor(name, capabilities = {}) {
    this.name = name;
    this.capabilities = capabilities;
  }
  async checkServiceability(_request) {
    throw new Error(`${this.name}: serviceability is not configured`);
  }
  async calculateRate(_request) {
    throw new Error(`${this.name}: live rates are not configured`);
  }
  async createBooking(_request) {
    throw new Error(`${this.name}: booking is not configured`);
  }
  async getTracking(_awb) {
    throw new Error(`${this.name}: tracking is not configured`);
  }
  async cancelBooking(_awb) {
    throw new Error(`${this.name}: cancellation is not configured`);
  }
}

export const NORMALIZED_STATUSES = Object.freeze({
  BOOKING_CREATED: 'Booking created',
  BOOKING_CONFIRMED: 'Booking confirmed',
  PICKUP_SCHEDULED: 'Pickup scheduled',
  PICKED_UP: 'Picked up',
  IN_TRANSIT: 'In transit',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  BOOKING_FAILED: 'Booking failed',
  PICKUP_FAILED: 'Pickup failed',
  DELIVERY_ATTEMPTED: 'Delivery attempted',
  RTO_INITIATED: 'RTO initiated',
  RTO_DELIVERED: 'RTO delivered',
  DELAYED: 'Delayed',
  CANCELLED: 'Cancelled',
});
