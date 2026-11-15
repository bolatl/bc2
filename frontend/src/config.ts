const env = import.meta.env;
export const config = {
  // Packaged deployments serve /api/v1 on the same origin as the frontend.
  apiOrigin: (env.VITE_API_ORIGIN ?? (env.DEV ? 'http://localhost:8080' : '')).replace(/\/$/, ''),
  llmMode: ['mock', 'openai', 'anthropic'].includes(env.VITE_LLM_MODE) ? env.VITE_LLM_MODE : 'unknown',
  paymentMode: ['disabled', 'mock', 'stripe_test'].includes(env.VITE_PAYMENT_MODE) ? env.VITE_PAYMENT_MODE : 'unknown',
};
