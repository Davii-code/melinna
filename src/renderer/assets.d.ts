declare module '*.svg?url' {
  const url: string;
  export default url;
}

declare module '*.css';

declare module '*.jpg?url' {
  const url: string;
  export default url;
}
