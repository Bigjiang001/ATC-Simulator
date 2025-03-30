import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const outputFileName = 'game.html';

// 读取HTML文件
const htmlPath = path.join(distDir, 'index.html');
let htmlContent = fs.readFileSync(htmlPath, 'utf-8');

// 处理JS文件
const jsFiles = fs.readdirSync(distDir).filter(file => file.endsWith('.js'));
for (const jsFile of jsFiles) {
  const jsPath = path.join(distDir, jsFile);
  const jsContent = fs.readFileSync(jsPath, 'utf-8');
  
  // 查找<script>标签
  const scriptRegex = new RegExp(`<script[^>]*src=["'][^"']*${jsFile}["'][^>]*></script>`);
  const scriptMatch = htmlContent.match(scriptRegex);
  
  if (scriptMatch) {
    // 替换为内联脚本
    htmlContent = htmlContent.replace(
      scriptMatch[0],
      `<script type="module">${jsContent}</script>`
    );
  }
}

// 处理CSS文件
const cssFiles = fs.readdirSync(distDir).filter(file => file.endsWith('.css'));
for (const cssFile of cssFiles) {
  const cssPath = path.join(distDir, cssFile);
  const cssContent = fs.readFileSync(cssPath, 'utf-8');
  
  // 查找<link>标签
  const linkRegex = new RegExp(`<link[^>]*href=["'][^"']*${cssFile}["'][^>]*>`);
  const linkMatch = htmlContent.match(linkRegex);
  
  if (linkMatch) {
    // 替换为内联样式
    htmlContent = htmlContent.replace(
      linkMatch[0],
      `<style>${cssContent}</style>`
    );
  }
}

// 写入合并后的文件
fs.writeFileSync(path.join(distDir, outputFileName), htmlContent);
console.log(`已生成单一HTML文件: ${outputFileName}`); 