/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          light: '#E55A6B',
          DEFAULT: '#D23148',
          dark: '#A61D2F',
        },
        secondary: '#60A5FA',
        cta: '#F97316',
        background: '#F8FAFC',
        surface: '#FFFFFF',
        text: {
          primary: '#1E293B',
          secondary: '#64748B',
          muted: '#94A3B8'
        },
        border: '#E2E8F0',
        error: '#EF4444',
        success: '#10B981',
        warning: '#F59E0B',
        info: '#3B82F6',
      },
      fontFamily: {
        heading: ['"Fira Code"', 'monospace'],
        body: ['"Fira Sans"', 'sans-serif'],
      },
      boxShadow: {
        sm: '0 1px 2px rgba(0,0,0,0.05)',
        md: '0 4px 6px rgba(0,0,0,0.1)',
        lg: '0 10px 15px rgba(0,0,0,0.1)',
        xl: '0 20px 25px rgba(0,0,0,0.15)',
      }
    },
  },
  plugins: [],
  corePlugins: {
    preflight: false, // 禁用 preflight，避免与 antd 冲突
  }
}
