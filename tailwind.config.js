/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // 字体栈定义在 index.css 的 --font-sans，这里只做引用
        sans: ['var(--font-sans)'],
      },
      colors: {
        // 语义化 token（Apple 风格，浅色/深色见 index.css）
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        // 状态色（成功 / 提醒 / 信息）
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        info: 'hsl(var(--info))',
        // 保底中性灰阶（未语义化的类仍走这套）
        gray: {
          50: '#fafafa', 100: '#f5f5f7', 200: '#e8e8ed', 300: '#d2d2d7', 400: '#aeaeb2',
          500: '#8e8e93', 600: '#6e6e73', 700: '#48484a', 800: '#2c2c2e', 900: '#1c1c1e', 950: '#111113',
        },
      },
      borderRadius: {
        '2xl': '1.25rem',
        '3xl': '1.75rem',
        '4xl': '2rem',
      },
      boxShadow: {
        // Apple 风格柔和多层阴影
        apple: '0 1px 2px rgb(0 0 0 / 0.04), 0 4px 14px rgb(0 0 0 / 0.05)',
        'apple-md': '0 2px 4px rgb(0 0 0 / 0.05), 0 8px 24px rgb(0 0 0 / 0.08)',
        'apple-lg': '0 4px 8px rgb(0 0 0 / 0.06), 0 16px 40px rgb(0 0 0 / 0.12)',
      },
    },
  },
  plugins: [],
};
