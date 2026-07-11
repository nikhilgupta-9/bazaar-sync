// utils/marketUtils.js
class MarketHours {
  constructor() {
    // Indian market timings (IST)
    this.MARKET_OPEN = '09:15';
    this.MARKET_CLOSE = '15:30';
    this.PRE_OPEN_START = '09:00';
    this.POST_CLOSE_END = '15:40';
  }

  /**
   * Check if current time is within market trading hours
   */
  isTradingTime(date = new Date()) {
    const istDate = this.convertToIST(date);
    const day = istDate.getDay();
    
    // Weekends (Saturday=6, Sunday=0)
    if (day === 0 || day === 6) return false;
    
    const currentTime = this.getTimeString(istDate);
    return currentTime >= this.MARKET_OPEN && currentTime <= this.MARKET_CLOSE;
  }

  /**
   * Check if market is in pre-open or post-close session
   */
  isExtendedHours(date = new Date()) {
    const istDate = this.convertToIST(date);
    const currentTime = this.getTimeString(istDate);
    
    return (currentTime >= this.PRE_OPEN_START && currentTime < this.MARKET_OPEN) ||
           (currentTime > this.MARKET_CLOSE && currentTime <= this.POST_CLOSE_END);
  }

  /**
   * Get next market open time
   */
  getNextMarketOpen(date = new Date()) {
    const istDate = this.convertToIST(date);
    const nextDay = new Date(istDate);
    
    // If after market close, move to next day
    if (this.getTimeString(istDate) > this.MARKET_CLOSE) {
      nextDay.setDate(nextDay.getDate() + 1);
    }
    
    // Skip weekends
    while (nextDay.getDay() === 0 || nextDay.getDay() === 6) {
      nextDay.setDate(nextDay.getDate() + 1);
    }
    
    // Set to market open time
    const [hours, minutes] = this.MARKET_OPEN.split(':');
    nextDay.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    
    return nextDay;
  }

  /**
   * Get current time as string (HH:MM)
   */
  getTimeString(date) {
    return date.toTimeString().slice(0, 5);
  }

  /**
   * Convert to IST (UTC+5:30)
   */
  convertToIST(date) {
    const istOffset = 5.5 * 60 * 60 * 1000;
    return new Date(date.getTime() + (date.getTimezoneOffset() * 60 * 1000) + istOffset);
  }
}

module.exports = { marketHours: new MarketHours() };