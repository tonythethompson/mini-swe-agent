/** Global model statistics tracker, separated to avoid circular imports. */

class GlobalModelStats {
  private _cost = 0.0;
  private _nCalls = 0;
  costLimit = parseFloat(process.env.MSWEA_GLOBAL_COST_LIMIT ?? "0");
  callLimit = parseInt(process.env.MSWEA_GLOBAL_CALL_LIMIT ?? "0", 10);

  add(cost: number): void {
    this._cost += cost;
    this._nCalls += 1;
    if ((this.costLimit > 0 && this.costLimit < this._cost) || (this.callLimit > 0 && this.callLimit < this._nCalls)) {
      throw new Error(`Global cost/call limit exceeded: $${this._cost.toFixed(4)} / ${this._nCalls}`);
    }
  }

  get cost(): number {
    return this._cost;
  }
  get nCalls(): number {
    return this._nCalls;
  }
}

export const GLOBAL_MODEL_STATS = new GlobalModelStats();

