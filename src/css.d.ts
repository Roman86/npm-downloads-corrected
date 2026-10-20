// `import css from './panel.css'`: the build's tailwind plugin turns the
// stylesheet into a string (see scripts/build.ts).
declare module '*.css' {
  const css: string;
  export default css;
}
