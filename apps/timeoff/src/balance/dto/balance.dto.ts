export class BalanceDto {
  employeeId!: string;
  locationId!: string;
  balanceDays!: number;
  reservedDays!: number;
  availableDays!: number;
  lastHcmSyncAt!: string | null;
  source!: 'LOCAL' | 'HCM_REFRESH';
}
