import { api } from '@/lib/api-client';
import type {
  OrderDto,
  PlaceOrderRequest,
  EditOrderRequest,
  ReceiveOrderRequest,
  RecordWasteRequest,
  StoreMenuItemDto,
  StoreDto,
} from '@panaderia/shared';

/**
 * The orders feature's thin API surface. Every call goes through the typed `api` client
 * (the only sanctioned path to the backend), and every path is relative to the orders
 * router's `/orders` mount — except the orderable-items lookup, which reads from the
 * menu slice's `/menu/orderable` endpoint to populate the order-entry screen.
 */

export interface ListOrdersParams {
  serviceDay?: string;
  status?: OrderDto['status'];
  role?: 'buyer' | 'producer';
}

function toQuery(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') usp.set(key, value);
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

export const ordersApi = {
  list: (params: ListOrdersParams = {}) =>
    api.get<OrderDto[]>(
      `/orders${toQuery({
        serviceDay: params.serviceDay,
        status: params.status,
        role: params.role,
      })}`,
    ),
  get: (id: string) => api.get<OrderDto>(`/orders/${id}`),
  place: (req: PlaceOrderRequest) => api.post<OrderDto>('/orders', req),
  edit: (id: string, req: EditOrderRequest) => api.patch<OrderDto>(`/orders/${id}`, req),
  freeze: (id: string) => api.post<OrderDto>(`/orders/${id}/freeze`),
  receive: (id: string, req: ReceiveOrderRequest) =>
    api.post<OrderDto>(`/orders/${id}/receive`, req),
  recordWaste: (id: string, req: RecordWasteRequest) =>
    api.post<OrderDto>(`/orders/${id}/waste`, req),

  /** Orderable items for a producer (from the menu slice), used by the order-entry screen. */
  orderableItems: (producerStoreId: string) =>
    api.get<StoreMenuItemDto[]>(`/menu/orderable?producerStoreId=${producerStoreId}`),

  /**
   * Producing stores a buyer may order from. The stores slice owns `/stores`; we filter
   * client-side to the active sellers (the producer also exposes its cutoff time here).
   */
  producers: async (): Promise<StoreDto[]> => {
    const all = await api.get<StoreDto[]>('/stores');
    return all.filter((s) => s.canSell && s.active);
  },
};
