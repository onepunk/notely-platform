import type { ReactNode } from 'react';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Typography,
  Stack,
  Box,
  CircularProgress,
  Button,
  Select,
  MenuItem,
  FormControl,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';

type DesktopPlatform = 'windows' | 'mac' | 'linux';

interface DownloadOption {
  platform: DesktopPlatform;
  label: string;
  icon: ReactNode;
  meta: string;
  hasVariants: boolean;
  comingSoon?: boolean;
}

interface ReleaseVariant {
  id: string;
  label: string;
  fileName: string;
  downloadUrl: string;
  version: string | null;
}

interface PlatformRelease {
  version: string;
  variants: ReleaseVariant[];
}

type ReleasesData = Record<DesktopPlatform, PlatformRelease | undefined>;

// Platform SVG icons matching get.yourdomain.com/cloud design — use currentColor so
// the parent Box's `color` prop controls the fill in both light and dark mode.

function WindowsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88" width={28} height={28} fill="currentColor">
      <path d="M0 12.5v30H38.75V8.3L0 12.5zM42.5 7.8V42.5H88V3L42.5 7.8zM0 45.7v30.1l38.75 4.1V45.7H0zM42.5 45.7v34.5L88 85V45.7H42.5z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" width={28} height={28} fill="currentColor">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}

function LinuxIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width={28} height={28} fill="currentColor">
      <path d="M220.8 123.3c1 .5 1.8 1.7 3 1.7 1.1 0 2.8-.4 2.9-1.5.2-1.4-1.9-2.3-3.2-2.9-1.7-.7-3.9-1-5.5-.1-.4.2-.8.7-.6 1.1.3 1.3 2.3 1.1 3.4 1.7zm-21.9 1.7c1.2 0 2-1.2 3-1.7 1.1-.6 3.1-.4 3.5-1.6.2-.4-.2-.9-.6-1.1-1.6-.9-3.8-.6-5.5.1-1.3.6-3.4 1.5-3.2 2.9.1 1 1.8 1.5 2.8 1.4zM420 403.8c-3.6-4-5.3-11.6-7.2-19.7-1.8-8.1-3.9-16.8-10.5-22.4-1.3-1.1-2.6-2.1-4-2.9-1.3-.8-2.7-1.5-4.1-2 9.2-27.3 5.6-54.5-3.7-79.1-11.4-30.1-31.3-56.4-46.5-74.4-17.1-21.5-33.7-41.9-33.4-72C311.1 85.4 315.7.1 234.8 0 132.4-.2 158 103.4 156.9 135.2c-1.7 23.4-6.4 41.8-22.5 64.7-18.9 22.5-45.5 58.8-58.1 96.7-6 17.9-8.8 36.1-6.2 53.3-6.5 5.8-11.4 14.7-16.6 20.2-4.2 4.3-10.3 5.9-17 8.3s-14 6-18.5 14.5c-2.1 3.9-2.8 8.1-2.8 12.4 0 3.9.6 7.9 1.2 11.8 1.2 8.1 2.5 15.7.8 20.8-5.2 14.4-5.9 24.4-2.2 31.7 3.8 7.3 11.4 10.5 20.1 12.3 17.3 3.6 40.8 2.7 59.3 12.5 19.8 10.4 39.9 14.1 55.9 10.4 11.6-2.6 21.1-9.6 25.9-20.2 12.5-.1 26.3-5.4 48.3-6.6 14.9-1.2 33.6 5.3 55.1 4.1.6 2.3 1.4 4.6 2.5 6.7v.1c8.3 16.7 23.8 24.3 40.3 23 16.6-1.3 34.1-11 48.3-27.9 13.6-16.4 36-23.2 50.9-32.2 7.4-4.5 13.4-10.1 13.9-18.3.4-8.2-4.4-17.3-15.5-29.7zM223.7 87.3c9.8-22.2 34.2-21.8 44-.4 6.5 14.2 3.6 30.9-4.3 40.4-1.6-.8-5.9-2.6-12.6-4.9 1.1-1.2 3.1-2.7 3.9-4.6 4.8-11.8-.2-27-9.1-27.3-7.3-.5-13.9 10.8-11.8 23-4.1-2-9.4-3.5-13-4.4-1-6.9-.3-14.6 2.9-21.8zM183 75.8c10.1 0 20.8 14.2 19.1 33.5-3.5 1-7.1 2.5-10.2 4.6 1.2-8.9-3.3-20.1-9.6-19.6-8.4.7-9.8 21.2-1.8 28.1 1 .8 1.9-.2-5.9 5.5-15.6-14.6-10.5-52.1 8.4-52.1zm-13.6 60.7c6.2-4.6 13.6-10 14.1-10.5 4.7-4.4 13.5-14.2 27.9-14.2 7.1 0 15.6 2.3 25.9 8.9 6.3 4.1 11.3 4.4 22.6 9.3 8.4 3.5 13.7 9.7 10.5 18.2-2.6 7.1-11 14.4-22.7 18.1-11.1 3.6-19.8 16-38.2 14.9-3.9-.2-7-1-9.6-2.1-8-3.5-12.2-10.4-20-15-8.6-4.8-13.2-10.4-14.7-15.3-1.4-4.9 0-9 4.2-12.3zm3.3 334c-2.7 35.1-43.9 34.4-75.3 18-29.9-15.8-68.6-6.5-76.5-21.9-2.4-4.7-2.4-12.7 2.6-26.4v-.2c2.4-7.6.6-16-.6-23.9-1.2-7.8-1.8-15 .9-20 3.5-6.7 8.5-9.1 14.8-11.3 10.3-3.7 11.8-3.4 19.6-9.9 5.5-5.7 9.5-12.9 14.3-18 5.1-5.5 10-8.1 17.7-6.9 8.1 1.2 15.1 6.8 21.9 16l19.6 35.6c9.5 19.9 43.1 48.4 41 68.9zm-30.5-154.4c-17.2 0-25.4-13.5-32.1-31.6-.7-1.9-.8-3.9-.5-5.8 2-11.8 12.6-26.6 24-35.9 7.5-6.2 16.2-10 24.2-10 5.5 0 10.6 1.7 14.8 5.8 8.8 8.7 10.6 28.5 6.2 43.6-.9 3.1-2.4 6-4.5 8.5-7 8.4-16.9 25.4-32.1 25.4zm-52.5-204.9c2.5-3.6 4.1-6.3 5.8-9.8 18.1 2.1 17.5 37.6 4.4 47.9-5.5-4.6-7.7-9.5-13.4-21.4-2.1-4.4-3.9-8.6 3.2-16.7zm-1.4 50.6c2.2-2.5 5.9-1.3 8.2 1 3.5 3.5 2.9 10.4-2.1 13.4-2.5 1.5-5.9.5-7.4-2-1.5-2.5-.4-5.7.9-7.7.5-.9 1-1.4.4-4.7z" />
    </svg>
  );
}

function DownloadArrowIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width={14} height={14} fill="currentColor">
      <path d="M288 32c0-17.7-14.3-32-32-32s-32 14.3-32 32V274.7l-73.4-73.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l128 128c12.5 12.5 32.8 12.5 45.3 0l128-128c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L288 274.7V32zM64 352c-35.3 0-64 28.7-64 64v32c0 35.3 28.7 64 64 64H448c35.3 0 64-28.7 64-64V416c0-35.3-28.7-64-64-64H346.5l-45.3 45.3c-25 25-65.5 25-90.5 0L165.5 352H64zm368 56a24 24 0 1 1 0 48 24 24 0 1 1 0-48z" />
    </svg>
  );
}

