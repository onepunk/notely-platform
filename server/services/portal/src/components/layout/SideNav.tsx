/**
 * Icon-only Sidebar Navigation for Unified Portal
 * Features role-based filtering and permission checks
 */

import { useMemo, useRef, useEffect } from 'react';
import { alpha, Box, Divider, Drawer, List, ListItemButton, ListItemIcon, Tooltip, Typography } from '@mui/material';
import Link from 'next/link';
import Image from 'next/image';
import navItems from '@/config/navigation';
import useSettings from '@/hooks/useSettings';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';
import { useLicenseOverview } from '@/contexts/LicenseContext';
import { NavItem } from '@/types/navigation';
import { isAdmin } from '@notely/shared/constants/roles';

const SIDEBAR_WIDTH = 72; // Icon-only width

const matchesPath = (itemHref: string, currentPath: string) => {
  if (itemHref === '/') {
    return currentPath === '/';
  }

  return currentPath === itemHref || currentPath.startsWith(`${itemHref}/`);
};

const SideNav = () => {
  const { pathname } = useRouter();
  const { settings } = useSettings();
  const { user, hasPermission } = useAuth();
  const { hasActiveCloudLicense } = useLicenseOverview();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const activeItem = useMemo(
    () => navItems.find((item) => matchesPath(item.href, pathname))?.id,
    [pathname],
  );

  // Restore scroll position on mount
  useEffect(() => {
    const savedScrollPosition = localStorage.getItem('sidebar-scroll-position');
    if (savedScrollPosition && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = parseInt(savedScrollPosition, 10);
    }
  }, []);

  // Save scroll position when scrolling
  useEffect(() => {
    const handleScroll = () => {
      if (scrollContainerRef.current) {
        localStorage.setItem('sidebar-scroll-position', scrollContainerRef.current.scrollTop.toString());
      }
    };

    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll);
      return () => scrollContainer.removeEventListener('scroll', handleScroll);
    }
  }, []);

  // Filter navigation items based on permissions (DB-driven via RBAC page)
  // super_admin sees everything because hasPermission() returns true for super_admin
  const filteredNavItems = useMemo(() => {
    if (!user) return [];

    return navItems.filter((item: NavItem) => {
      // Check permission requirements
      if (item.permissions && item.permissions.length > 0) {
        const hasRequiredPermission = item.permissions.some(perm => {
          const [resource, action] = perm.split(':');
          return hasPermission(resource || '', action || 'read');
        });
        if (!hasRequiredPermission) {
          return false;
        }
      }

      // Check license requirements (admin-type roles bypass)
      if (item.requiresLicense) {
        const isAdminType = isAdmin(user.role);
        if (!isAdminType && !hasActiveCloudLicense) {
          return false;
        }
      }

      return true;
    });
  }, [user, hasPermission, hasActiveCloudLicense]);

  // Separate user items from admin items based on href
  const { userItems, adminItems } = useMemo(() => {
    const userList: NavItem[] = [];
    const adminList: NavItem[] = [];

    filteredNavItems.forEach((item) => {
      if (item.href.startsWith('/admin')) {
        adminList.push(item);
      } else {
        userList.push(item);
      }
    });

    return { userItems: userList, adminItems: adminList };
  }, [filteredNavItems]);

  const content = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Logo */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 2 }}>
        <Image
          src="/notely.png"
          alt="Notely Logo"
          width={41}
          height={41}
          priority
          style={{ objectFit: 'contain' }}
        />
      </Box>
      <Divider />

      {/* Navigation Items */}
      <Box ref={scrollContainerRef} sx={{ flexGrow: 1, overflowY: 'auto', py: 2 }}>
        <List disablePadding>
          {/* User Items */}
          {userItems.map(({ id, title, href, icon: Icon }) => {
            const selected = id === activeItem || matchesPath(href, pathname);
            return (
              <Link key={id} href={href} passHref legacyBehavior>
                <Tooltip title={title} placement="right" arrow>
                  <ListItemButton
                    component="a"
                    selected={selected}
                    sx={{
                      mx: 1.5,
                      mb: 1,
                      borderRadius: 2,
                      justifyContent: 'center',
                      minHeight: 48,
                      '&.Mui-selected': {
                        bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12),
                        color: 'primary.main',
                        '& .MuiListItemIcon-root': {
                          color: 'primary.main',
                        },
                        '&:hover': {
                          bgcolor: (theme) => alpha(theme.palette.primary.main, 0.16),
                        },
                      },
                      '&:hover': {
                        bgcolor: (theme) => alpha(theme.palette.action.hover, 0.08),
                      },
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        minWidth: 'auto',
                        justifyContent: 'center',
                        color: 'inherit',
                      }}
                    >
                      <Icon fontSize="medium" />
                    </ListItemIcon>
                  </ListItemButton>
                </Tooltip>
              </Link>
            );
          })}

          {/* Divider between user and admin items */}
          {userItems.length > 0 && adminItems.length > 0 && (
            <Box sx={{ px: 1.5, py: 2 }}>
              <Divider />
            </Box>
          )}

          {/* Admin Items - slightly darker */}
          {adminItems.map(({ id, title, href, icon: Icon }) => {
            const selected = id === activeItem || matchesPath(href, pathname);
            return (
              <Link key={id} href={href} passHref legacyBehavior>
                <Tooltip title={title} placement="right" arrow>
                  <ListItemButton
                    component="a"
                    selected={selected}
                    sx={{
                      mx: 1.5,
                      mb: 1,
                      borderRadius: 2,
                      justifyContent: 'center',
                      minHeight: 48,
                      opacity: 0.75, // Make admin icons slightly darker
                      '&.Mui-selected': {
                        opacity: 1,
                        bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12),
                        color: 'primary.main',
                        '& .MuiListItemIcon-root': {
                          color: 'primary.main',
                        },
                        '&:hover': {
                          bgcolor: (theme) => alpha(theme.palette.primary.main, 0.16),
                        },
                      },
                      '&:hover': {
                        opacity: 1,
                        bgcolor: (theme) => alpha(theme.palette.action.hover, 0.08),
                      },
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        minWidth: 'auto',
                        justifyContent: 'center',
                        color: 'inherit',
                      }}
                    >
                      <Icon fontSize="medium" />
                    </ListItemIcon>
                  </ListItemButton>
                </Tooltip>
              </Link>
            );
          })}
        </List>
      </Box>

      <Divider />

      {/* Footer */}
      <Box sx={{ py: 2, textAlign: 'center' }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
          © {new Date().getFullYear()}
        </Typography>
      </Box>
    </Box>
  );

  return (
    <Box
      component="nav"
      sx={{
        width: SIDEBAR_WIDTH,
        flexShrink: 0,
        position: { xs: 'fixed', md: 'relative' },
        zIndex: (theme) => theme.zIndex.drawer + 1,
        height: '100%',
      }}
    >
      <Drawer
        variant="permanent"
        open
        sx={{
          '& .MuiDrawer-paper': {
            width: SIDEBAR_WIDTH,
            boxSizing: 'border-box',
            borderRight: 'none',
            boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
          },
        }}
      >
        {content}
      </Drawer>
    </Box>
  );
};

export default SideNav;
