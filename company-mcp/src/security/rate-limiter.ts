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

  private refillBucket(key: string, now: number): BucketState {
    let state = this.buckets.get(key);
    if (!state) {
      state = {
        tokens: this.burstCapacity,
        lastRefillMs: now
      };
      this.buckets.set(key, state);
      return state;
    }

    const elapsedMs = Math.max(0, now - state.lastRefillMs);
    const tokensToAdd = (elapsedMs / 60000) * this.refillRatePerMinute;
    state.tokens = Math.min(this.burstCapacity, state.tokens + tokensToAdd);
    state.lastRefillMs = now;
    return state;
  }

  private evaluateAvailability(
    state: BucketState,
    tokensToConsume: number
  ): { allowed: boolean; remainingTokens: number; retryAfterSeconds: number } {
    if (state.tokens >= tokensToConsume) {
      return {
        allowed: true,
        remainingTokens: Math.floor(state.tokens),
        retryAfterSeconds: 0
      };
    }

    const tokensNeeded = tokensToConsume - state.tokens;
    const waitMinutes = tokensNeeded / this.refillRatePerMinute;
    return {
      allowed: false,
      remainingTokens: Math.floor(state.tokens),
      retryAfterSeconds: Math.max(1, Math.ceil(waitMinutes * 60))
    };
  }

  public check(key: string, tokensToConsume: number = 1): { allowed: boolean; remainingTokens: number; retryAfterSeconds: number } {
    const state = this.refillBucket(key, Date.now());
    return this.evaluateAvailability(state, tokensToConsume);
  }

  public consume(key: string, tokensToConsume: number = 1): { allowed: boolean; remainingTokens: number; retryAfterSeconds: number } {
    const state = this.refillBucket(key, Date.now());
    const availability = this.evaluateAvailability(state, tokensToConsume);
    if (!availability.allowed) {
      return availability;
    }

    state.tokens -= tokensToConsume;
    return {
      allowed: true,
      remainingTokens: Math.floor(state.tokens),
      retryAfterSeconds: 0
    };
  }

  public clear(): void {
    this.buckets.clear();
  }
}
