import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 获取当前文件的目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取dist中的index.html文件
const indexPath = path.join(__dirname, 'dist', 'index.html');
let content = fs.readFileSync(indexPath, 'utf8');

// 移除外部CSS引用
content = content.replace(/<link rel="stylesheet"[^>]*>/g, '');

// 写回文件
fs.writeFileSync(indexPath, content, 'utf8');

console.log('index.html文件已修复，移除了外部CSS引用以避免样式冲突。');

// 检查游戏页面链接是否正确
if (content.includes('href="game.html"')) {
  console.log('警告: 发现相对链接 "game.html"，正在修复...');
  content = content.replace('href="game.html"', 'href="/ATC-Simulator/game.html"');
  fs.writeFileSync(indexPath, content, 'utf8');
  console.log('游戏页面链接已修复为绝对路径。');
} 