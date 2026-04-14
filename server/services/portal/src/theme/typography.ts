import { TypographyOptions } from '@mui/material/styles/createTypography';

const typography: TypographyOptions = {
  // Uses CSS variable from next/font for self-hosted Inter (see _app.tsx)
  fontFamily: 'var(--font-inter), "Roboto", "Helvetica", "Arial", sans-serif',
  h1: {
    fontWeight: 700,
    fontSize: '2.5rem',
    lineHeight: 1.25,
  },
  h2: {
    fontWeight: 700,
    fontSize: '2rem',
    lineHeight: 1.3,
  },
  h3: {
    fontWeight: 600,
    fontSize: '1.75rem',
    lineHeight: 1.3,
  },
  h4: {
    fontWeight: 600,
    fontSize: '1.5rem',
    lineHeight: 1.35,
  },
  h5: {
    fontWeight: 600,
    fontSize: '1.25rem',
    lineHeight: 1.4,
  },
  h6: {
    fontWeight: 600,
    fontSize: '1.1rem',
    lineHeight: 1.4,
  },
  subtitle1: {
    fontSize: '1rem',
    lineHeight: 1.4,
  },
  subtitle2: {
    fontSize: '0.875rem',
    lineHeight: 1.4,
  },
  body1: {
    fontSize: '0.95rem',
    lineHeight: 1.6,
  },
  body2: {
    fontSize: '0.875rem',
    lineHeight: 1.6,
  },
  button: {
    textTransform: 'none',
    fontWeight: 600,
  },
  caption: {
    fontSize: '0.75rem',
    lineHeight: 1.4,
  },
  overline: {
    fontSize: '0.75rem',
    fontWeight: 700,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
};

export default typography;
