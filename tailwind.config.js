module.exports = {
  content: ["./views/**/*.{html,js,css,hbs}", "./public/**/*.{html,js,hbs}"],
  darkMode: 'class',
  theme: {
    extend: {},
    fontFamily: {
      'sans': ['Inter', 'system-ui', 'sans-serif'],
      'heading': ['Inter', 'system-ui', 'sans-serif'],
      'mono': ['ui-monospace', 'SF Mono', 'Cascadia Mono', 'Menlo', 'Consolas', 'monospace'],
    },
    screens: {
      'sm': '640px',
      // => @media (min-width: 640px) { ... }

      'md': '768px',
      // => @media (min-width: 768px) { ... }

      'lg': '1024px',
      // => @media (min-width: 1024px) { ... }

      'xl': '1280px',
      // => @media (min-width: 1280px) { ... }

      // disbaled 2xl for now
      // '2xl': '1536px',
      // => @media (min-width: 1536px) { ... }
    },
  },
  plugins: [
    // require('@tailwindcss/forms'),
    // require('@tailwindcss/line-clamp'),
    // use max-w-none with prose to remove the max-width restriction where needed
    require('@tailwindcss/typography'),
    // ...
  ],
}