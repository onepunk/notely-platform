import { SvgIconComponent } from '@mui/icons-material';

export type NavItem = {
  id: string;
  title: string;
  href: string;
  icon: SvgIconComponent;
  chip?: {
    label: string;
    color?: 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';
  };
  permissions?: string[];
  requiresLicense?: boolean;
};
