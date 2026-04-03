/**
 * 不使用 import { defineConfig } from 'vite'，以便在未正确安装依赖时，
 * 配置文件本身不触发对 vite 包的解析（仍须本地安装 vite 才能启动 dev）。
 * @type {import('vite').UserConfig}
 */
export default {
    root: 'web',
    base: './',
    envDir: '..',
    build: {
        outDir: '../dist',
        emptyOutDir: true
    },
    server: {
        port: 3000,
        open: true
    }
};
