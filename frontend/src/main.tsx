import './styles/global.css';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App';
import { SessionProvider } from './app/session';

const queryClient = new QueryClient({ defaultOptions: {
  queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
  mutations: { retry: false, gcTime: 0 },
} });
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><BrowserRouter><SessionProvider><App /></SessionProvider></BrowserRouter></QueryClientProvider>);
