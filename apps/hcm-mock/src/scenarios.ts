export interface ScenarioState {
  mode: 'ok' | 'timeout' | 'server_error' | 'invalid_dimension' | 'insufficient_balance';
  // milliseconds to delay ALL responses (simulate slow HCM)
  delayMs: number;
  // specific employee/location pair that should fail; empty = all
  failScopeEmployeeId: string | null;
  failScopeLocationId: string | null;
  // toggle to randomly corrupt `insufficient_balance` responses when caller thinks it's fine
  silentInsufficient: boolean;
  // drift: when true, the balance reported by GET silently differs from debit reality
  driftDays: number;
}

export const DEFAULT_SCENARIO: ScenarioState = {
  mode: 'ok',
  delayMs: 0,
  failScopeEmployeeId: null,
  failScopeLocationId: null,
  silentInsufficient: false,
  driftDays: 0,
};
