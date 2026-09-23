const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'https://chatvcb-fe.vercel.app',
];

export function corsOrigins() {
  const extra = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ORIGINS, ...extra])];
}
