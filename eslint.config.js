import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['web/src/**/*.js'],
    languageOptions: {
      /* FF1: ecmaVersion 'latest' 解锁 ES2025 import attributes（`with { type: 'json' }`）
       * 用于 tests 文件直接 import shared/game_rules.json，无需绕开。 */
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser
      }
    },
    rules: {
      // `_` 前缀统一表示"有意未使用"：参数、变量、以及 catch 绑定（caughtErrorsIgnorePattern）。
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      // 商业化 / 社交 / FTUE 等模块大量使用 `try { ... } catch {}` 来吞掉非关键 IO 错误
      // （localStorage、analytics、push 等），保留 catch 空块；其它空块仍按默认规则拒绝。
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      /* FF1: 同 web/src — 解锁 import attributes 让 with { type: 'json' } 通过 */
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // 测试在 Node/vitest 下运行，需要 process / __dirname / Buffer 等 Node 全局。
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
];
