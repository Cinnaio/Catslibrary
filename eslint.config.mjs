// ESLint flat config：TypeScript 推荐规则 + React Hooks（web）。
// 保持与既有代码风格兼容：格式交给 Prettier，这里只管正确性。
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'data/**',
      '.tmp/**',
      '.impeccable/**',
      '**/coverage/**',
    ],
  },

  // TypeScript 源码（api + web + shared + 脚本）
  {
    files: ['api/**/*.ts', 'web/src/**/*.{ts,tsx}', 'shared/**/*.ts'],
    extends: [...tseslint.configs.recommended],
    rules: {
      // 路由层大量动态 JSON 载荷，全面标注收益低；保持可用性优先
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },

  // 前端：React Hooks 规则 + HMR 导出约束
  {
    files: ['web/src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // react-hooks v6 的 React Compiler 启发式规则：对「effect 中加载数据后 setState」
      // 等既有模式全部报 error，按 error 处理需要整体重构数据流，先降为 warn 观察
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  },

  // Node 环境（api、脚本）
  {
    files: ['api/**/*.ts', 'scripts/**/*.mjs', '*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
)
