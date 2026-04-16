/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Pretendard Variable', 'Pretendard', 'system-ui', 'sans-serif'],
      },
      colors: {
        teacher: '#6366f1',
        student: '#10b981',
        'student-bg': '#f0f4f8',
      },
    },
  },
  plugins: [],
}