const downloadOptions: DownloadOption[] = [
  {
    platform: 'windows',
    label: 'Windows',
    icon: <WindowsIcon />,
    meta: 'Windows 10 / 11 (64-bit)',
    hasVariants: false,
  },
  {
    platform: 'mac',
    label: 'macOS',
    icon: <AppleIcon />,
    meta: 'macOS 12 Monterey+',
    hasVariants: true,
  },
  {
    platform: 'linux',
    label: 'Linux',
    icon: <LinuxIcon />,
    meta: 'Ubuntu, Debian, Fedora, and more',
    hasVariants: true,
  },
];

// Detect if running on Apple Silicon
function isAppleSilicon(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }

  // Modern way using userAgentData (Chrome/Edge)
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  if (nav.userAgentData?.platform === 'macOS') {
    return true;
  }

  // Canvas-based detection for Safari/older browsers
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        if (renderer && typeof renderer === 'string' && renderer.includes('Apple')) {
          return true;
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return false;
}

// Track download via API (fire-and-forget)
function trackDownload(platform: string, variant: string, fileName: string, product: string): void {
  try {
    const data = JSON.stringify({ platform, variant, fileName, product });
    const blob = new Blob([data], { type: 'application/json' });
    navigator.sendBeacon('/api/portal/downloads/track', blob);
  } catch {
    // Silently fail - tracking should never block downloads
  }
}

interface DownloadClientCardProps {
  product?: 'cloud' | 'ai';
}

