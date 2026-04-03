import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const marker = join(root, 'node_modules', 'vite', 'package.json');

try {
    await access(marker);
} catch {
    console.error(`
未找到本地依赖：node_modules/vite

请在项目根目录执行（不要用 npx 代替安装）：

  npm install

完成后再运行：

  npm run dev
`);
    process.exit(1);
}
