export function getAtvId(subscription: { atv_id?: string; email?: string; [key: string]: unknown }): string {
  return subscription.atv_id || subscription.email || '';
}