export function DownloadClientCard({ product = 'cloud' }: DownloadClientCardProps) {
  const [releases, setReleases] = useState<ReleasesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedVariants, setSelectedVariants] = useState<Record<DesktopPlatform, string>>({
    windows: 'x64',
    mac: 'arm64',
    linux: 'deb',
  });

  // Detect Apple Silicon on mount and set default
  useEffect(() => {
    const appleSilicon = isAppleSilicon();
    setSelectedVariants(prev => ({
      ...prev,
      mac: appleSilicon ? 'arm64' : 'x64',
    }));
  }, []);

  useEffect(() => {
    async function fetchReleases() {
      try {
        const response = await fetch(`/api/portal/releases/latest?product=${product}`);
        if (!response.ok) {
          console.error('Failed to fetch releases:', response.status);
          setLoading(false);
          return;
        }
        const data = await response.json();
        if (data.success && data.data) {
          setReleases(data.data);
        }
      } catch (error) {
        console.error('Failed to fetch release info:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchReleases();
  }, [product]);

  const handleVariantChange = useCallback((platform: DesktopPlatform) => (event: SelectChangeEvent) => {
    setSelectedVariants(prev => ({
      ...prev,
      [platform]: event.target.value,
    }));
  }, []);

  const getSelectedVariant = useCallback((platform: DesktopPlatform): ReleaseVariant | undefined => {
    const release = releases?.[platform];
    if (!release?.variants?.length) return undefined;

    const selectedId = selectedVariants[platform];
    return release.variants.find(v => v.id === selectedId) || release.variants[0];
  }, [releases, selectedVariants]);

  const handleDownload = useCallback((platform: DesktopPlatform) => () => {
    const variant = getSelectedVariant(platform);
    if (!variant?.downloadUrl) return;

    // Track the download
    trackDownload(platform, variant.id, variant.fileName, product);

    // Open download in new tab
    window.open(variant.downloadUrl, '_blank', 'noopener,noreferrer');
  }, [getSelectedVariant, product]);

  // Memoize the platform cards to avoid unnecessary re-renders
  const platformCards = useMemo(() => {
    return downloadOptions.map(({ platform, label, icon, meta, hasVariants, comingSoon }) => {
      const release = releases?.[platform];
      const variants = release?.variants || [];
      const selectedVariant = getSelectedVariant(platform);
      const disabled = !selectedVariant?.downloadUrl;

      return (
        <Box
          key={platform}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            py: 2,
            px: 2.5,
            borderRadius: '8px',
            bgcolor: (theme) =>
              theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : '#F6F6F6',
            transition: 'background-color 0.2s ease',
            '&:hover': {
              bgcolor: (theme) =>
                theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : '#EFEFEF',
            },
          }}
        >
          {/* Platform icon — Windows keeps brand blue, others adapt to theme */}
          <Box
            sx={{
              width: 40,
              height: 40,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: platform === 'windows' ? '#0078D4' : 'text.secondary',
            }}
          >
            {icon}
          </Box>

          {/* Platform name + version badge + meta text */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              sx={{
                fontWeight: 600,
                fontSize: '0.95rem',
                lineHeight: 1.3,
                color: 'text.primary',
              }}
            >
              {label}
              {!comingSoon && release?.version && (
                <Box
                  component="span"
                  sx={{
                    display: 'inline-block',
                    ml: 1,
                    px: 1,
                    py: '2px',
                    borderRadius: '4px',
                    bgcolor: (theme) =>
                      theme.palette.mode === 'dark'
                        ? 'rgba(255,255,255,0.08)'
                        : 'rgba(19, 46, 45, 0.08)',
                    color: 'text.secondary',
                    fontSize: '0.68rem',
                    fontWeight: 500,
                    lineHeight: 1.4,
                    verticalAlign: 'middle',
                  }}
                >
                  v{release.version}
                </Box>
              )}
            </Typography>
            <Typography
              sx={{
                fontSize: '0.8rem',
                lineHeight: 1.4,
                color: 'text.secondary',
                mt: '2px',
              }}
            >
              {meta}
            </Typography>
          </Box>

          {comingSoon ? (
            <Typography
              sx={{
                fontSize: '0.8rem',
                fontWeight: 500,
                color: 'text.disabled',
                whiteSpace: 'nowrap',
              }}
            >
              Coming Soon
            </Typography>
          ) : (
            <>
              {/* Variant selector (macOS / Linux) */}
              {hasVariants && variants.length > 1 && (
                <FormControl size="small">
                  <Select
                    value={selectedVariants[platform]}
                    onChange={handleVariantChange(platform)}
                    sx={{
                      fontSize: '0.8rem',
                      fontWeight: 500,
                      borderRadius: '6px',
                      '& .MuiSelect-select': {
                        py: 0.75,
                        pr: 3.5,
                        pl: 1.5,
                      },
                      '& .MuiOutlinedInput-notchedOutline': {
                        borderColor: (theme) =>
                          theme.palette.mode === 'dark'
                            ? 'rgba(255,255,255,0.15)'
                            : 'rgba(19, 46, 45, 0.15)',
                      },
                      '&:hover .MuiOutlinedInput-notchedOutline': {
                        borderColor: (theme) =>
                          theme.palette.mode === 'dark'
                            ? 'rgba(255,255,255,0.3)'
                            : 'rgba(19, 46, 45, 0.3)',
                      },
                    }}
                  >
                    {variants.map(variant => (
                      <MenuItem key={variant.id} value={variant.id} sx={{ fontSize: '0.8rem' }}>
                        {variant.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              {/* Download button */}
              <Button
                variant="contained"
                size="small"
                startIcon={<DownloadArrowIcon />}
                onClick={handleDownload(platform)}
                disabled={disabled}
                sx={{
                  textTransform: 'none',
                  fontSize: '0.8rem',
                  fontWeight: 500,
                  py: 1,
                  px: 2,
                  borderRadius: '5px',
                  flexShrink: 0,
                  minWidth: 'auto',
                }}
              >
                Download
              </Button>
            </>
          )}
        </Box>
      );
    });
  }, [releases, selectedVariants, getSelectedVariant, handleVariantChange, handleDownload]);

  return (
    <Stack spacing={2}>
      {/* Platform download cards */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={24} />
        </Box>
      ) : (
        <Stack spacing={1.5}>
          {platformCards}
        </Stack>
      )}
    </Stack>
  );
}

export default DownloadClientCard;
