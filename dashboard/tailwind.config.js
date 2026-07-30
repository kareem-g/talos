/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        surface: 'hsl(var(--surface))',
        'surface-hover': 'hsl(var(--surface-hover))',
        'surface-active': 'hsl(var(--surface-active))',
        border: 'hsl(var(--border))',
        'border-hover': 'hsl(var(--border-hover))',
        text: 'hsl(var(--text))',
        'text-muted': 'hsl(var(--text-muted))',
        'text-dim': 'hsl(var(--text-dim))',
        accent: 'hsl(var(--accent))',
        'accent-hover': 'hsl(var(--accent-hover))',
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        error: 'hsl(var(--error))',
        info: 'hsl(var(--info))',
        terminal: {
          bg: 'hsl(var(--terminal-bg))',
          fg: 'hsl(var(--terminal-fg))',
          green: 'hsl(var(--terminal-green))',
          yellow: 'hsl(var(--terminal-yellow))',
          red: 'hsl(var(--terminal-red))',
          blue: 'hsl(var(--terminal-blue))',
          magenta: 'hsl(var(--terminal-magenta))',
          cyan: 'hsl(var(--terminal-cyan))',
        },
      },
      fontFamily: {
        sans: ['Inter', 'SF Pro Display', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'SF Mono', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.15s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        glow: {
          '0%': { boxShadow: '0 0 5px hsl(var(--accent) / 0.3)' },
          '100%': { boxShadow: '0 0 20px hsl(var(--accent) / 0.6)' },
        },
      },
    },
  },
  plugins: [],
}
