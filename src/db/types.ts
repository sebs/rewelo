export const FIBONACCI_VALUES = [1, 2, 3, 5, 8, 13, 21] as const;
export type Fibonacci = (typeof FIBONACCI_VALUES)[number];

export function isFibonacci(n: number): n is Fibonacci {
  return FIBONACCI_VALUES.includes(n as Fibonacci);
}

export function assertFibonacci(n: number, field: string): asserts n is Fibonacci {
  if (!isFibonacci(n)) {
    throw new Error(
      `${field} must be a Fibonacci value (${FIBONACCI_VALUES.join(", ")}), got ${n}`
    );
  }
}
