/**
 * 航班工具函数
 */

/**
 * 生成介于1011-9998之间的随机航班号
 * @returns {number} 随机航班号
 */
export function generateRandomFlightNumber() {
  return Math.floor(Math.random() * 8988) + 1011; // 1011-9998之间的随机数
} 