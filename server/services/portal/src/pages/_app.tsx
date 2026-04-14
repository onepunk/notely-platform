import { CacheProvider, EmotionCache } from '@emotion/react';
import type { AppProps } from 'next/app';
import { useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { Inter } from 'next/font/google';
import createEmotionCache from '@/lib/createEmotionCache';
import SettingsProvider from '@/contexts/SettingsContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { LicenseProvider } from '@/contexts/LicenseContext';
import ThemeCustomization from '@/theme';
import '../../styles/global.css';

// Self-hosted Inter font via next/font (no external requests, automatic optimization)
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-inter',
});

const clientSideEmotionCache = createEmotionCache();

type ExtendedAppProps = AppProps & {
  emotionCache?: EmotionCache;
};

const App = ({ Component, pageProps, emotionCache = clientSideEmotionCache }: ExtendedAppProps) => {
  useEffect(() => {
    const jssStyles = document.querySelector('#jss-server-side');
    if (jssStyles && jssStyles.parentElement) {
      jssStyles.parentElement.removeChild(jssStyles);
    }
  }, []);

  return (
    <div className={inter.variable}>
      <CacheProvider value={emotionCache}>
        <SettingsProvider>
          <AuthProvider>
            <LicenseProvider>
            <ThemeCustomization>
              <Component {...pageProps} />
              <Toaster
              position="top-right"
              toastOptions={{
                duration: 4000,
                style: {
                  background: '#363636',
                  color: '#fff',
                },
                success: {
                  duration: 3000,
                  iconTheme: {
                    primary: '#4caf50',
                    secondary: '#fff',
                  },
                },
                error: {
                  duration: 5000,
                  iconTheme: {
                    primary: '#f44336',
                    secondary: '#fff',
                  },
                },
              }}
            />
            </ThemeCustomization>
            </LicenseProvider>
          </AuthProvider>
        </SettingsProvider>
      </CacheProvider>
    </div>
  );
};

export default App;
