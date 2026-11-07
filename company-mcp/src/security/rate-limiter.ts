export interface RateLimiterConfig {
  refillRatePerMinute: number;
  burstCapacity: number;
}

interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

export class TokenBucketRateLimiter {
  private buckets = new Map<string, BucketState>();
  private refillRatePerMinute: number;
  private burstCapacity: number;

  constructor(config: RateLimiterConfig) {
    this.refillRatePerMinute = config.refillRatePerMinute;
    this.burstCapacity = config.burstCapacity;
  }

  public consume(key: string, tokensToConsume: number = 1): { allowed: boolean; remainingTokens: number; retryAfterSeconds: number } {
    const now = Date.now();
    let state = this.buckets.get(key);

    if (!state) {
      state = {
        tokens: this.burstCapacity,
        lastRefillMs: now
      };
      this.buckets.set(key, state);
    } else {
      const elapsedMs = now - state.lastRefillMs;
      const tokensToAdd = (elapsedMs / 60000) * this.refillRatePerMinute;
      state.tokens = Math.min(this.burstCapacity, state.tokens + tokensToAdd);
      state.lastRefillMs = now;
    }

    if (state.tokens >= tokensToConsume) {
      state.tokens -= tokensToConsume;
      return {
        allowed: true,
        remainingTokens: Math.floor(state.tokens),
        retryAfterSeconds: 0
      };
    } else {
      const tokensNeeded = tokensToConsume - state.tokens;
      const waitMinutes = tokensNeeded / this.refillRatePerMinute;
      const retryAfterSeconds = Math.max(1, Math.ceil(waitMinutes * 60));
      return {
        allowed: false,
        remainingTokens: Math.floor(state.tokens),
        retryAfterSeconds
      };
    }
  }

  public clear(): void {
    this.buckets.clear();
  }
}
