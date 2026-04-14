import { PaletteOptions } from '@mui/material/styles';

const getPalette = (mode: 'light' | 'dark'): PaletteOptions => ({
  mode,
  primary: {
    light: '#D0FA8C',
    main: '#B8F75D',
    dark: '#9FD83A',
    contrastText: '#000000',
  },
  secondary: {
    light: '#74b9ff',
    main: '#2962ff',
    dark: '#0039cb',
    contrastText: '#ffffff',
  },
  error: {
    light: '#ef9a9a',
    main: '#e53935',
    dark: '#b71c1c',
    contrastText: '#ffffff',
  },
  warning: {
    light: '#ffcc80',
    main: '#fb8c00',
    dark: '#ef6c00',
    contrastText: mode === 'dark' ? '#ffffff' : '#212121',
  },
  info: {
    light: '#8ecae6',
    main: '#0288d1',
    dark: '#01579b',
    contrastText: '#ffffff',
  },
  success: {
    light: '#81c784',
    main: '#2e7d32',
    dark: '#1b5e20',
    contrastText: '#ffffff',
  },
  ...(mode === 'light'
    ? {
        // Light mode colors
        background: {
          default: '#f5f7fb',
          paper: '#ffffff',
        },
        text: {
          primary: '#1a1c1e',
          secondary: '#4d5761',
          disabled: '#9aa2b1',
        },
      }
    : {
        // Dark mode colors
        background: {
          default: '#121212',
          paper: '#1e1e1e',
        },
        text: {
          primary: '#ffffff',
          secondary: '#b0b0b0',
          disabled: '#666666',
        },
      }),
});

export default getPalette;
