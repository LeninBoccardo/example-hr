export enum OutboxEventType {
  HCM_DEBIT = 'HCM_DEBIT',
}

export interface HcmDebitOutboxPayload {
  requestId: string;
  employeeId: string;
  locationId: string;
  days: number;
  actor: string;
}
