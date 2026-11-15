const env = import.meta.env;
export const config = {
  apiOrigin: (env.VITE_API_ORIGIN ?? 'http://localhost:8080').replace(/\/$/, ''),
  llmMode: ['mock', 'openai', 'anthropic'].includes(env.VITE_LLM_MODE) ? env.VITE_LLM_MODE : 'unknown',
  paymentMode: ['mock', 'stripe_test'].includes(env.VITE_PAYMENT_MODE) ? env.VITE_PAYMENT_MODE : 'unknown',
};
