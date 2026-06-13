'use strict';

/**
 * Cumulative Volume Delta (CVD)
 * Tracks net aggressive buying pressure (positive = net buyers, negative = net sellers).
 *
 * Most reliable with tick data carrying explicit aggressor side (taker_side field).
 * Falls back to tick-rule classification (price up → buyer, price down → seller) when
 * aggressor is not available; tick-rule has ~50-60% accuracy on crypto perpetuals.
 *
 * Divergence detection:
 *   Bearish: price makes higher high, CVD makes lower high → weakening buy aggression (absorption)
 *   Bullish: price makes lower low, CVD makes higher low → weakening sell aggression
 *
 * Caution: CVD divergences in range-bound markets produce frequent false signals (overtrading trap).
 * Most useful on 15m/1h/4h with data aggregated across major venues (Binance, Bybit, OKX).
 */

class CVD {
  /**
   * @param {Object} options
   * @param {number} options.maxBars - Max completed bars to retain for divergence scanning
   */
  constructor({ maxBars = 200 } = {}) {
    this.maxBars = maxBars;
    this.cumDelta = 0;
    this.lastPrice = null;
    this.bars = [];
    this.currentBar = null;
  }

  /**
   * Process a single trade tick.
   *
   * @param {Object} trade
   * @param {number} trade.time  - Unix ms
   * @param {number} trade.price
   * @param {number} trade.size
   * @param {string} [trade.side] - 'buy' | 'sell'; if omitted, tick-rule is applied
   * @returns {{ delta: number, cumDelta: number }}
   */
  addTrade(trade) {
    let side = trade.side;
    if (!side) {
      if (this.lastPrice === null) side = 'buy';
      else side = trade.price >= this.lastPrice ? 'buy' : 'sell';
    }
    this.lastPrice = trade.price;

    const delta = side === 'buy' ? trade.size : -trade.size;
    this.cumDelta += delta;

    if (!this.currentBar) {
      this.currentBar = {
        time: trade.time,
        cvdOpen: this.cumDelta,
        cvdHigh: this.cumDelta,
        cvdLow: this.cumDelta,
        cvdClose: this.cumDelta,
        priceOpen: trade.price,
        priceClose: trade.price,
        priceHigh: trade.price,
        priceLow: trade.price,
      };
    } else {
      this.currentBar.cvdClose = this.cumDelta;
      this.currentBar.priceClose = trade.price;
      if (this.cumDelta > this.currentBar.cvdHigh) this.currentBar.cvdHigh = this.cumDelta;
      if (this.cumDelta < this.currentBar.cvdLow) this.currentBar.cvdLow = this.cumDelta;
      if (trade.price > this.currentBar.priceHigh) this.currentBar.priceHigh = trade.price;
      if (trade.price < this.currentBar.priceLow) this.currentBar.priceLow = trade.price;
    }

    return { delta, cumDelta: this.cumDelta };
  }

  /**
   * Close the current bar (call at candle boundary).
   * @returns {Object|null} completed bar
   */
  closeBar() {
    if (!this.currentBar) return null;
    const bar = { ...this.currentBar };
    this.bars.push(bar);
    if (this.bars.length > this.maxBars) this.bars.shift();
    this.currentBar = null;
    return bar;
  }

  /**
   * Detect CVD divergence from price over the last `lookback` completed bars.
   * @param {number} lookback
   * @returns {'bullish_divergence'|'bearish_divergence'|'none'}
   */
  detectDivergence(lookback = 5) {
    if (this.bars.length < lookback + 1) return 'none';
    const recent = this.bars.slice(-lookback);

    const first = recent[0];
    const last = recent[recent.length - 1];

    const priceHigher = last.priceClose > first.priceClose;
    const priceLower = last.priceClose < first.priceClose;
    const cvdHigher = last.cvdClose > first.cvdClose;
    const cvdLower = last.cvdClose < first.cvdClose;

    if (priceHigher && cvdLower) return 'bearish_divergence';
    if (priceLower && cvdHigher) return 'bullish_divergence';
    return 'none';
  }

  get state() {
    return {
      cumDelta: this.cumDelta,
      divergence: this.detectDivergence(),
      barsCount: this.bars.length,
    };
  }

  reset() {
    this.cumDelta = 0;
    this.lastPrice = null;
    this.bars = [];
    this.currentBar = null;
  }
}

module.exports = { CVD };
