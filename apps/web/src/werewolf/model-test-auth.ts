let token = '';

export function modelTestToken(): string { return token; }
export function setModelTestToken(value: string): void { token = value.trim(); }
export function modelTestHeaders(): Record<string, string> {
  return token ? { 'x-model-test-token': token } : {};
}
