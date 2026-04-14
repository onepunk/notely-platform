/**
 * TopBar component with user menu, theme toggle, and notifications
 */

import { useState } from 'react';
import {
  alpha,
  Avatar,
  Box,
  Divider,
  IconButton,
  InputAdornment,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import SearchIcon from '@mui/icons-material/Search';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import { useAuth } from '@/contexts/AuthContext';
import useSettings from '@/hooks/useSettings';
import { useRouter } from 'next/router';
import { isAdmin } from '@notely/shared/constants/roles';

const DESKTOP_TOPBAR_HEIGHT = 73; // Matches logo section height to align with sidebar divider

const TopBar = () => {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { settings, setMode } = useSettings();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleThemeToggle = () => {
    setMode(settings.mode === 'light' ? 'dark' : 'light');
    handleMenuClose();
  };

  const handleLogout = async () => {
    handleMenuClose();
    await logout();
  };

  const handleProfile = () => {
    handleMenuClose();
    router.push('/settings');
  };

  const getInitials = () => {
    if (!user) return '?';
    if (user.firstName && user.lastName) {
      return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
    }
    if (user.name) {
      const parts = user.name.split(' ');
      if (parts.length >= 2) {
        return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
      }
      return user.name[0].toUpperCase();
    }
    return user.email[0].toUpperCase();
  };

  const getUserDisplayName = () => {
    if (!user) return 'Guest';
    if (user.name) return user.name;
    if (user.firstName && user.lastName) {
      return `${user.firstName} ${user.lastName}`;
    }
    return user.email;
  };

  return (
    <Box
      component="header"
      sx={{
        borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
        backgroundColor: 'background.paper',
        position: 'sticky',
        top: 0,
        zIndex: (theme) => theme.zIndex.appBar,
        display: 'flex',
        alignItems: 'center',
        minHeight: { xs: 64, md: `${DESKTOP_TOPBAR_HEIGHT}px` },
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={2}
        sx={{
          width: '100%',
          px: { xs: 2, md: 3 },
        }}
      >
        <Typography variant="h5" sx={{ display: { xs: 'none', md: 'block' }, fontWeight: 700 }}>
          Notely Portal
        </Typography>
        <TextField
          placeholder="Search across notes, meetings, tasks…"
          variant="outlined"
          size="small"
          sx={{ ml: { xs: 0, md: 2 }, flexGrow: 1, maxWidth: 420, display: { xs: 'none', md: 'flex' } }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
        <Box flexGrow={1} />
        <Tooltip title="Notifications">
          <IconButton>
            <NotificationsNoneIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Account">
          <IconButton
            onClick={handleMenuOpen}
            sx={{
              '&:hover': {
                bgcolor: (theme) => alpha(theme.palette.action.hover, 0.08),
              },
            }}
          >
            <Avatar
              sx={{
                bgcolor: 'primary.main',
                width: 36,
                height: 36,
                fontWeight: 600,
                fontSize: '0.875rem',
              }}
            >
              {getInitials()}
            </Avatar>
          </IconButton>
        </Tooltip>
      </Stack>

      {/* User Menu */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        PaperProps={{
          sx: {
            mt: 1.5,
            minWidth: 220,
            borderRadius: 2,
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
          },
        }}
      >
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {getUserDisplayName()}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {user?.email}
          </Typography>
          {user?.role && (
            <Box
              sx={{
                mt: 0.5,
                display: 'inline-block',
                px: 1,
                py: 0.25,
                borderRadius: 1,
                bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1),
                color: 'primary.main',
              }}
            >
              <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.65rem' }}>
                {user.role.replace('_', ' ').toUpperCase()}
              </Typography>
            </Box>
          )}
        </Box>
        <Divider />
        <MenuItem onClick={handleProfile}>
          <ListItemIcon>
            <AccountCircleIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Profile</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleProfile}>
          <ListItemIcon>
            <SettingsIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Settings</ListItemText>
        </MenuItem>
        {user?.role && isAdmin(user.role) && (
          <MenuItem onClick={() => { handleMenuClose(); router.push('/admin'); }}>
            <ListItemIcon>
              <AdminPanelSettingsIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Admin Panel</ListItemText>
          </MenuItem>
        )}
        <Divider />
        <MenuItem onClick={handleThemeToggle}>
          <ListItemIcon>
            {settings.mode === 'dark' ? <Brightness7Icon fontSize="small" /> : <Brightness4Icon fontSize="small" />}
          </ListItemIcon>
          <ListItemText>{settings.mode === 'dark' ? 'Light Mode' : 'Dark Mode'}</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleLogout}>
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Logout</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
};

export default TopBar;
