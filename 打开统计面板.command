#!/bin/zsh
cd -- "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  print '需要先安装 Node.js 22 或更新版本，再双击此文件。'
  read 'answer?按回车关闭…'
  exit 1
fi
node scripts/open-admin.cjs
if (( $? != 0 )); then
  read 'answer?启动失败，按回车关闭…'
fi
