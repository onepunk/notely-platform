import { ReactNode, useMemo } from 'react';
import { CssBaseline, StyledEngineProvider, ThemeProvider } from '@mui/material';
import { createTheme, ThemeOptions } from '@mui/material/styles';
import getPalette from './palette';
import typography from './typography';
import useSettings from '@/hooks/useSettings';

type ThemeCustomizationProps = {
  children: ReactNode;
};

const ThemeCustomization = ({ children }: ThemeCustomizationProps) => {
  const { settings } = useSettings();

  const theme = useMemo(() => {
    const themeOptions: ThemeOptions = {
      palette: getPalette(settings.mode),
      typography,
      shape: {
        borderRadius: 12,
      },
      components: {
        MuiButton: {
          defaultProps: {
            disableElevation: true,
          },
          styleOverrides: {
            root: {
              borderRadius: 10,
              textTransform: 'none',
            },
            contained: {
              backgroundColor: '#132E2D',
              color: '#fff',
              '&:hover': {
                backgroundColor: '#0F2524',
              },
            },
            containedPrimary: {
              backgroundColor: '#132E2D',
              color: '#fff',
              '&:hover': {
                backgroundColor: '#0F2524',
              },
            },
            outlined: {
              borderColor: settings.mode === 'dark' ? '#b0bec5' : '#132E2D',
              color: settings.mode === 'dark' ? '#b0bec5' : '#132E2D',
              '&:hover': {
                borderColor: settings.mode === 'dark' ? '#cfd8dc' : '#0F2524',
                backgroundColor: settings.mode === 'dark' ? 'rgba(176, 190, 197, 0.08)' : 'rgba(19, 46, 45, 0.04)',
              },
            },
            outlinedPrimary: {
              borderColor: settings.mode === 'dark' ? '#b0bec5' : '#132E2D',
              color: settings.mode === 'dark' ? '#b0bec5' : '#132E2D',
              '&:hover': {
                borderColor: settings.mode === 'dark' ? '#cfd8dc' : '#0F2524',
                backgroundColor: settings.mode === 'dark' ? 'rgba(176, 190, 197, 0.08)' : 'rgba(19, 46, 45, 0.04)',
              },
            },
          },
        },
        MuiPaper: {
          defaultProps: {
            elevation: 0,
          },
          styleOverrides: {
            root: {
              borderRadius: 12,
            },
          },
        },
        MuiCard: {
          styleOverrides: {
            root: {
              borderRadius: 16,
              boxShadow:
                settings.mode === 'dark'
                  ? '0 2px 8px rgba(0, 0, 0, 0.25)'
                  : '0 2px 8px rgba(0, 0, 0, 0.06)',
            },
          },
        },
        MuiAppBar: {
          styleOverrides: {
            root: {
              backgroundColor: settings.mode === 'dark' ? '#1e1e1e' : '#ffffff',
              color: settings.mode === 'dark' ? '#ffffff' : '#1a1c1e',
            },
          },
        },
      },
    };

    return createTheme(themeOptions);
  }, [settings.mode]);

  return (
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </StyledEngineProvider>
  );
};

export default ThemeCustomization;
